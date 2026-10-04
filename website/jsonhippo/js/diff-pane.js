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
 * diff-pane.js — one side of the Diff tab: an editable pane.
 *
 * The pane IS the editor — a plain <textarea>, like the Text tab's — with a
 * gutter and a layer of row highlights behind it. Its placeholder and spacer
 * rows are empty lines that only the PaneModel (diff/pane-model.js) knows are
 * not part of the JSON: the gutter gives them no number, the highlight layer
 * hatches the placeholders, and every way text leaves the pane — the Copy
 * button, a native copy or cut, the parse, the switch back to Text — goes
 * through the model, which leaves them out.
 *
 * Typing into a placeholder turns it into a real line on the first keystroke,
 * with the indent and comma the document will need (PaneModel.promote()).
 */

import { PaneModel, rowAt, offsetOfRow } from "./diff/pane-model.js";

const MARKERS = { added: "+", missing: "−", changed: "~", type: "≠" };

export class DiffPane {
  /**
   * @param root      the .jh-diff-pane element
   * @param callbacks {
   *   onEdit()                    — the user changed the text (debounce a compare)
   *   onPasteWhole(text) → bool   — a paste is replacing the whole pane; true if taken over
   *   onCommand(name)             — a head button: format, unescape, copy, clear, open, undo
   *   onScroll(top)               — keep the other pane in step
   *   indentFor(row) → string     — indentation of the aligned row in the other pane
   * }
   */
  constructor(root, { side, onEdit, onPasteWhole, onCommand, onScroll, indentFor }) {
    this.root = root;
    this.side = side;
    this.onEdit = onEdit;
    this.onPasteWhole = onPasteWhole;
    this.onCommand = onCommand;
    this.onScroll = onScroll;
    this.indentFor = indentFor;

    this.input = root.querySelector("textarea");
    this.gutterLines = root.querySelector(".jh-gutter-lines");
    this.gutter = root.querySelector(".jh-gutter");
    this.marks = root.querySelector(".jh-diff-marks");
    this.band = root.querySelector(".jh-error-band");
    this.notice = root.querySelector(".jh-pane-notice");

    this.model = new PaneModel("");
    this.errorRow = -1;
    this.pending = null; // { start, type } from beforeinput
    this.renderQueued = false;
    this.syncing = false;

    const style = getComputedStyle(this.input);
    this.lineHeight = parseFloat(style.lineHeight) || 20;
    this.padTop = parseFloat(style.paddingTop) || 0;

    this.bindEvents();
  }

  // ── Text in and out ──────────────────────────────────────────────────────

  /** The pane's JSON — without its placeholder and spacer rows. */
  get text() {
    return this.model.logicalText();
  }

  /** Replace the text outright: no fillers, no highlights. */
  setText(text) {
    this.model.setText(text);
    this.input.value = text;
    this.input.scrollTop = 0;
    this.clearError();
    this.scheduleRender();
  }

  /**
   * Lay the text out down an alignment column (see align.js), keeping the
   * caret on the same character when the text itself has not changed.
   */
  applyLayout(text, column, classes) {
    const focused = document.activeElement === this.input;
    const sameText = text === this.model.logicalText();
    const caret = focused && sameText ? this.model.logicalOffset(this.input.selectionStart) : null;
    const top = this.input.scrollTop;

    this.model.layout(text, column, classes);
    if (this.input.value !== this.model.raw) {
      this.input.value = this.model.raw;
      this.input.scrollTop = top;
      if (caret !== null) {
        const at = this.model.rawOffset(caret);
        this.input.setSelectionRange(at, at);
      }
    }
    this.scheduleRender();
  }

  /** Drop the fillers and highlights, keep the text. */
  plain() {
    this.applyLayout(this.text, this.text.split("\n").map((_, i) => i + 1), new Map());
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  // ── Errors and navigation ────────────────────────────────────────────────

  showError(err) {
    this.errorRow = this.model.rowOfLine(err.line);
    this.scheduleRender();
  }

  clearError() {
    this.errorRow = -1;
    this.band.hidden = true;
  }

  /** Select a range given in logical offsets and bring it into view. */
  jumpTo(start, end) {
    const a = this.model.rawOffset(start);
    const b = this.model.rawOffset(Math.max(end, start));
    this.focus();
    this.input.setSelectionRange(a, b, "backward");
    this.scrollToRow(rowAt(this.model.raw, a));
  }

  scrollToRow(row) {
    const top = this.padTop + row * this.lineHeight;
    const ta = this.input;
    if (top < ta.scrollTop || top + this.lineHeight > ta.scrollTop + ta.clientHeight) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    }
    this.scheduleRender();
  }

  /** Put the caret at the start of a raw row (no scrolling of its own). */
  caretToRow(row) {
    const at = offsetOfRow(this.model.raw, row);
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(at, at);
  }

  /** Whether a raw row is part of a difference (highlighted, or a placeholder). */
  isMarked(row) {
    const m = this.model.meta[row];
    return Boolean(m && (m.cls || m.fill === "placeholder"));
  }

  get rowCount() {
    return this.model.meta.length;
  }

  scrollTo(top) {
    if (Math.abs(this.input.scrollTop - top) < 1) return;
    this.syncing = true;
    this.input.scrollTop = top;
  }

  showNotice(message, undo) {
    this.notice.querySelector(".jh-pane-notice-text").textContent = message;
    this.notice.querySelector('[data-pane="undo"]').hidden = !undo;
    this.notice.hidden = false;
  }

  hideNotice() {
    this.notice.hidden = true;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  bindEvents() {
    const ta = this.input;

    ta.addEventListener("beforeinput", (e) => {
      this.pending = { start: ta.selectionStart, type: e.inputType };
    });

    ta.addEventListener("input", () => {
      const type = this.pending?.type ?? "";
      // Undo and redo can change text anywhere, so no position hint for them.
      const hint = type.startsWith("history") || !this.pending ? Infinity : this.pending.start;
      this.pending = null;
      const { promoted } = this.model.edit(ta.value, hint);
      if (promoted !== null) {
        const { raw, caret } = this.model.promote(promoted, ta.selectionStart, this.indentFor(promoted));
        if (raw !== ta.value) {
          const top = ta.scrollTop;
          ta.value = raw;
          ta.setSelectionRange(caret, caret);
          ta.scrollTop = top;
        }
      }
      this.clearError();
      this.scheduleRender();
      this.onEdit();
    });

    ta.addEventListener("paste", (e) => {
      const pasted = e.clipboardData?.getData("text/plain") ?? "";
      if (pasted === "") return;
      const all = this.text.trim() === "" || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
      if (all && this.onPasteWhole(pasted)) e.preventDefault();
    });

    // Placeholders never reach the clipboard.
    const toClipboard = (e, cut) => {
      const { selectionStart: a, selectionEnd: b } = ta;
      if (a === b) return;
      const text = this.model.textBetween(a, b);
      if (text === ta.value.slice(a, b)) return; // nothing to leave out: let the browser do it
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      if (cut) document.execCommand("delete");
    };
    ta.addEventListener("copy", (e) => toClipboard(e, false));
    ta.addEventListener("cut", (e) => toClipboard(e, true));

    ta.addEventListener("scroll", () => {
      this.scheduleRender();
      if (this.syncing) {
        this.syncing = false;
        return;
      }
      this.onScroll(ta.scrollTop);
    });

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.onCommand("format");
      }
    });

    this.root.addEventListener("click", (e) => {
      const button = e.target.closest("[data-pane]");
      if (button) this.onCommand(button.dataset.pane, button);
    });

    new ResizeObserver(() => this.scheduleRender()).observe(ta);
  }

  // ── Rendering: gutter numbers and row highlights for the visible rows ────

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render() {
    const ta = this.input;
    const lh = this.lineHeight;
    const meta = this.model.meta;
    const first = Math.max(0, Math.floor((ta.scrollTop - this.padTop) / lh));
    const last = Math.min(meta.length, first + Math.ceil(ta.clientHeight / lh) + 2);

    // Logical number of the first visible row, then count on from it.
    let number = 0;
    for (let r = 0; r < first; r++) if (!meta[r].fill) number++;

    let gutter = "";
    let marks = "";
    for (let r = first; r < last; r++) {
      const m = meta[r];
      const marker = MARKERS[m.cls] ?? "";
      if (m.fill) {
        gutter += '<div class="jh-gutter-line"></div>';
      } else {
        number++;
        const cls = m.cls ? ` jh-gutter-line--${m.cls}` : "";
        gutter += `<div class="jh-gutter-line${cls}"><span class="jh-gutter-mark">${marker}</span>${number}</div>`;
      }
      // One row per line, like the gutter — no inline positioning, which the CSP forbids.
      const kind = m.fill === "placeholder" ? "placeholder" : m.cls;
      marks += kind ? `<div class="jh-dmark jh-dmark--${kind}"></div>` : '<div class="jh-dmark"></div>';
    }
    this.gutterLines.innerHTML = gutter;
    this.gutterLines.style.transform = `translateY(${this.padTop + first * lh - ta.scrollTop}px)`;
    this.marks.innerHTML = marks;
    this.marks.style.transform = `translateY(${this.padTop + first * lh - ta.scrollTop}px)`;
    this.gutter.style.width = `calc(${String(meta.length).length}ch + 34px)`;

    const errTop = this.padTop + this.errorRow * lh - ta.scrollTop;
    const showBand = this.errorRow >= 0 && errTop > -lh && errTop < ta.clientHeight;
    this.band.hidden = !showBand;
    if (showBand) this.band.style.top = `${errTop}px`;
  }
}
