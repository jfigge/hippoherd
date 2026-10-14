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
 * Tables (GFM).
 *
 *   | Name  | Value |        a header row,
 *   | :---- | ----: |        a delimiter row (alignment from the colons),
 *   | alpha |   1   |        then rows, up to a blank line or the start of
 *                            another block.
 *
 * The header row is the last line of a paragraph — whatever came before it
 * stays a paragraph — and the delimiter row must have as many cells. Body
 * rows are cut or padded to the header's width. A pipe inside a cell is
 * written \| (even in a code span: the backslash goes before the cell's
 * inline content is parsed).
 *
 * Nodes: table { align: [null|"left"|"center"|"right"] } → table_row
 * { header } → table_cell { align, header }, each cell a leaf with inline
 * content mapped to its exact source.
 */

import { Node } from "../../parser/nodes.js";
import { extractReferences } from "../commonmark/blocks/paragraph.js";

const reDelimiterRow = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// What starts another block, ending a table (GFM: "the beginning of
// another block-level structure").
const reOtherBlock = /^(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|[-+*][ \t]|[0-9]{1,9}[.)][ \t])/;

// Split one row's text into cells. Each cell: { from, to } (its trimmed
// extent in `text`), and `content` with `map`, pieces [contentIndex,
// textIndex] — a \| loses its backslash, so content and text drift apart.
export function splitRow(text) {
  const cells = [];
  let i = 0;
  while (text[i] === " " || text[i] === "\t") i++;
  if (text[i] === "|") i++;
  let cell = { start: i, content: "", map: [[0, i]] };
  let sawPipeEnd = false;
  const close = (end) => {
    let from = cell.start;
    let to = end;
    while (from < to && (text[from] === " " || text[from] === "\t")) from++;
    while (to > from && (text[to - 1] === " " || text[to - 1] === "\t")) to--;
    cells.push({ from, to, content: cell.content, map: cell.map, start: cell.start });
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      // From here on, content is one character behind the text.
      cell.map.push([cell.content.length, i + 1]);
      cell.content += "|";
      i += 2;
    } else if (ch === "\\" && i + 1 < text.length) {
      cell.content += ch + text[i + 1];
      i += 2;
    } else if (ch === "|") {
      close(i);
      i++;
      cell = { start: i, content: "", map: [[0, i]] };
      sawPipeEnd = true;
    } else {
      cell.content += ch;
      i++;
      sawPipeEnd = false;
    }
  }
  // A trailing pipe ends the row; what follows it is not a cell.
  if (!(sawPipeEnd && cell.content.trim() === "")) close(text.length);
  return cells;
}

function alignOf(cell) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

// A row node for `text`, which starts at source offset `base`.
function rowNode(parser, text, base, line, align, header) {
  const row = new Node("table_row", { header });
  row._s = base;
  row._e = base + text.replace(/[ \t]+$/, "").length;
  row._line = line;
  row._open = false;
  const cells = splitRow(text);
  for (let k = 0; k < align.length; k++) {
    const c = cells[k];
    const cell = new Node("table_cell", { align: align[k], header });
    cell._line = line;
    cell._open = false;
    cell._base = 0;
    if (c) {
      cell._s = base + c.from;
      cell._e = base + c.to;
      cell._content = c.content;
      // Content index → source offset; a pinned-less segment per piece.
      cell._segments = c.map.map(([ci, ti], n) => {
        const nextText = n + 1 < c.map.length ? c.map[n + 1][1] - 1 : c.to;
        return [ci, base + ti, false, base + Math.max(ti, nextText)];
      });
    } else {
      // A missing cell: empty, at the end of the row.
      cell._s = cell._e = row._e;
      cell._content = "";
      cell._segments = [[0, row._e, false, row._e]];
    }
    row.appendChild(cell);
  }
  return row;
}

// The text of the line being parsed from the current offset, and where in
// the source it starts.
function lineHere(parser) {
  return { text: parser.currentLine.slice(parser.offset), base: parser.offsetAt(parser.lineNumber, parser.offset) };
}

function tableStart(parser, container) {
  if (parser.indented || container.type !== "paragraph") return 0;
  const delimiter = parser.currentLine.slice(parser.nextNonspace);
  if (!reDelimiterRow.test(delimiter)) return 0;

  // The header is the paragraph's last line (after any definitions).
  extractReferences(parser, container);
  const content = container._content;
  if (content.length <= container._base) return 0;
  const body = content.slice(0, -1);
  const lastStart = Math.max(container._base, body.lastIndexOf("\n") + 1);
  const headerText = body.slice(lastStart);
  const hasPipe = /(^|[^\\])\|/.test(headerText) || delimiter.includes("|");
  const align = splitRow(delimiter).map((c) => alignOf(delimiter.slice(c.from, c.to)));
  if (!hasPipe || splitRow(headerText).length !== align.length) return 0;

  // Where the header line's text is in the source.
  const segs = container._segments;
  let k = segs.length - 1;
  while (k > 0 && (segs[k][0] > lastStart || segs[k][2])) k--;
  const headerBase = segs[k][1] + (lastStart - segs[k][0]);
  const headerLine = parser.lineNumber - 1;

  parser.closeUnmatchedBlocks();
  const table = new Node("table", { align });
  table._s = headerBase;
  table._line = headerLine;
  table._open = true;
  table._content = "";
  table._segments = [];
  table._base = 0;
  table._delimiterLine = parser.lineNumber;
  table.appendChild(rowNode(parser, headerText, headerBase, headerLine, align, true));

  // What came before the header stays a paragraph (if anything did).
  container.insertAfter(table);
  if (lastStart > container._base) {
    container._content = content.slice(0, lastStart);
    container._segments = segs.filter((s) => s[0] < lastStart);
    container._open = false;
    container._e = Math.max(container._s, lineEndBefore(parser, headerLine));
    parser.rule("paragraph").finalize(parser, container);
  } else {
    container.unlink();
  }
  parser.tip = table;
  parser.advanceOffset(parser.currentLine.length - parser.offset, false);
  return 2;
}

// The source offset where line `line - 1` ends (before its line ending).
function lineEndBefore(parser, line) {
  const prev = line - 1;
  const text = parser.lines[prev - 1] ?? "";
  return parser.offsetAt(prev, text.length);
}

export const table = {
  type: "table",
  starts: [{ start: tableStart, priority: 450, triggers: "|-:" }],
  continue(parser) {
    if (parser.blank) return 1;
    if (!parser.indented && reOtherBlock.test(parser.currentLine.slice(parser.nextNonspace))) return 1;
    return 0;
  },
  finalize() {},
  canContain: () => false,
  acceptsLines: true,
  // Each line, once added: the delimiter row is skipped, the rest are rows.
  lineAdded(parser, block) {
    if (parser.lineNumber === block._delimiterLine) return false;
    const { text, base } = lineHere(parser);
    block.appendChild(rowNode(parser, text, base, parser.lineNumber, block.align, false));
    return false;
  },
};

export const tableRow = {
  type: "table_row",
  continue: () => 1,
  finalize() {},
  canContain: () => false,
  acceptsLines: false,
};

export const tableCell = {
  type: "table_cell",
  continue: () => 1,
  finalize() {},
  canContain: () => false,
  acceptsLines: false,
  inlineContent: true,
};
