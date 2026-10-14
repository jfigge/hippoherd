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
 * Thematic breaks (§4.1): three or more matching `-`, `_` or `*`.
 */

const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;

export const thematicBreak = {
  type: "thematic_break",
  priority: 300,
  triggers: "*_-",

  start(parser) {
    if (parser.indented || !reThematicBreak.test(parser.currentLine.slice(parser.nextNonspace))) return 0;
    parser.closeUnmatchedBlocks();
    parser.addChild("thematic_break", parser.nextNonspace);
    parser.advanceOffset(parser.currentLine.length - parser.offset, false);
    return 2;
  },

  continue: () => 1,
  finalize() {},
  canContain: () => false,
  acceptsLines: false,
};
