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
 * of the current text. A summary when it is valid; the error, its hint and
 * the links that jump to it when it is not.
 */

import { escapeHtml, formatBytes, formatCount, plural } from "./util.js";

export class StatusBar {
  /**
   * @param el        the <footer class="jh-status">
   * @param callbacks {
   *   onJump(start, end, line, column) — put the caret on a position in the text
   *   onValidate()                     — validate now (for large inputs)
   * }
   */
  constructor(el, { onJump, onValidate }) {
    this.el = el;
    this.onJump = onJump;
    this.onValidate = onValidate;
    this.targets = new Map(); // data-jump id → { start, end, line, column }

    el.addEventListener("click", (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        const t = this.targets.get(jump.dataset.jump);
        if (t) this.onJump(t.start, t.end, t.line, t.column);
        return;
      }
      if (e.target.closest("[data-validate]")) this.onValidate();
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

  /** "Valid JSON — 1,284 keys, depth 7, 2.1 MB", plus any duplicate-key warnings. */
  valid({ stats, warnings }, bytes, rootKind) {
    this.targets.clear();
    const summary =
      rootKind === "object" || rootKind === "array"
        ? `Valid JSON — ${plural(stats.keys, "key")}, depth ${formatCount(stats.depth)}, ${formatBytes(bytes)}`
        : `Valid JSON — a single ${rootKind} value, ${formatBytes(bytes)}`;
    let html = `<span class="jh-status-main">${escapeHtml(summary)}</span>`;
    if (warnings.length > 0) {
      const w = warnings[0];
      this.targets.set("warning", { start: w.offset, end: w.endOffset, line: w.line, column: w.column });
      const more = warnings.length > 1 ? ` (+${formatCount(warnings.length - 1)} more)` : "";
      html +=
        `<span class="jh-status-warn">⚠ ${escapeHtml(plural(warnings.length, "duplicate key"))}: ` +
        `<button type="button" class="jh-link" data-jump="warning">line ${w.line}, col ${w.column}: ${escapeHtml(w.message)}</button>` +
        `${escapeHtml(more)}</span>`;
    }
    this.render("valid", html);
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
}
