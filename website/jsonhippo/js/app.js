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
 *   TreeView   (tree-view.js)   the tree, its toolbar and detail bar (jQuery)
 *   TreeFilter (tree-filter.js) the filter box over the tree (jQuery)
 *
 * When validation runs (docs/features/05): on paste, on Format/Minify, and
 * 400 ms after typing stops — except above LIVE_LIMIT, where typing does not
 * trigger it and the status bar offers "Validate now" instead.
 */

import { parse } from "./parser/parser.js";
import { JsonHippoError } from "./parser/errors.js";
import { detectAndUnescape } from "./smart-paste.js";
import { format, minify, INDENTS } from "./formatter.js";
import { TextView } from "./text-view.js";
import { StatusBar } from "./status-bar.js";
import { Settings } from "./settings.js";
import { TreeView } from "./tree-view.js";
import { TreeFilter } from "./tree-filter.js";
import { debounce, nextFrame, utf8Length } from "./util.js";

const TYPING_DEBOUNCE_MS = 400;

/** Above this many characters, typing does not trigger validation. */
const LIVE_LIMIT = 5 * 1024 * 1024;

/** Above this many characters, say "Validating…" and let it paint first. */
const SHOW_BUSY_ABOVE = 512 * 1024;

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
      onValidate: () => this.validate(),
    });

    const $tree = $("#jh-panel-tree");
    this.treeView = new TreeView($tree, {
      // The detail bar (path, copy, show in text) is TreeView's own; nothing
      // outside the tree needs to follow the selection yet.
      onSelect: () => {},
      onShowInText: ({ node, keyToken }) => this.showInText(node, keyToken),
      onGoToError: () => {
        const err = this.result.error;
        if (err) this.jumpToText(err.offset, err.endOffset, err.line, err.column);
      },
      formatValue: (node) => format(node, { indent: INDENTS[this.settings.indent] }),
    });
    this.treeFilter = new TreeFilter($tree, this.treeView, {
      getAst: () => this.treeView.ast,
      isActive: () => this.tab === "tree",
    });
    this.treeView.showEmpty();

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
      this.syncTree();
      return this.result;
    }

    if (text.length > SHOW_BUSY_ABOVE) {
      this.status.busy(`Validating ${label ?? "input"}…`);
      await nextFrame();
      if (version !== this.version) return null;
    }

    this.result = this.parseNow(text, version);
    this.showResult(text);
    this.syncTree();
    return this.result;
  }

  parseNow(text, version) {
    try {
      return { version, ok: true, ...parse(text) };
    } catch (err) {
      if (!(err instanceof JsonHippoError)) throw err;
      return { version, error: err };
    }
  }

  showResult(text) {
    const r = this.result;
    if (r.ok) {
      this.status.valid(r, utf8Length(text), r.ast.kind);
      this.textView.clearError();
    } else if (r.error) {
      this.status.error(r.error);
      this.textView.showError(r.error);
    }
  }

  /** The Tree tab shows the parse of exactly the current text, or its error. */
  syncTree() {
    if (this.tab !== "tree") return;
    if (this.result.version !== this.version) {
      this.result = this.textView.text.trim() === "" ? { version: this.version, empty: true } : this.parseNow(this.textView.text, this.version);
      if (!this.result.empty) this.showResult(this.textView.text);
    }
    const r = this.result;
    if (r.ok) {
      if (this.treeView.ast !== r.ast) {
        this.treeView.setDocument(r.ast, r.stats);
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

  // ── Navigation between views ─────────────────────────────────────────────

  switchTab(name) {
    this.tab = name;
    for (const id of ["text", "tree"]) {
      const on = id === name;
      const tab = document.getElementById(`jh-tab-${id}`);
      tab.classList.toggle("jh-tab--active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(`jh-panel-${id}`).hidden = !on;
    }
    if (name === "tree") {
      this.validateSoon.flush();
      this.syncTree();
    }
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
    const tabs = [document.getElementById("jh-tab-text"), document.getElementById("jh-tab-tree")];
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => this.switchTab(i === 0 ? "text" : "tree"));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const other = tabs[1 - i];
        other.focus();
        this.switchTab(other === tabs[0] ? "text" : "tree");
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
