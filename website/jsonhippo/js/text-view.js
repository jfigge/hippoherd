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
 * text-view.js — the Text tab: a plain <textarea>, a line-number gutter, the
 * toolbar, and in-place marking of the error and of any warnings.
 *
 * The textarea always accepts input, valid or not: the user has to see the
 * bad text to fix it. Nothing here parses; app.js does, and calls back with
 * showError() / clearError().
 *
 * The textarea is the source of truth for the text. Its value has line
 * endings normalised to \n by the browser, so the offsets the parser reports
 * against that value are exactly the offsets setSelectionRange() takes.
 *
 * Built for multi-megabyte input: the gutter only ever holds the line numbers
 * that are on screen, and the error marker is positioned by arithmetic from
 * the line height plus ONE measurement of where the bad token sits on its
 * line, taken once per error rather than on every scroll.
 *
 * That measurement lays the line out in a hidden mirror with the textarea's
 * own font, rather than multiplying a character width by the column. Over a
 * 5 MB minified document — one 5 MB line — the multiplication drifts by
 * thousands of pixels (column 2,612,549 landed five records early when
 * tried), because the browser's layout rounds every glyph advance. The
 * mirror rounds exactly the way the textarea does.
 */

import { copyText, escapeHtml, flashButton, formatCount } from "./util.js";

/** A gutter tooltip lists this many of a line's warnings, then counts the rest. */
const TOOLTIP_WARNINGS = 5;

export class TextView {
  /**
   * @param panel     the Text tab's <section>
   * @param callbacks {
   *   onEdit(text, { paste }) — the user changed the text (typing, cut, a paste
   *                             that was not intercepted, drop)
   *   onPaste(pastedText, replacesAll) → true if the app took the paste over
   *   onCommand(name)          — 'format' | 'minify' | 'unescape' | 'clear' | 'undo-unescape'
   *   onLoad(text, fileName)   — a file was read
   * }
   */
  constructor(panel, { onEdit, onPaste, onCommand, onLoad }) {
    this.panel = panel;
    this.onEdit = onEdit;
    this.onPaste = onPaste;
    this.onCommand = onCommand;
    this.onLoad = onLoad;

    this.input = panel.querySelector(".jh-input");
    this.gutter = panel.querySelector(".jh-gutter");
    this.gutterLines = panel.querySelector(".jh-gutter-lines");
    this.band = panel.querySelector(".jh-error-band");
    this.mark = panel.querySelector(".jh-error-mark");
    this.notice = panel.querySelector(".jh-notice");
    this.fileInput = panel.querySelector(".jh-file");

    this.lineCount = 1;
    this.error = null; // { line, column, offset, endOffset, x0, x1 } currently marked
    this.warnLines = new Map(); // line → its warnings' messages
    this.renderQueued = false;
    this.mirror = document.createElement("div");
    this.mirror.className = "jh-mirror";
    this.mirror.setAttribute("aria-hidden", "true");
    this.input.parentElement.append(this.mirror);

    this.bindEvents();
    this.measureMetrics();
    this.recountLines();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get text() {
    return this.input.value;
  }

  /** Replace the whole text (Format, Minify, Unescape, Undo, Clear, Load). */
  setText(text) {
    this.input.value = text;
    this.input.scrollTop = 0;
    this.input.scrollLeft = 0;
    this.clearError();
    this.recountLines();
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }

  /** Mark a parse error: gutter line, a band across the line, the bad token underlined. */
  showError(err) {
    const end = Math.max(err.endOffset, err.offset + 1);
    const { x0, x1 } = this.measure(err.offset - (err.column - 1), err.offset, end);
    this.error = { line: err.line, column: err.column, offset: err.offset, endOffset: end, x0, x1 };
    this.scheduleRender();
  }

  clearError() {
    this.error = null;
    this.band.hidden = true;
    this.mark.hidden = true;
    this.scheduleRender();
  }

  /** Mark the lines that have warnings in the gutter; a tooltip says what they are. */
  setWarnings(warnings) {
    this.warnLines = new Map();
    for (const w of warnings) {
      const list = this.warnLines.get(w.line);
      if (list) list.push(w.message);
      else this.warnLines.set(w.line, [w.message]);
    }
    this.scheduleRender();
  }

  clearWarnings() {
    if (this.warnLines.size > 0) this.setWarnings([]);
  }

  /**
   * Select [start, end), leave the caret on `start`, and scroll it into view.
   * `line` and `column` (1-based) save a count through the text when known.
   */
  jumpTo(start, end, line, column) {
    const text = this.input.value;
    if (line === undefined) ({ line, column } = lineColumnAt(text, start));
    const { x0: x } = this.measure(start - (column - 1), start, start + 1);
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(start, Math.max(end, start), "backward");
    const scroll = () => {
      const ta = this.input;
      const top = this.padTop + (line - 1) * this.lineHeight;
      if (top < ta.scrollTop || top + this.lineHeight > ta.scrollTop + ta.clientHeight) {
        ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      }
      if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 48) {
        ta.scrollLeft = Math.max(0, x - ta.clientWidth / 3);
      }
      this.renderNow();
    };
    // The browser may scroll the selection's far end into view on its own
    // after this frame; scroll again once it has, so our position wins.
    scroll();
    requestAnimationFrame(scroll);
  }

  /** The notice under the toolbar; `undo` shows its Undo link. */
  showNotice(message, { undo = true } = {}) {
    this.notice.querySelector(".jh-notice-text").textContent = message;
    this.notice.querySelector('[data-action="undo-unescape"]').hidden = !undo;
    this.notice.hidden = false;
  }

  hideNotice() {
    this.notice.hidden = true;
  }

  get noticeVisible() {
    return !this.notice.hidden;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  bindEvents() {
    this.input.addEventListener("input", (e) => {
      this.recountLines();
      this.onEdit(this.input.value, { paste: e.inputType === "insertFromPaste" });
    });

    this.input.addEventListener("paste", (e) => {
      const pasted = e.clipboardData?.getData("text/plain") ?? "";
      if (pasted === "") return;
      const ta = this.input;
      const replacesAll = ta.value.length === 0 || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
      if (this.onPaste(pasted, replacesAll)) e.preventDefault();
    });

    this.input.addEventListener("scroll", () => this.scheduleRender());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.onCommand("format");
      }
    });

    this.panel.addEventListener("click", (e) => {
      const button = e.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "copy") this.copy(button);
      else if (action === "open") this.fileInput.click();
      else if (action === "dismiss-notice") this.hideNotice();
      else this.onCommand(action);
    });

    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (!file) return;
      let text = await file.text();
      // A byte order mark is not JSON; strip it rather than report it.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      this.onLoad(text, file.name);
    });

    new ResizeObserver(() => this.scheduleRender()).observe(this.input);
  }

  async copy(button) {
    if (await copyText(this.input.value)) flashButton(button);
    else flashButton(button, "Copy failed");
  }

  // ── Gutter and error marker ──────────────────────────────────────────────

  measureMetrics() {
    const style = getComputedStyle(this.input);
    this.lineHeight = parseFloat(style.lineHeight) || 20;
    this.padTop = parseFloat(style.paddingTop) || 0;
    this.padLeft = parseFloat(style.paddingLeft) || 0;
    this.charWidth = this.measure(0, 0, 1, "0").x1;
  }

  /**
   * Pixel x (from the start of its line) of [offset, end) on the line that
   * starts at lineStart, laid out by the browser exactly as the textarea lays
   * it out. `sample` replaces the text, for measuring a character width.
   */
  measure(lineStart, offset, end, sample = null) {
    const text = this.input.value;
    let stop = Math.min(end, text.length);
    const newline = text.indexOf("\n", offset);
    if (newline !== -1 && newline < stop) stop = newline;
    const token = document.createElement("span");
    token.textContent = sample ?? (text.slice(offset, stop) || " ");
    this.mirror.replaceChildren(sample === null ? text.slice(lineStart, offset) : "", token);
    const base = this.mirror.getBoundingClientRect().left;
    const box = token.getBoundingClientRect();
    this.mirror.replaceChildren();
    return { x0: box.left - base, x1: box.right - base };
  }

  recountLines() {
    const text = this.input.value;
    let count = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++;
    this.lineCount = count;
    this.gutter.style.width = `calc(${String(count).length}ch + 26px)`;
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  renderNow() {
    const ta = this.input;
    const lh = this.lineHeight;
    const first = Math.max(0, Math.floor((ta.scrollTop - this.padTop) / lh));
    const visible = Math.ceil(ta.clientHeight / lh) + 2;
    const last = Math.min(this.lineCount, first + visible);
    const errorLine = this.error?.line ?? -1;

    let html = "";
    for (let n = first + 1; n <= last; n++) {
      const warned = this.warnLines.get(n);
      if (n === errorLine) html += `<div class="jh-gutter-line jh-gutter-line--error">${n}</div>`;
      else if (warned) html += `<div class="jh-gutter-line jh-gutter-line--warn" title="${escapeHtml(tooltip(warned))}">${n}</div>`;
      else html += `<div class="jh-gutter-line">${n}</div>`;
    }
    this.gutterLines.innerHTML = html;
    this.gutterLines.style.transform = `translateY(${this.padTop + first * lh - ta.scrollTop}px)`;

    this.positionErrorMarker();
  }

  positionErrorMarker() {
    const err = this.error;
    if (!err) return;
    const ta = this.input;
    const top = this.padTop + (err.line - 1) * this.lineHeight - ta.scrollTop;
    const onScreen = top > -this.lineHeight && top < ta.clientHeight;
    this.band.hidden = !onScreen;
    this.mark.hidden = !onScreen;
    if (!onScreen) return;
    this.band.style.top = `${top}px`;
    this.mark.style.top = `${top}px`;
    this.mark.style.left = `${this.padLeft + err.x0 - ta.scrollLeft}px`;
    this.mark.style.width = `${Math.max(err.x1 - err.x0, this.charWidth)}px`;
  }
}

/** A line's warnings, one per tooltip line. */
function tooltip(messages) {
  const shown = messages.slice(0, TOOLTIP_WARNINGS).map((m) => `⚠ ${m}`);
  if (messages.length > TOOLTIP_WARNINGS) shown.push(`and ${formatCount(messages.length - TOOLTIP_WARNINGS)} more on this line`);
  return shown.join("\n");
}

/** 1-based line and column of an offset (counts newlines before it). */
export function lineColumnAt(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}
