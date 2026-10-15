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
 * warnings-view.js — the list of lint warnings, above the status bar.
 *
 * The status bar gives the count and the first warning; this is every one of
 * them (up to the linter's cap), each a button that puts the caret on it in
 * the Text tab. It opens from the count in the status bar and closes when
 * there is nothing left to list.
 */

import { escapeHtml, formatCount, plural } from "./util.js";

export class WarningsView {
  /**
   * @param el        the <section class="yh-warnings">
   * @param callbacks {
   *   onJump(warning)  — go to a warning in the Text tab
   *   onChange(open)   — the list opened or closed
   * }
   */
  constructor(el, { onJump, onChange }) {
    this.el = el;
    this.title = el.querySelector(".yh-warnings-title");
    this.list = el.querySelector(".yh-warnings-list");
    this.onJump = onJump;
    this.onChange = onChange;
    this.warnings = [];
    this.total = 0;
    this.rendered = false;

    el.addEventListener("click", (e) => {
      const row = e.target.closest("[data-warning]");
      if (row) this.onJump(this.warnings[Number(row.dataset.warning)]);
      else if (e.target.closest('[data-warnings="close"]')) this.toggle(false);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggle(false);
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  /** A new parse: these are the warnings now. Closes the list when there are none. */
  update(warnings, total) {
    this.warnings = warnings;
    this.total = total;
    this.rendered = false;
    this.el.classList.remove("yh-warnings--stale");
    if (total === 0) this.toggle(false);
    else if (this.isOpen) this.render();
  }

  /** The text changed: the positions in the list are out of date until the next parse. */
  markStale() {
    if (this.isOpen) this.el.classList.add("yh-warnings--stale");
  }

  /** Open or close the list (flip it when `open` is not given). Returns whether it is open. */
  toggle(open = !this.isOpen) {
    if (open && this.total === 0) open = false;
    if (open && !this.rendered) this.render();
    if (open !== this.isOpen) {
      this.el.hidden = !open;
      this.onChange(open);
    }
    return open;
  }

  render() {
    this.rendered = true;
    this.title.textContent =
      this.warnings.length < this.total
        ? `The first ${formatCount(this.warnings.length)} of ${formatCount(this.total)} warnings`
        : plural(this.total, "warning");
    let html = "";
    this.warnings.forEach((w, i) => {
      html +=
        `<li><button type="button" class="yh-warning" data-warning="${i}">` +
        `<span class="yh-warning-where">line ${w.line}, col ${w.column}</span>` +
        `<span class="yh-warning-label">${escapeHtml(w.label)}</span>` +
        `<span class="yh-warning-message">${escapeHtml(w.message)}</span>` +
        `<code class="yh-warning-path">${escapeHtml(w.path)}</code>` +
        "</button></li>";
    });
    this.list.innerHTML = html;
  }
}
