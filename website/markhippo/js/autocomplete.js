/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of MarkHippo.
 *
 * MarkHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * MarkHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with MarkHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * autocomplete.js — the suggestion popup at the cursor.
 *
 * It opens by itself where the parser and the line say a suggestion makes
 * sense (complete/context.js): a / at the start of a line (block types), a
 * / starting a word (inline scaffolding), the info string of a code fence
 * (languages), "][" (the document's reference labels). Ctrl+Space opens it
 * anywhere. Typing filters it; ↑ ↓ choose; Enter or Tab inserts; Esc
 * closes.
 *
 * It is the fast path: it opens on the keystroke itself, not after the
 * debounced parse — `complete(text, offset, options)` brings the parse up
 * to date first when it has to (incremental, so that is cheap), and while
 * the popup is open, typing only re-filters what it already has.
 */

import { rank } from "./complete/match.js";
import { expandSnippet, wraps } from "./complete/snippet.js";
import { lineStartAt } from "./highlight/lines.js";

// What may have been typed after the start of a suggestion, per context.
const TYPED = {
  block: /^\/?([A-Za-z0-9-]*)$/,
  inline: /^\/?([A-Za-z0-9-]*)$/,
  "fence-info": /^[ \t]*([^\s`]*)$/,
  "link-ref": /^([^\]\n]*)$/,
  "link-anchor": /^([^)\s]*)$/,
};

// A cheap look at the line before asking for a parse: could a context
// start here at all?
const reMaybe = /(?:^|\s|>)\/[A-Za-z0-9-]*$|(?:`{3,}|~{3,})[ \t]*[^\s`]*$|\]\[[^\]\n]*$|\]\(#[^)\s]*$/;

const MAX_ITEMS = 50;

export class Autocomplete {
  // `editor`: the EditorView; `popup`: the listbox element; `complete`:
  // (text, offset, options) → { context, items } | null.
  constructor(editor, popup, { complete }) {
    this.editor = editor;
    this.el = editor.el;
    this.popup = popup;
    this.complete = complete;
    this.state = null;
    // Where a dismissed suggestion started: not offered again while the
    // same word is typed on.
    this.dismissed = -1;

    popup.addEventListener("mousedown", (e) => {
      // Keep the focus (and the selection) in the editor.
      e.preventDefault();
      const option = e.target.closest("[role=option]");
      if (option) this.pick(Number(option.dataset.index));
    });
    popup.addEventListener("mousemove", (e) => {
      const option = e.target.closest("[role=option]");
      if (option && Number(option.dataset.index) !== this.state?.active) this.select(Number(option.dataset.index));
    });
    this.el.addEventListener("blur", () => this.close());
  }

  get open() {
    return this.state !== null;
  }

  // After every edit.
  input(e) {
    if (this.picking) return;
    if (this.state) {
      if (this.state.wrap) this.close();
      else this.refresh();
      return;
    }
    const typing = !e || e.inputType === "insertText" || e.inputType === "insertCompositionText";
    if (typing) this.maybeOpen();
  }

  // After the caret moved: anywhere but where typing left it (or, wrapping,
  // off the selection), the suggestion no longer applies.
  caretMoved() {
    // Back at (or before) a dismissed suggestion's start: it may be offered
    // again.
    if (this.el.selectionStart <= this.dismissed) this.dismissed = -1;
    if (!this.state) return;
    const { selectionStart, selectionEnd } = this.el;
    const [start, end] = this.state.caret;
    if (selectionStart !== start || selectionEnd !== end) this.close();
  }

  // Open if the cursor is somewhere a suggestion belongs.
  maybeOpen() {
    const { value, selectionStart: offset, selectionEnd } = this.el;
    if (offset !== selectionEnd) return;
    const line = value.slice(lineStartAt(value, offset), offset);
    if (!reMaybe.test(line)) return;
    this.start(this.complete(value, offset, {}), { explicit: false });
  }

  // Ctrl+Space: suggestions for wherever the cursor is. With text
  // selected, the suggestion wraps it (Bold, Link…).
  request() {
    const { value, selectionStart, selectionEnd } = this.el;
    this.dismissed = -1;
    const found = this.complete(value, selectionStart, { explicit: true });
    const wrap = selectionStart !== selectionEnd ? value.slice(selectionStart, selectionEnd) : null;
    // Wrapping, only what has a placeholder to put the selection in.
    if (found && wrap) found.items = found.items.filter((item) => wraps(item.insert));
    this.start(found, { explicit: true, wrap });
  }

  start(found, { explicit, wrap = null }) {
    this.close();
    if (!found || !found.items.length) return;
    if (!explicit && found.context.from === this.dismissed) return;
    // Opened by itself on a fence or a "][", nothing is chosen until an
    // arrow key says so: a plain ``` and Enter must stay just that.
    const passive = !explicit && found.context.kind !== "block" && found.context.kind !== "inline";
    this.state = { context: found.context, all: found.items, items: [], active: passive ? -1 : 0, passive, explicit, wrap };
    if (this.refresh()) this.el.setAttribute("aria-expanded", "true");
  }

  // Re-filter by what has been typed since the suggestion started. Answers
  // whether the popup is (still) open.
  refresh() {
    const { context, all, explicit } = this.state;
    const { value, selectionStart: offset, selectionEnd } = this.el;
    let query = context.query;
    if (!this.state.wrap) {
      const typed = offset === selectionEnd && offset >= context.from ? value.slice(context.from, offset) : null;
      const m = typed === null ? null : TYPED[context.kind]?.exec(typed);
      if (!m) {
        this.close();
        return false;
      }
      query = m[1];
    }
    const items = rank(all, query).slice(0, MAX_ITEMS);
    // An exact, complete match leaves nothing to suggest: ```js typed in full.
    const done = items.length === 1 && items[0].label === query && context.kind === "fence-info";
    if (!items.length || done) {
      if (!explicit || done) this.dismiss();
      else this.close();
      return false;
    }
    this.state.query = query;
    this.state.items = items;
    // Typing a query is choosing too.
    if (this.state.passive && query) this.state.passive = false;
    this.state.active = this.state.passive ? -1 : Math.max(0, Math.min(this.state.active, items.length - 1));
    this.state.caret = [this.el.selectionStart, this.el.selectionEnd];
    this.render();
    return true;
  }

  dismiss() {
    if (this.state) this.dismissed = this.state.context.from;
    this.close();
  }

  close() {
    if (!this.state) return;
    this.state = null;
    this.popup.hidden = true;
    this.popup.replaceChildren();
    this.el.removeAttribute("aria-activedescendant");
    this.el.setAttribute("aria-expanded", "false");
  }

  // Keys while open (and the request keys always). Answers whether it used
  // the key. Ctrl+Space is the usual request key, but macOS gives it to
  // switching input sources by default, so Alt+/ asks too.
  keydown(e) {
    // Mid-composition (an IME), the keys are the IME's.
    if (e.isComposing || e.keyCode === 229) return false;
    const ctrlSpace = e.key === " " && e.ctrlKey && !e.metaKey && !e.altKey;
    const altSlash = e.code === "Slash" && e.altKey && !e.ctrlKey && !e.metaKey;
    if (ctrlSpace || altSlash) {
      e.preventDefault();
      this.request();
      return true;
    }
    if (!this.state) return false;
    const n = this.state.items.length;
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
    if (e.key in moves && plain) {
      this.state.passive = false;
      const from = this.state.active < 0 ? (moves[e.key] > 0 ? -1 : 0) : this.state.active;
      const to = from + moves[e.key];
      this.select(Math.abs(moves[e.key]) === 1 ? (to + n) % n : Math.max(0, Math.min(n - 1, to)));
    } else if ((e.key === "Enter" || e.key === "Tab") && plain) {
      // Nothing chosen: the key does what it always does.
      if (this.state.active < 0) {
        this.dismiss();
        return false;
      }
      this.pick(this.state.active);
    } else if (e.key === "Escape") {
      this.dismiss();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  select(index) {
    this.state.active = index;
    for (const option of this.popup.children) {
      const on = Number(option.dataset.index) === index;
      option.setAttribute("aria-selected", String(on));
      if (on) {
        this.el.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    }
  }

  // Insert suggestion `index`.
  pick(index) {
    const item = this.state?.items[index];
    if (!item) return;
    const { context, wrap } = this.state;
    const snippet = item.insert ?? item.label.replace(/\$/g, "$$$$");
    const { text, select } = expandSnippet(snippet, { prefix: context.prefix, selection: wrap ?? "" });
    const to = this.el.selectionEnd;
    this.close();
    this.dismissed = -1;
    this.picking = true;
    try {
      this.editor.replaceRange(context.from, to, text);
    } finally {
      this.picking = false;
    }
    this.el.setSelectionRange(context.from + select[0], context.from + select[1]);
    // One suggestion can lead to the next: a code block to its language.
    this.maybeOpenAt(context.from + select[0]);
  }

  maybeOpenAt(offset) {
    const { value } = this.el;
    const line = value.slice(lineStartAt(value, offset), offset);
    if (!reMaybe.test(line)) return;
    const found = this.complete(value, offset, {});
    if (found && found.context.kind === "fence-info") this.start(found, { explicit: false });
  }

  render() {
    const { items, active, context } = this.state;
    const options = items.map((item, i) => {
      const option = document.createElement("div");
      option.className = "mh-complete-item";
      option.id = `mh-complete-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(i === active));
      option.dataset.index = String(i);
      const label = document.createElement("span");
      label.className = "mh-complete-label";
      label.textContent = item.label;
      option.append(label);
      if (item.detail) {
        const detail = document.createElement("span");
        detail.className = "mh-complete-detail";
        detail.textContent = item.detail;
        option.append(detail);
      }
      if (item.hint) {
        const hint = document.createElement("code");
        hint.className = "mh-complete-hint";
        hint.textContent = item.hint;
        option.append(hint);
      }
      return option;
    });
    this.popup.replaceChildren(...options);
    this.popup.dataset.kind = context.kind;
    this.popup.hidden = false;
    if (active >= 0) this.el.setAttribute("aria-activedescendant", `mh-complete-${active}`);
    else this.el.removeAttribute("aria-activedescendant");
    this.place();
    options[active]?.scrollIntoView({ block: "nearest" });
  }

  // Under the start of the suggestion — or over it, if there is more room.
  place() {
    const rect = this.editor.hl.caretRect(this.state.context.from);
    if (!rect) return;
    const box = this.popup.offsetParent?.getBoundingClientRect();
    const view = this.editor.scroller.getBoundingClientRect();
    if (!box) return;
    const height = this.popup.offsetHeight;
    const width = this.popup.offsetWidth;
    const below = view.bottom - rect.bottom;
    const top = below >= height + 4 || below >= rect.top - view.top ? rect.bottom + 2 : rect.top - height - 2;
    const left = Math.max(view.left + 4, Math.min(rect.left - 8, view.right - width - 12));
    this.popup.style.top = `${top - box.top}px`;
    this.popup.style.left = `${left - box.left}px`;
  }
}
