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
 * status-bar.js — parse timing, document size and the cursor position; and
 * a note when something needs saying (an image that could not be added,
 * a copy that worked, a document too big to keep).
 */

const NOTE_MS = 6000;

export class StatusBar {
  constructor({ parse, doc, cursor, note }) {
    this.parseEl = parse;
    this.docEl = doc;
    this.cursorEl = cursor;
    this.noteEl = note;
    this.timer = 0;
    this.lasting = "";
  }

  // A note that clears itself after a few seconds. `warn` colours it as a
  // problem.
  note(text, { warn = false } = {}) {
    clearTimeout(this.timer);
    this.show(text, warn);
    this.timer = setTimeout(() => this.show(this.lasting, Boolean(this.lasting)), NOTE_MS);
  }

  // A warning that stays until it is withdrawn with an empty `text`.
  warning(text) {
    if (text === this.lasting) return;
    this.lasting = text;
    clearTimeout(this.timer);
    this.show(text, true);
  }

  show(text, warn) {
    this.noteEl.textContent = text;
    this.noteEl.classList.toggle("mh-status-note--warn", warn && Boolean(text));
  }

  // `stats` is what reparse() filled in; `ms` the parse + render time.
  parsed(stats, ms, ast) {
    let how;
    if (stats.mode === "incremental") how = `Reparsed lines ${stats.fromLine}–${stats.toLine}`;
    else if (stats.mode === "unchanged") how = "Unchanged";
    else how = "Parsed";
    this.parseEl.textContent = `${how} · ${ms < 1 ? "<1" : Math.round(ms)} ms`;

    const blocks = ast.children ? ast.children.length : 0;
    const lines = ast.pos.end.line;
    const words = (ast.source.match(/\S+/g) ?? []).length;
    this.docEl.textContent = `${plural(lines, "line")} · ${plural(words, "word")} · ${plural(blocks, "block")}`;
  }

  cursor({ line, column }) {
    this.cursorEl.textContent = `Ln ${line}, Col ${column}`;
  }
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
