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
 * Lists (§5.2, §5.3). An `item` opens on a list marker; a `list` is opened
 * around it when the marker does not continue the list before it. The list
 * records how it was written and whether it is tight:
 *
 *   list { ordered, start, delimiter, bullet, tight }
 *
 * Which lines belong to an item is decided by the column its content starts
 * at (markerOffset + padding) — the "nested lists" hard spot.
 */

import { firstContent, isSpaceOrTab, lastContent, nextContent, reNonSpace } from "./util.js";

const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;

// Parse a list marker at the current position; on success, advance past it
// and its following spaces and answer the item's data, else null.
function parseListMarker(parser, container) {
  if (parser.indent >= 4) return null;
  const rest = parser.currentLine.slice(parser.nextNonspace);
  const data = {
    ordered: false,
    bullet: null,
    start: null,
    delimiter: null,
    padding: null,
    markerOffset: parser.indent,
  };
  let match;
  if ((match = rest.match(reBulletListMarker))) {
    data.bullet = match[0][0];
  } else if (
    (match = rest.match(reOrderedListMarker)) &&
    // Only a list starting at 1 may interrupt a paragraph.
    (container.type !== "paragraph" || parseInt(match[1], 10) === 1)
  ) {
    data.ordered = true;
    data.start = parseInt(match[1], 10);
    data.delimiter = match[2];
  } else {
    return null;
  }

  // The marker must be followed by a space, a tab or the end of the line.
  const nextc = parser.currentLine.charAt(parser.nextNonspace + match[0].length);
  if (!(nextc === "" || nextc === "\t" || nextc === " ")) return null;

  // An empty item cannot interrupt a paragraph.
  if (container.type === "paragraph" && !reNonSpace.test(parser.currentLine.slice(parser.nextNonspace + match[0].length))) {
    return null;
  }

  parser.advanceNextNonspace();
  parser.advanceOffset(match[0].length, true);
  const spacesStartCol = parser.column;
  const spacesStartOffset = parser.offset;
  let c;
  do {
    parser.advanceOffset(1, true);
    c = parser.currentLine.charAt(parser.offset);
  } while (parser.column - spacesStartCol < 5 && isSpaceOrTab(c));
  const blankItem = parser.currentLine.charAt(parser.offset) === "";
  const spacesAfterMarker = parser.column - spacesStartCol;
  if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
    // Indented code, or nothing, after the marker: the content starts one
    // space after it.
    data.padding = match[0].length + 1;
    parser.column = spacesStartCol;
    parser.offset = spacesStartOffset;
    if (isSpaceOrTab(parser.currentLine.charAt(parser.offset))) parser.advanceOffset(1, true);
  } else {
    data.padding = match[0].length + spacesAfterMarker;
  }
  data.markerLength = match[0].length;
  return data;
}

const listsMatch = (list, item) =>
  list.ordered === item.ordered && list.delimiter === item.delimiter && list.bullet === item.bullet;

function itemStart(parser, container) {
  if (parser.indented && container.type !== "list") return 0;
  const data = parseListMarker(parser, container);
  if (!data) return 0;
  parser.closeUnmatchedBlocks();
  if (parser.tip.type !== "list" || !listsMatch(parser.tip._listData, data)) {
    const list = parser.addChild("list", parser.nextNonspace);
    list._listData = data;
    list.ordered = data.ordered;
    list.start = data.start;
    list.delimiter = data.delimiter;
    list.bullet = data.bullet;
    list.tight = true;
  }
  const item = parser.addChild("item", parser.nextNonspace);
  item._listData = data;
  item._markerEnd = item._s + data.markerLength;
  return 1;
}

// Does `block` end with a blank line before the next sibling starts?
// Definitions do not count: where an item's last definition follows its
// content, the item's CONTENT end is what decides (spec example 317).
function endsWithBlankLine(parser, block) {
  const next = nextContent(block);
  return next !== null && parser.lineOf(block._contentEnd ?? block._e) !== next._line - 1;
}

// Where `block`'s content ends, definitions aside.
function contentEnd(block, fallback) {
  const last = lastContent(block);
  return last ? (last._contentEnd ?? last._e) : fallback;
}

export const list = {
  type: "list",
  continue: () => 0,
  finalize(parser, block) {
    for (let item = firstContent(block); item; item = nextContent(item)) {
      if (endsWithBlankLine(parser, item)) {
        block.tight = false;
        break;
      }
      // A blank line between the item's own children loosens it too.
      let loose = false;
      for (let sub = firstContent(item); sub; sub = nextContent(sub)) {
        if (endsWithBlankLine(parser, sub)) {
          loose = true;
          break;
        }
      }
      if (loose) {
        block.tight = false;
        break;
      }
    }
    // Ends with its last item (trailing blank lines are not part of it).
    if (block._last) block._e = block._last._e;
    block._contentEnd = contentEnd(block, block._e);
  },
  canContain: (type) => type === "item",
  acceptsLines: false,
};

export const item = {
  type: "item",
  priority: 200,
  triggers: "*+-0123456789",
  onlyInside: "list",
  start: itemStart,

  continue(parser, block) {
    if (parser.blank) {
      // An item can begin with at most one blank line.
      if (firstContent(block) === null) return 1;
      parser.advanceNextNonspace();
    } else if (parser.indent >= block._listData.markerOffset + block._listData.padding) {
      parser.advanceOffset(block._listData.markerOffset + block._listData.padding, true);
    } else {
      return 1;
    }
    return 0;
  },

  // Ends with its last child — a definition counts, being source it holds —
  // or, empty, with its marker.
  finalize(parser, block) {
    block._e = block._last ? block._last._e : block._markerEnd;
    block._contentEnd = contentEnd(block, block._markerEnd);
  },

  canContain: (type, parser) => !parser.rule(type).onlyInside,
  acceptsLines: false,
};
