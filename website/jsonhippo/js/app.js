/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * app.js — wires JsonHippo together.
 *
 * Owns the one piece of shared state — the latest parse of the current text —
 * and moves it between the widgets, each of which gets its callbacks through
 * its constructor:
 *
 *   TextView   (text-view.js)   the textarea, gutter, toolbar, smart-paste notice
 *   StatusBar  (status-bar.js)  valid summary, or the error with its jump links
 *   WarningsView (warnings-view.js) the list of lint warnings, opened from the status bar
 *   TreeView   (tree-view.js)   the tree, its toolbar and detail bar (jQuery)
 *   TreeFilter (tree-filter.js) the filter box over the tree (jQuery)
 *   SchemaView (schema-view.js) the Schema tab: a JSON Schema inferred from the text
 *   DiffView   (diff-view.js)   the Diff tab: two editable panes, compared
 *
 * When validation runs (docs/features/05): on paste, on Format/Minify, and
 * 400 ms after typing stops — except above LIVE_LIMIT, where typing does not
 * trigger it and the status bar offers "Validate now" instead. With the
 * Warnings box ticked, each validation also lints (lint/linter.js).
 *
 * The Tree and Schema tabs show the parse of exactly the current text: if it
 * is behind when either is opened, they parse there and then. The schema
 * (docs/features/09) is inferred from that parse into a tab of its own, so
 * the text is never changed.
 */

import { parse } from "./parser/parser.js";
import { JsonHippoError } from "./parser/errors.js";
import { Linter } from "./lint/linter.js";
import { detectAndUnescape } from "./smart-paste.js";
import { format, minify, INDENTS } from "./formatter.js";
import { TextView } from "./text-view.js";
import { StatusBar } from "./status-bar.js";
import { Settings } from "./settings.js";
import { TreeView } from "./tree-view.js";
import { TreeFilter } from "./tree-filter.js";
import { SchemaView } from "./schema-view.js";
import { DiffView } from "./diff-view.js";
import { WarningsView } from "./warnings-view.js";
import { debounce, nextFrame, utf8Length } from "./util.js";

const TYPING_DEBOUNCE_MS = 400;

/** Above this many characters, typing does not trigger validation. */
const LIVE_LIMIT = 5 * 1024 * 1024;

/** Above this many characters, say "Validating…" and let it paint first. */
const SHOW_BUSY_ABOVE = 512 * 1024;

/** The tabs, in the order they sit in the bar. */
const TABS = ["tree", "text", "schema", "diff"];

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

class App {
  constructor() {
    this.settings = new Settings();
    this.version = 0; // bumped on every change to the text
    this.result = { version: 0, empty: true }; // latest parse: { version, empty } | { version, ok, ast, … } | { version, error }
    this.unescapeOriginal = null; // the text before Unescape, for Undo
    this.tab = "text";

    this.textView = new TextView(document.getElementById("jh-panel-text"), {
      onEdit: (text, { paste }) => this.onEdit(text, paste),
      onPaste: (pasted, replacesAll) => this.onPaste(pasted, replacesAll),
      onCommand: (name) => this.onCommand(name),
      onLoad: (text, name) => this.load(text, name),
    });

    this.status = new StatusBar(document.getElementById("jh-status"), {
      onJump: (start, end, line, column) => this.jumpToText(start, end, line, column),
      onDiffJump: (side, start, end) => this.diffView.panes[side].jumpTo(start, end),
      onValidate: () => this.validate(),
      onWarnings: () => this.warningsView.toggle(),
    });

    this.warningsView = new WarningsView(document.getElementById("jh-warnings"), {
      onJump: (w) => this.jumpToText(w.offset, w.endOffset, w.line, w.column),
      onChange: (open) => this.status.warningsExpanded(open),
    });

    this.diffView = new DiffView(document.getElementById("jh-panel-diff"), {
      status: this.status,
      settings: this.settings,
    });

    this.schemaView = new SchemaView(document.getElementById("jh-panel-schema"), {
      settings: this.settings,
      onGoToError: () => this.goToError(),
    });

    const $tree = $("#jh-panel-tree");
    this.treeView = new TreeView($tree, {
      // The detail bar (path, copy, show in text) is TreeView's own; nothing
      // outside the tree needs to follow the selection yet.
      onSelect: () => {},
      onShowInText: ({ node, keyToken }) => this.showInText(node, keyToken),
      onGoToError: () => this.goToError(),
      formatValue: (node) => format(node, { indent: INDENTS[this.settings.indent] }),
    });
    this.treeFilter = new TreeFilter($tree, this.treeView, {
      getAst: () => this.treeView.ast,
      isActive: () => this.tab === "tree",
    });
    this.treeView.showEmpty();
    this.schemaView.showEmpty();

    this.validateSoon = debounce(() => this.validate(), TYPING_DEBOUNCE_MS);
    this.bindChrome();
    this.status.idle();
  }

  // ── Text events ──────────────────────────────────────────────────────────

  onEdit(text, paste) {
    this.version++;
    // Typing invalidates Undo: restoring the pre-unescape text would throw
    // the edits away without saying so.
    if (this.unescapeOriginal !== null && !paste) this.dropUndo();
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

  /** Smart paste: take the paste over when it is escaped JSON. */
  onPaste(pasted, replacesAll) {
    if (!this.settings.autoUnescape || !replacesAll) return false;
    const result = detectAndUnescape(pasted);
    if (result === null) return false;
    this.applyUnescape(pasted, result);
    return true;
  }

  applyUnescape(original, { text, levels }) {
    this.unescapeOriginal = original;
    this.replaceText(text);
    this.textView.showNotice(`Unescaped ${levels === 1 ? "1 level" : `${levels} levels`} of escaped JSON.`);
    this.validate();
  }

  dropUndo() {
    this.unescapeOriginal = null;
    this.textView.hideNotice();
  }

  onCommand(name) {
    switch (name) {
      case "format":
      case "minify":
        this.reformat(name);
        break;
      case "unescape": {
        const text = this.textView.text;
        const result = detectAndUnescape(text);
        if (result === null) {
          this.textView.showNotice("Nothing to unescape: this is not escaped JSON.", { undo: false });
        } else {
          this.applyUnescape(text, result);
        }
        break;
      }
      case "undo-unescape":
        if (this.unescapeOriginal !== null) {
          const original = this.unescapeOriginal;
          this.dropUndo();
          this.replaceText(original);
          this.validate();
        }
        break;
      case "clear":
        this.dropUndo();
        this.replaceText("");
        this.validate();
        this.textView.focus();
        break;
    }
  }

  load(text, name) {
    this.dropUndo();
    this.replaceText(text);
    this.validate({ label: name });
  }

  /** Set the text from code (not typing). Keeps the Undo notice. */
  replaceText(text) {
    this.validateSoon.cancel();
    this.version++;
    this.textView.setText(text);
  }

  /** Format / Minify from the AST. Never changes the text when it is invalid. */
  async reformat(kind) {
    const result = await this.validate({ explicit: true });
    if (!result?.ok) return;
    const out = kind === "format" ? format(result.ast, { indent: INDENTS[this.settings.indent] }) : minify(result.ast);
    if (out === this.textView.text) return;
    this.replaceText(out);
    // Re-parse so every AST position refers to the new text.
    await this.validate();
  }

  // ── Validation ───────────────────────────────────────────────────────────

  /**
   * Parse the current text and show the outcome everywhere.
   * `explicit` (Format/Minify) reports an empty input as EMPTY_INPUT rather
   * than as the idle prompt. Returns the result, or null if the text changed
   * while waiting to paint.
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
      return { version, ok: true, ...parse(text, { lint: this.settings.lint ? new Linter() : null }) };
    } catch (err) {
      if (!(err instanceof JsonHippoError)) throw err;
      return { version, error: err };
    }
  }

  showResult(text) {
    const r = this.result;
    if (r.ok) {
      this.warningsView.update(r.warnings, r.warningTotal);
      this.status.valid(r, utf8Length(text), r.ast.kind, { listOpen: this.warningsView.isOpen });
      this.textView.clearError();
      this.textView.setWarnings(r.warnings);
    } else if (r.error) {
      this.warningsView.update([], 0);
      this.status.error(r.error);
      this.textView.showError(r.error);
      this.textView.clearWarnings();
    }
  }

  /** The Tree and Schema tabs show the parse of exactly the current text, or its error. */
  syncView() {
    if (this.tab !== "tree" && this.tab !== "schema") return;
    if (this.result.version !== this.version) {
      this.result = this.textView.text.trim() === "" ? { version: this.version, empty: true } : this.parseNow(this.textView.text, this.version);
      if (!this.result.empty) this.showResult(this.textView.text);
    }
    if (this.tab === "tree") this.syncTree(this.result);
    else this.syncSchema(this.result);
  }

  syncTree(r) {
    if (r.ok) {
      if (this.treeView.ast !== r.ast) {
        this.treeView.setDocument(r.ast, r.stats, r.warnings);
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

  syncSchema(r) {
    if (r.ok) this.schemaView.show(r.ast);
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
      const tab = document.getElementById(`jh-tab-${id}`);
      tab.classList.toggle("jh-tab--active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(`jh-panel-${id}`).hidden = !on;
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
    if (name === "tree" || name === "schema") {
      this.validateSoon.flush();
      this.syncView();
    }
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

  bindChrome() {
    TABS.forEach((id, i) => {
      const tab = document.getElementById(`jh-tab-${id}`);
      tab.addEventListener("click", () => this.switchTab(id));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        document.getElementById(`jh-tab-${next}`).focus();
        this.switchTab(next);
      });
    });

    const indent = document.getElementById("jh-indent");
    indent.value = this.settings.indent;
    indent.addEventListener("change", () => {
      this.settings.indent = indent.value;
    });

    const auto = document.getElementById("jh-auto-unescape");
    auto.checked = this.settings.autoUnescape;
    auto.addEventListener("change", () => {
      this.settings.autoUnescape = auto.checked;
    });

    // Off means no lint work at all, so turning it on (or off) parses again.
    const lint = document.getElementById("jh-lint");
    lint.checked = this.settings.lint;
    lint.addEventListener("change", () => {
      this.settings.lint = lint.checked;
      this.validate();
    });

    const themeButton = document.getElementById("jh-theme");
    const applyTheme = (theme) => {
      if (theme === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      const ui = THEME_UI[theme];
      themeButton.querySelector("use").setAttribute("href", `#jh-i-${ui.icon}`);
      themeButton.querySelector(".jh-theme-label").textContent = ui.label;
      themeButton.setAttribute("aria-label", ui.aria);
    };
    applyTheme(this.settings.theme);
    themeButton.addEventListener("click", () => {
      const next = THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length];
      this.settings.theme = next;
      applyTheme(next);
    });
  }
}

// jQuery comes from the pinned cdnjs <script> in index.html. If that was
// blocked or failed its integrity check, load the identical local copy.
if (!window.jQuery) {
  try {
    await loadScript("vendor/jquery.min.js");
  } catch (err) {
    console.error("JsonHippo: jQuery could not be loaded from the CDN or locally.", err);
  }
}

if (window.jQuery) {
  new App();
} else {
  const status = document.getElementById("jh-status");
  status.textContent = "JsonHippo could not load jQuery, so it cannot start. Check that vendor/jquery.min.js is being served.";
  status.className = "jh-status jh-status--error";
}
