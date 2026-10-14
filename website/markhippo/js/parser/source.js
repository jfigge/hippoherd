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
 * source.js — the text being parsed, as lines with their offsets.
 *
 * Every position in the AST is { line, column, offset }: line and column are
 * 1-based (column counts UTF-16 code units, as an editor's does), offset is
 * the 0-based index into the source string. A node's `end` is EXCLUSIVE — the
 * position just after its last character — so a node covers
 * source.slice(pos.start.offset, pos.end.offset).
 */

const LINE_ENDING = /\r\n|\n|\r/g;

// Split into lines without their endings, remembering where each starts.
// A final line ending does not start another line to parse: "a\n" is one
// line, though `starts` has a second entry, for the empty line after it.
export function splitLines(text) {
  const lines = [];
  const starts = [];
  let last = 0;
  LINE_ENDING.lastIndex = 0;
  let m;
  while ((m = LINE_ENDING.exec(text)) !== null) {
    lines.push(text.slice(last, m.index));
    starts.push(last);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    lines.push(text.slice(last));
    starts.push(last);
  } else if (text.length > 0) {
    // The text ends with a line ending: the position after it is the start
    // of a line too (where an editor's cursor would be), though not one with
    // any content to parse.
    starts.push(last);
  }
  return { lines, starts };
}

// Turns offsets into positions and back, for one source.
export class Locator {
  constructor(text, starts) {
    this.text = text;
    this.starts = starts ?? splitLines(text).starts;
  }

  // Position of a 0-based offset. An offset past a line's end (on its line
  // ending) still belongs to that line.
  point(offset) {
    const starts = this.starts;
    if (starts.length === 0) return { line: 1, column: offset + 1, offset };
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1, offset };
  }

  // Position of a 1-based line and 1-based column.
  at(line, column) {
    const start = line - 1 < this.starts.length ? this.starts[line - 1] : this.text.length;
    return { line, column, offset: start + column - 1 };
  }

  lineStart(line) {
    return line - 1 < this.starts.length ? this.starts[line - 1] : this.text.length;
  }
}
