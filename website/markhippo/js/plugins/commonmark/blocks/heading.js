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
 * Headings: ATX (§4.2, `#` to `######`) and setext (§4.3, a paragraph
 * underlined with `=` or `-`). Both are one node type, `heading`, with
 * `level`; `setext` says which form it was written in.
 */

import { Node } from "../../../parser/nodes.js";
import { extractReferences } from "./paragraph.js";

const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;

function atxStart(parser) {
  if (parser.indented) return 0;
  const match = parser.currentLine.slice(parser.nextNonspace).match(reATXHeadingMarker);
  if (!match) return 0;
  parser.advanceNextNonspace();
  parser.advanceOffset(match[0].length, false);
  parser.closeUnmatchedBlocks();
  const heading = parser.addChild("heading", parser.nextNonspace);
  heading.level = match[0].trim().length;
  heading.setext = false;
  // Drop the optional closing sequence of #s.
  heading._content = parser.currentLine
    .slice(parser.offset)
    .replace(/^[ \t]*#+[ \t]*$/, "")
    .replace(/[ \t]+#+[ \t]*$/, "");
  heading._segments.push([0, parser.offsetAt(parser.lineNumber, parser.offset), false, 0]);
  parser.advanceOffset(parser.currentLine.length - parser.offset);
  return 2;
}

function setextStart(parser, container) {
  if (parser.indented || container.type !== "paragraph") return 0;
  const match = parser.currentLine.slice(parser.nextNonspace).match(reSetextHeadingLine);
  if (!match) return 0;
  parser.closeUnmatchedBlocks();
  // Definitions at the start of the paragraph are not part of the heading.
  extractReferences(parser, container);
  if (container._content.length <= container._base) return 0;

  const heading = new Node("heading", { level: match[0][0] === "=" ? 1 : 2, setext: true });
  heading._s = container._s;
  heading._line = container._line;
  heading._open = true;
  heading._content = container._content;
  heading._segments = container._segments;
  heading._base = container._base;
  container.insertAfter(heading);
  container.unlink();
  parser.tip = heading;
  parser.advanceOffset(parser.currentLine.length - parser.offset, false);
  return 2;
}

export const heading = {
  type: "heading",
  starts: [
    { start: atxStart, priority: 700, triggers: "#" },
    { start: setextStart, priority: 400, triggers: "=-" },
  ],
  continue: () => 1,
  finalize() {},
  canContain: () => false,
  acceptsLines: false,
  inlineContent: true,
};
