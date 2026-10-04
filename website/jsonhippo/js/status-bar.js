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
 * status-bar.js — the bar along the bottom (jh-status): what the parser made
 * of the current text. A summary when it is valid, with the count of any
 * warnings and a link to the first; the error, its hint and the links that
 * jump to it when it is not.
 */

import { escapeHtml, formatBytes, formatCount, plural } from "./util.js";

const WARN_ICON = '<svg class="jh-icon" aria-hidden="true"><use href="#jh-i-warn"/></svg>';

export class StatusBar {
  /**
   * @param el        the <footer class="jh-status">
   * @param callbacks {
   *   onJump(start, end, line, column) — put the caret on a position in the text
   *   onDiffJump(side, start, end)     — the same, in a Diff pane ('left' / 'right')
   *   onValidate()                     — validate now (for large inputs)
   *   onWarnings()                     — open or close the list of warnings
   * }
   */
  constructor(el, { onJump, onDiffJump, onValidate, onWarnings }) {
    this.el = el;
    this.onJump = onJump;
    this.onDiffJump = onDiffJump;
    this.onValidate = onValidate;
    this.onWarnings = onWarnings;
    this.targets = new Map(); // data-jump id → { start, end, line, column, side? }

    el.addEventListener("click", (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        const t = this.targets.get(jump.dataset.jump);
        if (t?.side) this.onDiffJump(t.side, t.start, t.end);
        else if (t) this.onJump(t.start, t.end, t.line, t.column);
        return;
      }
      if (e.target.closest("[data-validate]")) this.onValidate();
      else if (e.target.closest("[data-warnings]")) this.onWarnings();
    });
  }

  render(state, html) {
    this.el.className = `jh-status${state ? ` jh-status--${state}` : ""}`;
    this.el.innerHTML = html;
  }

  idle(message = "Paste JSON, type it, or load a file.") {
    this.targets.clear();
    this.render(null, `<span class="jh-status-main">${escapeHtml(message)}</span>`);
  }

  busy(message) {
    this.render("busy", `<span class="jh-status-main">${escapeHtml(message)}</span>`);
  }

  /** Live validation is off for inputs this big; offer to run it. */
  paused(bytes) {
    this.targets.clear();
    this.render(
      null,
      `<span class="jh-status-main">Large input (${formatBytes(bytes)}): live validation is paused while you type.</span>` +
        `<button type="button" class="jh-link" data-validate>Validate now</button>`,
    );
  }

  /**
   * "Valid JSON — 1,284 keys, depth 7, 2.1 MB", then "⚠ 3 warnings" (which
   * opens the list) and the first warning as a link to it.
   */
  valid({ stats, warnings, warningTotal }, bytes, rootKind, { listOpen = false } = {}) {
    this.targets.clear();
    const summary =
      rootKind === "object" || rootKind === "array"
        ? `Valid JSON — ${plural(stats.keys, "key")}, depth ${formatCount(stats.depth)}, ${formatBytes(bytes)}`
        : `Valid JSON — a single ${rootKind} value, ${formatBytes(bytes)}`;
    let html = `<span class="jh-status-main">${escapeHtml(summary)}</span>`;
    if (warningTotal > 0) {
      const w = warnings[0];
      this.targets.set("warning", { start: w.offset, end: w.endOffset, line: w.line, column: w.column });
      html +=
        `<span class="jh-status-warn">` +
        `<button type="button" class="jh-status-warn-count" data-warnings aria-controls="jh-warnings" aria-expanded="${listOpen}" title="List every warning">` +
        `${WARN_ICON}${escapeHtml(plural(warningTotal, "warning"))}</button>` +
        `<button type="button" class="jh-link" data-jump="warning" title="Go to this warning">line ${w.line}, col ${w.column}: ${escapeHtml(w.message)}</button>` +
        "</span>";
    }
    this.render("valid", html);
  }

  /** Keep the count's aria-expanded in step with the list. */
  warningsExpanded(open) {
    this.el.querySelector("[data-warnings]")?.setAttribute("aria-expanded", String(open));
  }

  error(err) {
    this.targets.clear();
    this.targets.set("error", { start: err.offset, end: err.endOffset, line: err.line, column: err.column });
    let html =
      `<button type="button" class="jh-status-error" data-jump="error" title="Go to the error">${escapeHtml(err.toString())}</button>`;
    if (err.hint) html += `<span class="jh-status-hint">${escapeHtml(err.hint)}</span>`;
    // MISMATCHED_CLOSE and UNCLOSED_CONTAINER know which '{' or '[' is involved.
    if (err.opener) {
      const o = err.opener;
      this.targets.set("opener", { start: o.offset, end: o.offset + 1, line: o.line, column: o.column });
      html += `<button type="button" class="jh-link" data-jump="opener">Go to the opener (line ${o.line}, col ${o.column})</button>`;
    }
    this.render("error", html);
  }

  // ── The Diff tab ─────────────────────────────────────────────────────────

  diffIdle(message) {
    this.idle(message);
  }

  diffMatch() {
    this.targets.clear();
    this.render("valid", '<span class="jh-status-main">Documents match</span><span>Same content — order aside.</span>');
  }

  /** "3 differences: 1 added, 1 missing, 1 changed" */
  diffSummary(text) {
    this.targets.clear();
    this.render("diff", `<span class="jh-status-main">${escapeHtml(text)}</span>`);
  }

  /** A parse error in one or both panes; the last good comparison stays on screen. */
  diffErrors(errors) {
    this.targets.clear();
    let html = "";
    for (const side of ["left", "right"]) {
      const err = errors[side];
      if (!err) continue;
      this.targets.set(side, { side, start: err.offset, end: err.endOffset });
      const label = side === "left" ? "Left" : "Right";
      html += `<button type="button" class="jh-status-error" data-jump="${side}" title="Go to the error">${label} — ${escapeHtml(err.toString())}</button>`;
      if (err.hint) html += `<span class="jh-status-hint">${escapeHtml(err.hint)}</span>`;
    }
    html += '<span class="jh-status-stale">Showing the last comparison until this is fixed.</span>';
    this.render("error", html);
  }
}
