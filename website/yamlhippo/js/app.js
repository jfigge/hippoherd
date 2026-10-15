/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of YamlHippo.
 *
 * YamlHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * YamlHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with YamlHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * app.js — wires YamlHippo together.
 *
 * Owns the one piece of shared state — the latest parse of the current text —
 * and moves it between the widgets, each of which gets its callbacks through
 * its constructor:
 *
 *   TextView     (text-view.js)     the textarea, gutter, toolbar, smart-paste notice
 *   StatusBar    (status-bar.js)    valid summary, or the error with its jump links
 *   WarningsView (warnings-view.js) the list of lint warnings, opened from the status bar
 *   TreeView     (tree-view.js)     the tree, its toolbar, tag legend and detail bar (jQuery)
 *   TreeFilter   (tree-filter.js)   the filter box over the tree (jQuery)
 *   TypesView    (types-view.js)    the Types tab: a reference for every custom tag
 *   SchemaView   (schema-view.js)   the Schema tab: a JSON Schema inferred from the text
 *   DiffView     (diff-view.js)     the Diff tab: two editable panes, compared
 *
 * When validation runs: on paste, on Format and Fix paste, and 400 ms after
 * typing stops — except above LIVE_LIMIT, where typing does not trigger it
 * and the status bar offers "Validate now" instead. With the Warnings box
 * ticked, each validation also lints (lint/linter.js).
 *
 * A YAML stream can hold several documents (---). The Tree, Types and Schema
 * tabs show the CURRENT one, chosen with the document switcher on the Tree
 * tab; the status bar and the warnings cover them all.
 *
 * The Tree, Types and Schema tabs show the parse of exactly the current
 * text: if it is behind when one of them is opened, they parse there and then.
 */

import { parse } from "./parser/parser.js";
import { YamlHippoError } from "./parser/errors.js";
import { Linter } from "./lint/linter.js";
import { detectAndFix } from "./smart-paste.js";
import { emitYaml } from "./yaml-emitter.js";
import { toJson, describeDropped } from "./json-export.js";
import { customTags } from "./tag-colors.js";
import { inferTypes } from "./catalogue/infer-types.js";
import { TextView } from "./text-view.js";
import { StatusBar } from "./status-bar.js";
import { Settings } from "./settings.js";
import { TreeView } from "./tree-view.js";
import { TreeFilter } from "./tree-filter.js";
import { TypesView } from "./types-view.js";
import { SchemaView } from "./schema-view.js";
import { DiffView, fixNotice } from "./diff-view.js";
import { WarningsView } from "./warnings-view.js";
import { installHippoViewer } from "./viewhippo.js";
import { copyText, debounce, nextFrame, plural, utf8Length } from "./util.js";

const TYPING_DEBOUNCE_MS = 400;

/** Above this many characters, typing does not trigger validation. */
const LIVE_LIMIT = 5 * 1024 * 1024;

/** Above this many characters, say "Validating…" and let it paint first. */
const SHOW_BUSY_ABOVE = 512 * 1024;

/** The tabs, in the order they sit in the bar. */
const TABS = ["tree", "text", "types", "schema", "diff"];

/** The tabs that show the current document's parse. */
const DOCUMENT_TABS = new Set(["tree", "types", "schema"]);

const THEMES = ["system", "light", "dark"];
const THEME_UI = {
  system: { icon: "system", label: "System", aria: "Theme: follow the system" },
  light: { icon: "sun", label: "Light", aria: "Theme: light" },
  dark: { icon: "moon", label: "Dark", aria: "Theme: dark" },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(script);
  });
}

/** "mapping · 5 keys", for the document switcher. */
function describeRoot(ast) {
  if (!ast) return "empty";
  if (ast.kind === "object") return `mapping · ${plural(ast.entries.length, "key")}`;
  if (ast.kind === "array") return `list · ${plural(ast.items.length, "item")}`;
  return ast.kind;
}

class App {
  constructor() {
    this.settings = new Settings();
    this.version = 0; // bumped on every change to the text
    this.result = { version: 0, empty: true }; // latest parse: { version, empty } | { version, ok, documents, … } | { version, error }
    this.fixOriginal = null; // the text before a smart-paste fix, for Undo
    this.tab = "text";
    this.docIndex = 0; // the current document of a stream

    this.textView = new TextView(document.getElementById("yh-panel-text"), {
      onEdit: (text, { paste }) => this.onEdit(text, paste),
      onPaste: (pasted, replacesAll) => this.onPaste(pasted, replacesAll),
      onCommand: (name) => this.onCommand(name),
      onLoad: (text, name) => this.load(text, name),
    });

    this.status = new StatusBar(document.getElementById("yh-status"), {
      onJump: (start, end, line, column) => this.jumpToText(start, end, line, column),
      onDiffJump: (side, start, end) => this.diffView.panes[side].jumpTo(start, end),
      onValidate: () => this.validate(),
      onWarnings: () => this.warningsView.toggle(),
    });

    this.warningsView = new WarningsView(document.getElementById("yh-warnings"), {
      onJump: (w) => this.jumpToText(w.offset, w.endOffset, w.line, w.column),
      onChange: (open) => this.status.warningsExpanded(open),
    });

    this.diffView = new DiffView(document.getElementById("yh-panel-diff"), {
      status: this.status,
      settings: this.settings,
    });

    this.schemaView = new SchemaView(document.getElementById("yh-panel-schema"), {
      settings: this.settings,
      onGoToError: () => this.goToError(),
    });

    this.typesView = new TypesView(document.getElementById("yh-panel-types"), {
      onShowTag: (name) => this.showTagInTree(name),
      onShowNode: (node) => this.showNodeInTree(node),
      onGoToError: () => this.goToError(),
    });

    const $tree = $("#yh-panel-tree");
    this.treeView = new TreeView($tree, {
      // The detail bar (path, copy, show in text) is TreeView's own; nothing
      // outside the tree needs to follow the selection yet.
      onSelect: () => {},
      onShowInText: ({ node, keyToken }) => this.showInText(node, keyToken),
      onGoToError: () => this.goToError(),
      formatValue: (node) => this.valueText(node),
      onTag: (name) => (name === null ? this.treeFilter.clear() : this.treeFilter.set(name)),
    });
    this.treeFilter = new TreeFilter($tree, this.treeView, {
      getAst: () => this.treeView.ast,
      isActive: () => this.tab === "tree",
    });
    this.docSelect = document.getElementById("yh-doc");
    this.docSelect.addEventListener("change", () => {
      this.docIndex = Number(this.docSelect.value);
      this.syncView();
    });
    this.treeView.showEmpty();
    this.schemaView.showEmpty();
    this.typesView.showEmpty();

    this.validateSoon = debounce(() => this.validate(), TYPING_DEBOUNCE_MS);
    this.bindChrome();
    this.status.idle();
  }

  get indent() {
    return Number(this.settings.indent);
  }

  // ── Text events ──────────────────────────────────────────────────────────

  onEdit(text, paste) {
    this.version++;
    // Typing invalidates Undo: restoring the pre-fix text would throw the
    // edits away without saying so.
    if (this.fixOriginal !== null && !paste) this.dropUndo();
    this.textView.clearError();
    this.textView.clearWarnings();
    this.warningsView.markStale();
    if (paste) {
      this.validateSoon.cancel();
      this.validate();
    } else if (text.length > LIVE_LIMIT) {
      this.validateSoon.cancel();
      this.status.paused(utf8Length(text));
    } else {
      this.validateSoon();
    }
  }

  /** Smart paste: fix the paste on the way in when it has tabs, curly quotes or stray indentation. */
  onPaste(pasted, replacesAll) {
    if (!this.settings.autoFix || !replacesAll) return false;
    const result = detectAndFix(pasted);
    if (result === null) return false;
    this.applyFix(pasted, result);
    return true;
  }

  applyFix(original, result) {
    this.fixOriginal = original;
    this.replaceText(result.text);
    this.textView.showNotice(fixNotice(result));
    this.validate();
  }

  dropUndo() {
    this.fixOriginal = null;
    this.textView.hideNotice();
  }

  onCommand(name) {
    switch (name) {
      case "format":
        this.reformat();
        break;
      case "fix": {
        const text = this.textView.text;
        const result = detectAndFix(text);
        if (result === null) {
          this.textView.showNotice("Nothing to fix: no tabs, curly quotes, invisible characters or stray indentation found.", { undo: false });
        } else {
          this.applyFix(text, result);
        }
        break;
      }
      case "undo-fix":
        if (this.fixOriginal !== null) {
          const original = this.fixOriginal;
          this.dropUndo();
          this.replaceText(original);
          this.validate();
        }
        break;
      case "to-json":
        this.copyAsJson();
        break;
      case "clear":
        this.dropUndo();
        this.replaceText("");
        this.validate();
        this.textView.focus();
        break;
    }
  }

  /** Open a document: the file button, and ViewHippo's load (viewhippo.js). */
  load(text, name) {
    this.dropUndo();
    this.replaceText(text);
    return this.validate({ label: name });
  }

  /** The current text, exactly as it would be saved. */
  get text() {
    return this.textView.text;
  }

  /** Set the text from code (not typing). Keeps the Undo notice. */
  replaceText(text) {
    this.validateSoon.cancel();
    this.version++;
    this.textView.setText(text);
  }

  /** Format from the tree, comments kept. Never changes the text when it is invalid. */
  async reformat() {
    const result = await this.validate({ explicit: true });
    if (!result?.ok) return;
    const out = emitYaml(result, { indent: this.indent });
    if (out === this.textView.text) return;
    this.replaceText(out);
    // Re-parse so every tree position refers to the new text.
    await this.validate();
  }

  /** Copy the current document as JSON, and say what did not survive. */
  async copyAsJson() {
    const result = await this.validate({ explicit: true });
    if (!result?.ok) return;
    const doc = this.currentDocument();
    // The document's comments: from the end of the one before it to the start of the next.
    const i = this.docIndex;
    const from = i === 0 ? 0 : (result.documents[i - 1].end?.offset ?? 0);
    const to = result.documents[i + 1]?.start?.offset ?? Infinity;
    const comments = result.comments.filter((c) => c.offset >= from && c.offset < to).length;
    const { text, dropped, budgetExceeded } = toJson(doc, { indent: " ".repeat(this.indent), comments, documents: result.documents.length });
    const copied = await copyText(text);
    const lost = describeDropped(dropped, { documents: result.documents.length, current: this.docIndex + 1 });
    if (budgetExceeded) lost.push("aliasing too deep to expand fully (some aliases became null)");
    const head = copied ? "Copied as JSON" : "Could not copy to the clipboard";
    this.textView.showNotice(lost.length ? `${head}. Not carried over: ${lost.join("; ")}.` : `${head} — nothing was lost.`, { undo: false });
  }

  /** Copy value: a scalar's text as it reads, a collection as YAML. */
  valueText(node) {
    const target = node.kind === "alias" ? node.target : node;
    if (target.kind === "object" || target.kind === "array") return emitYaml(target, { indent: this.indent, comments: false }).replace(/\n$/, "");
    if (target.kind === "string") return target.value;
    return target.raw === "" ? "null" : String(target.value ?? "null");
  }

  // ── Validation ───────────────────────────────────────────────────────────

  /**
   * Parse the current text and show the outcome everywhere.
   * `explicit` (Format, Copy as JSON) reports an empty input as EMPTY_INPUT
   * rather than as the idle prompt. Returns the result, or null if the text
   * changed while waiting to paint.
   */
  async validate({ explicit = false, label = null } = {}) {
    this.validateSoon.cancel();
    const version = this.version;
    const text = this.textView.text;

    if (text.trim() === "" && !explicit) {
      this.result = { version, empty: true };
      this.status.idle();
      this.textView.clearError();
      this.textView.clearWarnings();
      this.warningsView.update([], 0);
      this.syncView();
      return this.result;
    }

    if (text.length > SHOW_BUSY_ABOVE) {
      this.status.busy(`Validating ${label ?? "input"}…`);
      await nextFrame();
      if (version !== this.version) return null;
    }

    this.result = this.parseNow(text, version);
    this.showResult(text);
    this.syncView();
    return this.result;
  }

  parseNow(text, version) {
    try {
      const r = { version, ok: true, ...parse(text, { lint: this.settings.lint ? new Linter() : null }) };
      if (this.docIndex >= r.documents.length) this.docIndex = 0;
      return r;
    } catch (err) {
      if (!(err instanceof YamlHippoError)) throw err;
      return { version, error: err };
    }
  }

  showResult(text) {
    const r = this.result;
    if (r.ok) {
      this.warningsView.update(r.warnings, r.warningTotal);
      this.status.valid(r, utf8Length(text), { listOpen: this.warningsView.isOpen });
      this.textView.clearError();
      this.textView.setWarnings(r.warnings);
    } else if (r.error) {
      this.warningsView.update([], 0);
      this.status.error(r.error);
      this.textView.showError(r.error);
      this.textView.clearWarnings();
    }
  }

  currentDocument() {
    return this.result.documents[Math.min(this.docIndex, this.result.documents.length - 1)];
  }

  /** The custom tags of the whole stream, with their colours (computed once per parse). */
  tagsOf(r) {
    r.tags ??= customTags(r.documents);
    return r.tags;
  }

  /** The Tree, Types and Schema tabs show the parse of exactly the current text, or its error. */
  syncView() {
    if (!DOCUMENT_TABS.has(this.tab)) return;
    if (this.result.version !== this.version) {
      this.result = this.textView.text.trim() === "" ? { version: this.version, empty: true } : this.parseNow(this.textView.text, this.version);
      if (!this.result.empty) this.showResult(this.textView.text);
    }
    if (this.tab === "tree") this.syncTree(this.result);
    else if (this.tab === "types") this.syncTypes(this.result);
    else this.syncSchema(this.result);
  }

  syncTree(r) {
    this.syncDocSwitch(r);
    if (r.ok) {
      const doc = this.currentDocument();
      if (this.treeView.ast !== doc.ast) {
        const many = r.documents.length > 1;
        this.treeView.setDocument(doc.ast, r.stats, r.warnings, { label: many ? `Document ${this.docIndex + 1}` : "YAML", tags: this.tagsOf(r) });
        this.treeFilter.refresh();
      }
    } else if (r.error) {
      this.treeView.showError(r.error);
      this.treeFilter.refresh();
    } else {
      this.treeView.showEmpty();
      this.treeFilter.refresh();
    }
  }

  /** One option per document of a stream; hidden for a single document. */
  syncDocSwitch(r) {
    const docs = r.ok ? r.documents : [];
    this.docSelect.hidden = docs.length < 2;
    if (docs.length < 2) return;
    if (this.docSelect.dataset.version !== String(r.version)) {
      this.docSelect.dataset.version = String(r.version);
      this.docSelect.innerHTML = "";
      docs.forEach((d, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = `Document ${i + 1} of ${docs.length} — ${describeRoot(d.ast)}`;
        this.docSelect.append(option);
      });
    }
    this.docSelect.value = String(this.docIndex);
  }

  syncTypes(r) {
    if (r.ok) {
      const tags = this.tagsOf(r);
      r.types ??= inferTypes(r.documents, { colors: new Map(tags.map((t) => [t.name, t.color])) });
      this.typesView.show(r.documents, r.types);
    } else if (r.error) this.typesView.showError(r.error);
    else this.typesView.showEmpty();
  }

  syncSchema(r) {
    if (r.ok) this.schemaView.show(this.currentDocument().ast);
    else if (r.error) this.schemaView.showError(r.error);
    else this.schemaView.showEmpty();
  }

  // ── Navigation between views ─────────────────────────────────────────────

  switchTab(name) {
    const from = this.tab;
    if (from === name) return;

    // Leaving Diff: Text and Tree carry on with the Left pane's text.
    if (from === "diff") {
      const left = this.diffView.leave();
      if (left !== this.textView.text) {
        this.dropUndo();
        this.replaceText(left);
      }
    }

    this.tab = name;
    for (const id of TABS) {
      const on = id === name;
      const tab = document.getElementById(`yh-tab-${id}`);
      tab.classList.toggle("yh-tab--active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(`yh-panel-${id}`).hidden = !on;
    }

    // Entering Diff: whatever is in the editor goes into the Left pane. The
    // Diff tab has its own status; the warnings list is the Text tab's.
    if (name === "diff") {
      this.warningsView.toggle(false);
      this.validateSoon.flush();
      this.diffView.enter(this.textView.text);
      return;
    }
    if (from === "diff") this.validate(); // puts the Text/Tree status back
    if (DOCUMENT_TABS.has(name)) {
      this.validateSoon.flush();
      this.syncView();
    }
  }

  /** The legend, a tag chip or the Types tab: show every node with this tag. */
  showTagInTree(name) {
    this.switchTab("tree");
    this.treeFilter.set(name);
  }

  /** The Types tab's links to odd uses: select that node in the tree. */
  showNodeInTree(node) {
    const docs = this.result.documents ?? [];
    const i = docs.findIndex((d) => d.ast && d.ast.start.offset <= node.start.offset && node.start.offset <= d.ast.end.offset);
    if (i >= 0 && i !== this.docIndex) this.docIndex = i;
    this.switchTab("tree");
    this.syncView();
    if (this.treeFilter.active) this.treeFilter.clear();
    this.treeView.showNode(node);
  }

  goToError() {
    const err = this.result.error;
    if (err) this.jumpToText(err.offset, err.endOffset, err.line, err.column);
  }

  jumpToText(start, end, line, column) {
    this.switchTab("text");
    this.textView.jumpTo(start, end, line, column);
  }

  /** Put the caret on a tree node's source: its key, or the value itself. */
  showInText(node, keyToken) {
    if (keyToken) {
      this.jumpToText(keyToken.offset, keyToken.endOffset, keyToken.line, keyToken.column);
    } else {
      const container = node.kind === "object" || node.kind === "array";
      const end = container ? node.start.offset + 1 : node.end.offset;
      this.jumpToText(node.start.offset, end, node.start.line, node.start.column);
    }
  }

  // ── Header, tabs and settings ────────────────────────────────────────────

  /** Remember a theme and show it: the header button, and ViewHippo's Appearance menu. */
  setTheme(theme) {
    this.settings.theme = theme;
    this.applyTheme(theme);
  }

  applyTheme(theme) {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const ui = THEME_UI[theme];
    const button = document.getElementById("yh-theme");
    button.querySelector("use").setAttribute("href", `#yh-i-${ui.icon}`);
    button.querySelector(".yh-theme-label").textContent = ui.label;
    button.setAttribute("aria-label", ui.aria);
  }

  bindChrome() {
    TABS.forEach((id, i) => {
      const tab = document.getElementById(`yh-tab-${id}`);
      tab.addEventListener("click", () => this.switchTab(id));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        document.getElementById(`yh-tab-${next}`).focus();
        this.switchTab(next);
      });
    });

    const indent = document.getElementById("yh-indent");
    indent.value = this.settings.indent;
    indent.addEventListener("change", () => {
      this.settings.indent = indent.value;
    });

    // The Fix paste button only shows while Auto-fix is off.
    const auto = document.getElementById("yh-auto-fix");
    const fixButton = document.getElementById("yh-fix");
    auto.checked = this.settings.autoFix;
    fixButton.hidden = auto.checked;
    auto.addEventListener("change", () => {
      this.settings.autoFix = auto.checked;
      fixButton.hidden = auto.checked;
    });

    // Off means no lint work at all, so turning it on (or off) parses again.
    const lint = document.getElementById("yh-lint");
    lint.checked = this.settings.lint;
    lint.addEventListener("change", () => {
      this.settings.lint = lint.checked;
      this.validate();
    });

    this.applyTheme(this.settings.theme);
    document.getElementById("yh-theme").addEventListener("click", () => {
      this.setTheme(THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length]);
    });

    // The brand hippo opens About. Esc and Close dismiss it natively; a click
    // on the backdrop lands on the <dialog> itself, so that closes it too.
    const about = document.getElementById("yh-about");
    document.getElementById("yh-about-open").addEventListener("click", () => about.showModal());
    about.addEventListener("click", (e) => {
      if (e.target === about) about.close();
    });
  }
}

// jQuery comes from the pinned cdnjs <script> in index.html. If that was
// blocked or failed its integrity check, load the identical local copy.
if (!window.jQuery) {
  try {
    await loadScript("vendor/jquery.min.js");
  } catch (err) {
    console.error("YamlHippo: jQuery could not be loaded from the CDN or locally.", err);
  }
}

if (window.jQuery) {
  installHippoViewer(new App());
} else {
  const status = document.getElementById("yh-status");
  status.textContent = "YamlHippo could not load jQuery, so it cannot start. Check that vendor/jquery.min.js is being served.";
  status.className = "yh-status yh-status--error";
}
