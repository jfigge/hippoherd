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
 * parser/index.js — markdown text in, positioned AST out.
 *
 * Two phases, as CommonMark prescribes: the block structure for the whole
 * document first (parser/blocks.js), then the inline content of each leaf
 * that has some (parser/inlines.js) — inline parsing needs every link
 * reference definition, wherever in the document it is.
 */

import { BlockParser } from "./blocks.js";
import { InlineParser } from "./inlines.js";
import { Locator, splitLines } from "./source.js";

// Parse `text` with the syntax in `registry`. Answers the document node:
//
//   { type: "document", pos, children, refs, source }
//
// `refs` maps each normalized link label to { destination, title };
// `source` is the text that was parsed (needed by incremental reparse).
// Positions are described in parser/source.js.
export function parse(registry, text) {
  return parseWith(registry, sanitize(text));
}

// Insecure characters (spec §2.3): NUL becomes U+FFFD, one for one, so
// offsets are unchanged.
export function sanitize(text) {
  return text.indexOf("\0") === -1 ? text : text.replace(/\0/g, "\uFFFD");
}

// Parse already-sanitized text. With `refmap`, links are resolved against it
// instead of the definitions found in `text` — how incremental reparse
// parses one region of a larger document.
export function parseWith(registry, text, refmap) {
  const { lines, starts } = splitLines(text);
  const doc = parseBlocks(registry, lines, starts, text.length, refmap);
  const ast = convert(doc.node, new Locator(text, starts));
  ast.refs = doc.refmap;
  ast.source = text;
  return ast;
}

// Both phases, without the conversion: answers the parse tree and the
// definitions found. `refmap`, when given, is used for inline parsing in
// place of the definitions found here (incremental reparse uses it).
export function parseBlocks(registry, lines, starts, textLength, refmap) {
  const blocks = new BlockParser(registry);
  const node = blocks.parse(lines, starts, textLength);
  const refs = refmap ?? blocks.refmap;
  const inlines = new InlineParser(registry);
  parseInlines(registry, node, inlines, refs);
  return { node, refmap: blocks.refmap, definitions: blocks.definitions };
}

function parseInlines(registry, block, inlines, refmap) {
  for (let child = block._first; child; child = child._next) {
    const rule = registry.blocks.get(child.type);
    if (rule && rule.inlineContent) {
      const content = child._content.slice(child._base);
      child._lead = child._base + inlines.parse(child, content, refmap);
    } else if (child._first) {
      parseInlines(registry, child, inlines, refmap);
    }
  }
}

// Map an index into a leaf's inline subject to a source offset, through the
// segments recorded as its lines were added. An END index (exclusive) that
// falls just after a line's newline maps to the start of the next source
// line, not to the next line's content — which may be several container
// markers further on.
function contentOffset(block, index, isEnd) {
  const segs = block._segments;
  const ci = block._lead + index;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (isEnd ? segs[mid][0] < ci : segs[mid][0] <= ci) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  if (seg[2]) return seg[1];
  if (isEnd && lo + 1 < segs.length && ci === segs[lo + 1][0]) return seg[3];
  return seg[1] + (ci - seg[0]);
}

// The parse tree as a plain AST (see parser/nodes.js), with positions.
function convert(node, locator, leaf = null) {
  const out = { type: node.type };
  if (node._s !== undefined) {
    out.pos = { start: locator.point(node._s), end: locator.point(node._e) };
  } else {
    out.pos = {
      start: locator.point(contentOffset(leaf, node._f, false)),
      end: locator.point(contentOffset(leaf, node._t, true)),
    };
  }
  for (const key of Object.keys(node)) {
    if (key[0] !== "_" && key !== "type") out[key] = node[key];
  }
  if (node._first) {
    const inner = node._segments && node._lead !== undefined ? node : leaf;
    const children = [];
    for (let c = node._first; c; c = c._next) children.push(convert(c, locator, inner));
    out.children = children;
  }
  return out;
}
