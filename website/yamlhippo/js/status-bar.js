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
 * status-bar.js — the bar along the bottom (yh-status): what the parser made
 * of the current text. A summary when it is valid, with the count of any
 * warnings and a link to the first; the error, its hint and the links that
 * jump to it when it is not.
 */

import { escapeHtml, formatBytes, formatCount, plural } from "./util.js";

const WARN_ICON = '<svg class="yh-icon" aria-hidden="true"><use href="#yh-i-warn"/></svg>';

export class StatusBar {
  /**
   * @param el        the <footer class="yh-status">
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
    this.el.className = `yh-status${state ? ` yh-status--${state}` : ""}`;
    this.el.innerHTML = html;
  }

  idle(message = "Paste YAML, type it, or load a file.") {
    this.targets.clear();
    this.render(null, `<span class="yh-status-main">${escapeHtml(message)}</span>`);
  }

  busy(message) {
    this.render("busy", `<span class="yh-status-main">${escapeHtml(message)}</span>`);
  }

  /** Live validation is off for inputs this big; offer to run it. */
  paused(bytes) {
    this.targets.clear();
    this.render(
      null,
      `<span class="yh-status-main">Large input (${formatBytes(bytes)}): live validation is paused while you type.</span>` +
        `<button type="button" class="yh-link" data-validate>Validate now</button>`,
    );
  }

  /**
   * "Valid YAML — 1,284 keys, depth 7, 2.1 MB" (and "3 documents" for a
   * stream), then "⚠ 3 warnings" (which opens the list) and the first
   * warning as a link to it.
   */
  valid({ stats, warnings, warningTotal, documents }, bytes, { listOpen = false } = {}) {
    this.targets.clear();
    const rootKind = documents[0].ast.kind;
    const docs = documents.length > 1 ? `${plural(documents.length, "document")}, ` : "";
    const summary =
      documents.length > 1 || stats.depth > 0
        ? `Valid YAML — ${docs}${plural(stats.keys, "key")}, depth ${formatCount(stats.depth)}, ${formatBytes(bytes)}`
        : `Valid YAML — a single ${rootKind === "alias" ? "value" : rootKind} value, ${formatBytes(bytes)}`;
    let html = `<span class="yh-status-main">${escapeHtml(summary)}</span>`;
    if (warningTotal > 0) {
      const w = warnings[0];
      this.targets.set("warning", { start: w.offset, end: w.endOffset, line: w.line, column: w.column });
      html +=
        `<span class="yh-status-warn">` +
        `<button type="button" class="yh-status-warn-count" data-warnings aria-controls="yh-warnings" aria-expanded="${listOpen}" title="List every warning">` +
        `${WARN_ICON}${escapeHtml(plural(warningTotal, "warning"))}</button>` +
        `<button type="button" class="yh-link" data-jump="warning" title="Go to this warning">line ${w.line}, col ${w.column}: ${escapeHtml(w.message)}</button>` +
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
      `<button type="button" class="yh-status-error" data-jump="error" title="Go to the error">${escapeHtml(err.toString())}</button>`;
    if (err.hint) html += `<span class="yh-status-hint">${escapeHtml(err.hint)}</span>`;
    // Most errors know a second place that explains them: the '[' never
    // closed, the quote that opened the string, the siblings the
    // indentation disagrees with.
    if (err.opener) {
      const o = err.opener;
      this.targets.set("opener", { start: o.offset, end: o.offset + 1, line: o.line, column: o.column });
      html += `<button type="button" class="yh-link" data-jump="opener">${escapeHtml(openerLabel(err))} (line ${o.line}, col ${o.column})</button>`;
    }
    this.render("error", html);
  }

  // ── The Diff tab ─────────────────────────────────────────────────────────

  diffIdle(message) {
    this.idle(message);
  }

  diffMatch() {
    this.targets.clear();
    this.render("valid", '<span class="yh-status-main">Documents match</span><span>Same content — order aside.</span>');
  }

  /** "3 differences: 1 added, 1 missing, 1 changed" */
  diffSummary(text) {
    this.targets.clear();
    this.render("diff", `<span class="yh-status-main">${escapeHtml(text)}</span>`);
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
      html += `<button type="button" class="yh-status-error" data-jump="${side}" title="Go to the error">${label} — ${escapeHtml(err.toString())}</button>`;
      if (err.hint) html += `<span class="yh-status-hint">${escapeHtml(err.hint)}</span>`;
    }
    html += '<span class="yh-status-stale">Showing the last comparison until this is fixed.</span>';
    this.render("error", html);
  }
}

/** What the error's second position is, for its link. */
function openerLabel(err) {
  switch (err.code) {
    case "INDENT_MISMATCH":
      return "Go to the siblings";
    case "UNTERMINATED_STRING":
    case "BAD_ESCAPE":
      return "Go to the opening quote";
    case "MISMATCHED_CLOSE":
    case "UNCLOSED_CONTAINER":
    case "EXPECTED_COMMA_OR_CLOSE":
      return "Go to the opener";
    case "BAD_TAG":
      return "Go to the tag";
    case "MAPPING_VALUE_NOT_ALLOWED":
      return "Go to where the value starts";
    default:
      return "Go to the start of the block";
  }
}
