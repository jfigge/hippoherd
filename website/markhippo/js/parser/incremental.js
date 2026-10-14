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
 * incremental.js — reparse only the part of a document an edit touched.
 *
 * Top-level blocks separated by blank lines are independent parse units:
 * the block parser enters each one with nothing open. So an edit is
 * reparsed as one REGION of whole top-level blocks —
 *
 *   - the blocks the edit touches,
 *   - plus one untouched block either side, so that an edit which merges
 *     with a neighbour (deleting the blank line between two paragraphs, say)
 *     is seen,
 *   - widened until both edges fall on blank lines between blocks,
 *
 * — and the result spliced in place of the old blocks, with everything after
 * it shifted. The region is parsed with the document's existing link
 * definitions, since links in it may use definitions from anywhere.
 *
 * The answer must always equal a full parse of the new text, so whenever
 * that cannot be guaranteed it falls back to one:
 *
 *   - the document is small (a full parse is cheap anyway);
 *   - the region's link reference definitions changed (they are global);
 *   - the untouched block at either edge of the region did not reparse to
 *     exactly what it was — a sign the edit reaches past the region (an
 *     unclosed fence now swallowing what follows, for instance).
 */

import { parse, parseWith, sanitize } from "./index.js";
import { Locator, splitLines } from "./source.js";

const DEFAULT_MIN_LINES = 1000;

// Reparse `prev` (an AST from parse()) for the new `text`. `options`:
//   minLines  documents shorter than this are always parsed whole
//   stats     an object that is filled in with how the parse was done:
//             { mode: "full" | "incremental" | "unchanged", reason?, fromLine?, toLine? }
export function reparse(registry, prev, text, options = {}) {
  const stats = options.stats ?? {};
  const minLines = options.minLines ?? DEFAULT_MIN_LINES;
  text = sanitize(text);

  const full = (reason) => {
    stats.mode = "full";
    stats.reason = reason;
    return parse(registry, text);
  };

  if (!prev || typeof prev.source !== "string") return full("no previous parse");
  const old = prev.source;
  if (old === text) {
    stats.mode = "unchanged";
    return prev;
  }
  const blocks = prev.children ?? [];
  if (blocks.length < 3) return full("too few blocks");
  const { starts } = splitLines(text);
  if (starts.length < minLines) return full("small document");

  // The edit: old[p, oldEnd) became text[p, newEnd).
  let p = 0;
  const max = Math.min(old.length, text.length);
  while (p < max && old.charCodeAt(p) === text.charCodeAt(p)) p++;
  let oldEnd = old.length;
  let newEnd = text.length;
  while (oldEnd > p && newEnd > p && old.charCodeAt(oldEnd - 1) === text.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;

  // The region, as indices into `blocks`.
  const lineStartOf = (b) => b.pos.start.offset - (b.pos.start.column - 1);
  let a = 0;
  while (a + 1 < blocks.length && lineStartOf(blocks[a + 1]) <= p) a++;
  let b = a;
  while (b < blocks.length && blocks[b].pos.start.offset <= oldEnd) b++;
  let i = Math.max(0, a - 1);
  let j = Math.min(blocks.length - 1, b);
  const separated = (x, y) => blocks[x].pos.end.line < blocks[y].pos.start.line - 1;
  while (i > 0 && !separated(i - 1, i)) i--;
  while (j < blocks.length - 1 && !separated(j, j + 1)) j++;
  if (i === 0 && j === blocks.length - 1) return full("edit spans the document");

  const regionStart = i === 0 ? 0 : lineStartOf(blocks[i]);
  const oldRegionEnd = j === blocks.length - 1 ? old.length : lineStartOf(blocks[j + 1]);
  const newRegionEnd = oldRegionEnd + delta;
  const startLine = i === 0 ? 1 : blocks[i].pos.start.line;

  const region = parseWith(registry, text.slice(regionStart, newRegionEnd), prev.refs);
  const fresh = (region.children ?? []).map((n) => shift(n, startLine - 1, regionStart));

  // Definitions are global: if the region's changed, everything may have.
  const isDefinition = (n) => n.type === "link_reference_definition" || Boolean(registry.blocks.get(n.type)?.definition);
  const oldDefs = definitionsIn(blocks.slice(i, j + 1), isDefinition);
  const newDefs = definitionsIn(fresh, isDefinition);
  if (!sameDefinitions(oldDefs, newDefs)) return full("link definitions changed");

  // The untouched blocks at the edges must have come out the same.
  const oldLines = old.slice(regionStart, oldRegionEnd).split(/\r\n|\n|\r/).length;
  const newLines = text.slice(regionStart, newRegionEnd).split(/\r\n|\n|\r/).length;
  const lineDelta = newLines - oldLines;
  if (i < a && !same(blocks[i], fresh[0])) return full("region start moved");
  if (j > b - 1 && !same(shift(blocks[j], lineDelta, delta), fresh[fresh.length - 1])) {
    return full("region end moved");
  }

  const after = blocks.slice(j + 1).map((n) => shift(n, lineDelta, delta));
  const children = [...blocks.slice(0, i), ...fresh, ...after];
  const doc = {
    type: "document",
    pos: { start: prev.pos.start, end: new Locator(text, starts).point(text.length) },
  };
  if (children.length) doc.children = children;
  doc.refs = prev.refs;
  doc.source = text;

  stats.mode = "incremental";
  stats.fromLine = startLine;
  stats.toLine = startLine + newLines - 1;
  return doc;
}

// A copy of `node` with every position moved down `lines` lines and on
// `offset` characters. Columns never change: regions start at line starts.
function shift(node, lines, offset) {
  if (lines === 0 && offset === 0) return node;
  const out = { ...node };
  out.pos = {
    start: { line: node.pos.start.line + lines, column: node.pos.start.column, offset: node.pos.start.offset + offset },
    end: { line: node.pos.end.line + lines, column: node.pos.end.column, offset: node.pos.end.offset + offset },
  };
  if (node.children) out.children = node.children.map((c) => shift(c, lines, offset));
  return out;
}

// Nodes that define something for the whole document: link reference
// definitions, and the types a block rule flags `definition` (footnotes).
function definitionsIn(nodes, isDefinition, out = []) {
  for (const n of nodes) {
    if (isDefinition(n)) out.push(n);
    if (n.children) definitionsIn(n.children, isDefinition, out);
  }
  return out;
}

function sameDefinitions(a, b) {
  if (a.length !== b.length) return false;
  return a.every((d, k) => d.label === b[k].label && d.destination === b[k].destination && d.title === b[k].title);
}

// Structural equality of two plain AST nodes, positions included.
function same(x, y) {
  if (x === y) return true;
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  for (const k of kx) if (!same(x[k], y[k])) return false;
  return true;
}
