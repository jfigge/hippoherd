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
 * Paragraphs (§4.8), and the link reference definitions (§4.7) that can only
 * appear at the start of one. This replaces the engine's bare paragraph rule.
 *
 * Definitions are taken off the front of the paragraph when it closes and
 * become `link_reference_definition` nodes in its place, so the outline,
 * highlighting and autocomplete can see them; they render as nothing.
 */

import { Node } from "../../../parser/nodes.js";
import { ScanState, parseReference } from "../../../parser/scanners.js";
import { reNonSpace } from "./util.js";

// Source offset of index `i` in a leaf's raw content (a binary search: a
// paragraph of thousands of definitions has thousands of segments).
function contentOffset(block, i) {
  const segs = block._segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid][0] <= i) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  return seg[2] ? seg[1] : seg[1] + (i - seg[0]);
}

// Take every definition off the front of `block`'s content.
export function extractReferences(parser, block) {
  const s = new ScanState(block._content, block._base);
  while (s.peek() === "[") {
    const start = s.pos;
    const def = parseReference(s, parser.refmap);
    if (!def) break;
    let end = s.pos;
    if (block._content[end - 1] === "\n") end -= 1;
    const node = new Node("link_reference_definition", {
      label: def.label,
      destination: def.destination,
      title: def.title,
    });
    node._s = contentOffset(block, start);
    node._e = contentOffset(block, end);
    block.insertBefore(node);
    parser.definitions.push(def);
    block._base = s.pos;
    // What is left of the paragraph starts after its definitions.
    block._s = contentOffset(block, s.pos);
  }
}

export const paragraph = {
  type: "paragraph",
  continue: (parser) => (parser.blank ? 1 : 0),
  finalize(parser, block) {
    extractReferences(parser, block);
    // Definitions taken off when a setext underline was tried came before
    // that line was added: map the start again, now every line is in.
    if (block._base > 0) block._s = contentOffset(block, block._base);
    if (!reNonSpace.test(block._content.slice(block._base))) block.unlink();
  },
  canContain: () => false,
  acceptsLines: true,
  inlineContent: true,
};
