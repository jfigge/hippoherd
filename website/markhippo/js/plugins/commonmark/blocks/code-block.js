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
 * Code blocks: fenced (§4.5, ``` or ~~~ with an info string) and indented
 * (§4.4, four spaces). One node type, `code_block`:
 *
 *   { fenced, info, literal, fence?, closed? }
 *
 * `fence` is the opening run (```` ``` ````) and `closed` whether a closing
 * fence was found: an unclosed fence runs to the end of its container, which
 * is exactly the mistake the edit pane wants to show.
 */

import { unescapeString } from "../../../parser/normalize.js";
import { isSpaceOrTab } from "./util.js";

const CODE_INDENT = 4;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

function fencedStart(parser) {
  if (parser.indented) return 0;
  const match = parser.currentLine.slice(parser.nextNonspace).match(reCodeFence);
  if (!match) return 0;
  const fenceLength = match[0].length;
  parser.closeUnmatchedBlocks();
  const block = parser.addChild("code_block", parser.nextNonspace);
  block.fenced = true;
  block.fence = match[0];
  block.closed = false;
  block._fenceLength = fenceLength;
  block._fenceChar = match[0][0];
  block._fenceOffset = parser.indent;
  parser.advanceNextNonspace();
  parser.advanceOffset(fenceLength, false);
  return 2;
}

function indentedStart(parser) {
  if (!parser.indented || parser.tip.type === "paragraph" || parser.blank) return 0;
  // The block starts where its indentation does.
  const at = parser.offset;
  parser.advanceOffset(CODE_INDENT, true);
  parser.closeUnmatchedBlocks();
  const block = parser.addChild("code_block", at);
  block.fenced = false;
  return 2;
}

export const codeBlock = {
  type: "code_block",
  starts: [
    { start: fencedStart, priority: 600, triggers: "`~" },
    // Only ever matches an indented line, which skips the trigger check.
    { start: indentedStart, priority: 100, triggers: "" },
  ],

  continue(parser, block) {
    const ln = parser.currentLine;
    const indent = parser.indent;
    if (block.fenced) {
      const match =
        indent <= 3 &&
        ln.charAt(parser.nextNonspace) === block._fenceChar &&
        ln.slice(parser.nextNonspace).match(reClosingCodeFence);
      if (match && match[0].length >= block._fenceLength) {
        // The closing fence: the line is consumed whole.
        block.closed = true;
        parser.lastLineLength = parser.nextNonspace + match[0].length;
        parser.finalize(block, parser.lineNumber);
        return 2;
      }
      // Skip as much of the opening fence's indentation as there is.
      let i = block._fenceOffset;
      while (i > 0 && isSpaceOrTab(ln.charAt(parser.offset))) {
        parser.advanceOffset(1, true);
        i--;
      }
      return 0;
    }
    if (indent >= CODE_INDENT) {
      parser.advanceOffset(CODE_INDENT, true);
    } else if (parser.blank) {
      parser.advanceNextNonspace();
    } else {
      return 1;
    }
    return 0;
  },

  finalize(parser, block) {
    const content = block._content;
    if (block.fenced) {
      // The rest of the opening line is the info string.
      const newline = content.indexOf("\n");
      block.info = unescapeString(content.slice(0, newline).trim());
      block.literal = content.slice(newline + 1);
    } else {
      // Trailing blank lines are not part of an indented code block.
      const lines = content.split("\n");
      lines.pop();
      while (lines.length > 1 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
      block.info = "";
      block.literal = lines.join("\n") + "\n";
      const endLine = block._line + lines.length - 1;
      block._e = parser.offsetAt(endLine, parser.lines[endLine - 1].length);
    }
    block._content = null;
    block._segments = null;
  },

  canContain: () => false,
  acceptsLines: true,
};
