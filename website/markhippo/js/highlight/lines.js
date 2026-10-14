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
 * lines.js — highlight segments by line, for the edit pane.
 *
 * The edit pane draws its colouring one line at a time, so that a keystroke
 * redraws only the lines it touched. Its model is an array with one entry
 * per line (lines split on "\n" — the only line ending a <textarea> has):
 * that line's segments, [from, to, className], with offsets relative to the
 * line's start.
 *
 * Between parses, edits are mapped onto the existing colouring (mapEdit)
 * so the text never drifts from its colours; the next parse then makes it
 * exact.
 */

// Document segments (highlight.js) → segments per line.
export function splitByLine(text, segments) {
  const lines = [];
  let k = 0;
  let start = 0;
  for (;;) {
    let end = text.indexOf("\n", start);
    const last = end === -1;
    if (last) end = text.length;
    lines.push(clip(segments, k, start, end));
    while (k < segments.length && segments[k][1] <= end) k++;
    if (last) break;
    start = end + 1;
  }
  return lines;
}

// The segments from index k on that fall in [start, end), relative to start.
function clip(segments, k, start, end) {
  const out = [];
  for (; k < segments.length && segments[k][0] < end; k++) {
    const from = Math.max(segments[k][0], start);
    const to = Math.min(segments[k][1], end);
    if (to > from) out.push([from - start, to - start, segments[k][2]]);
  }
  return out;
}

// Where two texts differ: old[from, oldTo) became text[from, newTo).
export function diffText(old, text) {
  let from = 0;
  const max = Math.min(old.length, text.length);
  while (from < max && old.charCodeAt(from) === text.charCodeAt(from)) from++;
  let oldTo = old.length;
  let newTo = text.length;
  while (oldTo > from && newTo > from && old.charCodeAt(oldTo - 1) === text.charCodeAt(newTo - 1)) {
    oldTo--;
    newTo--;
  }
  return { from, oldTo, newTo };
}

// Where the line holding `offset` starts. (Not lastIndexOf("\n", offset - 1)
// alone: at offset 0 that looks at index 0, and finds a leading "\n".)
export function lineStartAt(text, offset) {
  return offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

// The 0-based line `offset` is on.
export function lineOf(text, offset) {
  let line = 0;
  let i = text.indexOf("\n");
  while (i !== -1 && i < offset) {
    line++;
    i = text.indexOf("\n", i + 1);
  }
  return line;
}

// Carry the colouring of `lines` (for `old`) across the edit that made
// `text`. Answers the lines to replace — { first, removed, lines } — so the
// caller can splice: lines.splice(first, removed, ...lines).
//
// Colours stay with the characters they were on. Text typed inside a
// coloured stretch, or at its end, takes its colour (typing on at the end
// of a heading keeps it a heading); text that was deleted takes its colour
// with it. The next parse corrects anything the guess got wrong.
export function mapEdit(lines, old, text) {
  const { from, oldTo, newTo } = diffText(old, text);
  const first = lineOf(old, from);
  const lastOld = lineOf(old, oldTo);
  const lastNew = lineOf(text, newTo);
  const start = lineStartAt(old, from);

  const delta = newTo - oldTo;
  const extend = from === oldTo && text.slice(from, newTo).indexOf("\n") === -1;
  const map = (x, isEnd) => {
    if (x < from) return x;
    if (x === from) return isEnd && !extend ? from : newTo;
    if (x >= oldTo) return x + delta;
    return isEnd ? from : newTo;
  };

  // The affected lines' segments, as absolute offsets, mapped.
  const mapped = [];
  let lineStart = start;
  for (let k = first; k <= lastOld; k++) {
    for (const [f, t, c] of lines[k] ?? []) {
      const a = map(lineStart + f, false);
      const b = map(lineStart + t, true);
      if (b > a) mapped.push([a, b, c]);
    }
    lineStart = old.indexOf("\n", lineStart) + 1;
  }

  const out = [];
  lineStart = start;
  for (let k = first; k <= lastNew; k++) {
    let end = text.indexOf("\n", lineStart);
    if (end === -1) end = text.length;
    out.push(clip(mapped, 0, lineStart, end));
    lineStart = end + 1;
  }
  return { first, removed: lastOld - first + 1, lines: out };
}

export function sameSegments(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) return false;
  }
  return true;
}
