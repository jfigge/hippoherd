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
 * diff-view.js — the Diff tab: two editable panes compared semantically.
 *
 * Owns the two DiffPanes, the Reorder switch, previous/next navigation and a
 * DiffSession (diff/session.js), and re-compares DIFF_DEBOUNCE_MS after the
 * user stops typing — or at once after a paste, load, format, clear or a
 * change of the Reorder switch.
 *
 * A pane's content is laid out one value per line whenever it arrives whole
 * (carried over from the Text tab, pasted over everything, loaded, formatted),
 * because rows can only line up if members sit on lines of their own. Typing
 * is never reformatted.
 */

import { DiffSession, layOut, needsLayOut } from "./diff/session.js";
import { totalDifferences } from "./diff/json-diff.js";
import { detectAndFix } from "./smart-paste.js";
import { INDENTS } from "./yaml-emitter.js";
import { DiffPane } from "./diff-pane.js";
import { copyText, flashButton, formatCount, nextFrame, plural } from "./util.js";

/** Quiet time after the last keystroke before the panes are compared again. */
export const DIFF_DEBOUNCE_MS = 1500;

/** Above this many characters in the two panes, say "Comparing…" and let it paint first. */
const SHOW_BUSY_ABOVE = 512 * 1024;

export class DiffView {
  /**
   * @param panel     the Diff tab's <section>
   * @param options   { status: StatusBar, settings: Settings }
   */
  constructor(panel, { status, settings }) {
    this.panel = panel;
    this.status = status;
    this.settings = settings;
    this.session = new DiffSession();
    this.timer = null;
    this.state = null; // last compare's outcome
    this.undo = { left: null, right: null }; // text before a smart paste or Fix paste
    this.navIndex = -1;
    this.ticket = 0; // the latest compare asked for; older deferred ones give way

    this.reorder = [...panel.querySelectorAll('input[name="yh-reorder"]')]; // value: left | off | right
    this.count = panel.querySelector("#yh-diff-count");
    this.prev = panel.querySelector("#yh-diff-prev");
    this.next = panel.querySelector("#yh-diff-next");
    this.fileInput = panel.querySelector("#yh-diff-file");
    this.fileSide = "left";

    this.panes = {};
    for (const side of ["left", "right"]) {
      const other = side === "left" ? "right" : "left";
      this.panes[side] = new DiffPane(panel.querySelector(`.yh-diff-pane[data-side="${side}"]`), {
        side,
        onEdit: () => this.edited(side),
        onPasteWhole: (text) => this.pasteWhole(side, text),
        onCommand: (name, button) => this.command(side, name, button),
        onScroll: (top) => this.panes[other].scrollTo(top),
        indentFor: (row) => this.panes[other].model.indentOf(row),
      });
    }

    this.bindEvents();
    this.updateReorder();
  }

  get indent() {
    return INDENTS[this.settings.indent];
  }

  // ── Entering and leaving the tab ─────────────────────────────────────────

  /**
   * Switching to Diff: the single editor's text becomes the Left pane — as
   * it is. Block YAML is already one entry per line, which is what the
   * alignment needs; only JSON-style flow text is laid out (see needsLayOut).
   */
  enter(text) {
    this.panes.left.setText(needsLayOut(text) ? layOut(text, this.indent) : text);
    this.panes.left.hideNotice();
    this.compareNow();
  }

  /** Switching away: Text and Tree carry on with the Left pane's text. */
  leave() {
    clearTimeout(this.timer);
    this.timer = null;
    return this.panes.left.text;
  }

  // ── Comparing ────────────────────────────────────────────────────────────

  edited(side) {
    this.undo[side] = null;
    this.panes[side].hideNotice();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compareNow(), DIFF_DEBOUNCE_MS);
  }

  compareNow() {
    clearTimeout(this.timer);
    this.timer = null;
    const ticket = ++this.ticket;
    const { left, right } = this.panes;
    if (left.model.raw.length + right.model.raw.length > SHOW_BUSY_ABOVE) {
      this.status.busy("Comparing…");
      nextFrame().then(() => {
        if (ticket === this.ticket) this.runCompare();
      });
      return;
    }
    this.runCompare();
  }

  runCompare() {
    const { left, right } = this.panes;
    const out = this.session.compare({ left: left.text, right: right.text }, { indent: this.indent });
    this.state = out;

    if (out.state === "ok") {
      const { rows, classes } = out.result;
      left.applyLayout(out.texts.left, rows.map((r) => r[0]), classes.left);
      right.applyLayout(out.texts.right, rows.map((r) => r[1]), classes.right);
      left.clearError();
      right.clearError();
      if (out.result.equal) this.status.diffMatch();
      else this.status.diffSummary(DiffView.summary(out.result.counts));
    } else if (out.state === "error") {
      // Keep the last good layout and highlights; just point at the errors.
      for (const side of ["left", "right"]) {
        if (out.errors[side]) this.panes[side].showError(out.errors[side]);
        else this.panes[side].clearError();
      }
      this.status.diffErrors(out.errors);
    } else {
      left.plain();
      right.plain();
      left.clearError();
      right.clearError();
      const which = out.empty.left && out.empty.right ? "either pane" : out.empty.left ? "the Left pane" : "the Right pane";
      this.status.diffIdle(`Paste, type or load YAML into ${which} to compare.`);
    }
    this.navIndex = -1;
    this.updateNav();
  }

  // ── Pane actions ─────────────────────────────────────────────────────────

  /** A paste over the whole pane: smart-paste fixes, and JSON-style text laid out. */
  pasteWhole(side, pasted) {
    const pane = this.panes[side];
    const fixed = this.settings.autoFix ? detectAndFix(pasted) : null;
    if (fixed) {
      pane.setText(needsLayOut(fixed.text) ? layOut(fixed.text, this.indent) : fixed.text);
      pane.showNotice(fixNotice(fixed), true);
      this.undo[side] = pasted;
      this.compareNow();
      return true;
    }
    if (!needsLayOut(pasted)) return false; // let the browser paste it
    const laidOut = layOut(pasted, this.indent);
    if (laidOut === pasted) return false; // invalid (or already laid out): let the browser paste it
    pane.setText(laidOut);
    pane.hideNotice();
    this.compareNow();
    return true;
  }

  command(side, name, button) {
    const pane = this.panes[side];
    switch (name) {
      case "format":
        pane.setText(layOut(pane.text, this.indent));
        this.compareNow();
        break;
      case "fix": {
        const result = detectAndFix(pane.text);
        if (!result) {
          pane.showNotice("Nothing to fix: no tabs, curly quotes or stray indentation found.", false);
          break;
        }
        this.undo[side] = pane.text;
        pane.setText(result.text);
        pane.showNotice(fixNotice(result), true);
        this.compareNow();
        break;
      }
      case "undo":
        if (this.undo[side] !== null) {
          pane.setText(this.undo[side]);
          this.undo[side] = null;
          pane.hideNotice();
          this.compareNow();
        }
        break;
      case "dismiss":
        pane.hideNotice();
        break;
      case "copy":
        copyText(pane.text).then((ok) => flashButton(button, ok ? "Copied" : "Copy failed"));
        break;
      case "clear":
        pane.setText("");
        pane.hideNotice();
        this.compareNow();
        pane.focus();
        break;
      case "open":
        this.fileSide = side;
        this.fileInput.click();
        break;
    }
  }

  // ── Reorder switch and navigation ────────────────────────────────────────

  setMode(mode) {
    this.session.setMode(mode);
    this.updateReorder();
    this.compareNow();
  }

  updateReorder() {
    for (const option of this.reorder) option.checked = option.value === this.session.mode;
  }

  /**
   * Rows where a difference starts. The panes are aligned row for row, so a
   * row counts if either pane marks it; a run of marked rows is one stop.
   */
  differenceRows() {
    const { left, right } = this.panes;
    const n = Math.max(left.rowCount, right.rowCount);
    const marked = (r) => left.isMarked(r) || right.isMarked(r);
    const out = [];
    for (let r = 0; r < n; r++) if (marked(r) && !(r > 0 && marked(r - 1))) out.push(r);
    return out;
  }

  /**
   * The count is the number of differences. Stepping goes by stops — runs of
   * marked rows — which can be more: at Off, a changed field in a reordered
   * array is on a different row in each pane, so it is two stops.
   */
  updateNav() {
    const stops = this.state?.state === "ok" || this.state?.stale ? this.differenceRows().length : 0;
    this.prev.disabled = stops === 0;
    this.next.disabled = stops === 0;
    const result = this.state?.result;
    if (this.state?.state === "ok" && result.equal) this.count.textContent = "Documents match";
    else if (this.navIndex >= 0 && stops > 0) this.count.textContent = `${formatCount(this.navIndex + 1)} / ${formatCount(stops)}`;
    else if (result && !result.equal) this.count.textContent = plural(totalDifferences(result.counts), "difference");
    else this.count.textContent = "";
  }

  step(delta) {
    const rows = this.differenceRows();
    if (rows.length === 0) return;
    this.navIndex = this.navIndex < 0 ? (delta > 0 ? 0 : rows.length - 1) : (this.navIndex + delta + rows.length) % rows.length;
    const row = rows[this.navIndex];
    for (const pane of Object.values(this.panes)) pane.scrollToRow(row);
    // The caret goes where the difference is real text.
    const target = this.panes.left.model.isFiller(row) ? this.panes.right : this.panes.left;
    target.caretToRow(row);
    this.updateNav();
  }

  bindEvents() {
    for (const option of this.reorder) {
      option.addEventListener("change", () => this.setMode(option.value));
    }
    this.prev.addEventListener("click", () => this.step(-1));
    this.next.addEventListener("click", () => this.step(1));
    this.panel.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        this.step(e.key === "ArrowDown" ? 1 : -1);
      }
    });

    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (!file) return;
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const pane = this.panes[this.fileSide];
      pane.setText(needsLayOut(text) ? layOut(text, this.indent) : text);
      pane.hideNotice();
      this.compareNow();
    });
  }

  /** "3 differences: 1 added, 1 missing, 1 changed" */
  static summary(counts) {
    const parts = [];
    if (counts.added) parts.push(`${formatCount(counts.added)} added`);
    if (counts.missing) parts.push(`${formatCount(counts.missing)} missing`);
    if (counts.changed) parts.push(`${formatCount(counts.changed)} changed`);
    if (counts.type) parts.push(plural(counts.type, "type change"));
    return `${plural(totalDifferences(counts), "difference")}: ${parts.join(", ")}`;
  }
}

/** "Fixed: replaced 3 tabs …; straightened 2 curly quotes." */
export function fixNotice({ fixes }) {
  const text = fixes.map((f) => f.message).join("; ");
  return `Fixed: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}
