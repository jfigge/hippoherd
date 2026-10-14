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
 * debounce.js — run something once the user pauses.
 *
 * Nothing is parsed per keystroke. The edit pane's colours are brought up
 * to date when typing pauses for HIGHLIGHT_DELAY_MS — short, so a heading
 * marker turns heading-coloured almost as it is typed (the parse is
 * incremental, so this stays cheap) — and the preview re-renders after
 * RENDER_DELAY_MS. Autocomplete runs on its own faster path and waits for
 * neither (autocomplete.js).
 */

export const HIGHLIGHT_DELAY_MS = 150;
export const RENDER_DELAY_MS = 1000;

// A debounced `fn`: each call restarts the wait. `.flush()` runs a pending
// call now; `.cancel()` drops it.
export function debounce(fn, ms) {
  let timer = null;
  let pending = null;
  const debounced = (...args) => {
    pending = args;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  function run() {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  }
  debounced.flush = () => {
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return debounced;
}
