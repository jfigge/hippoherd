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
 * Block quotes (§5.1): `>` and an optional space, nestable, with lazy
 * continuation handled by the engine.
 */

import { isSpaceOrTab } from "./util.js";

export const blockQuote = {
  type: "block_quote",
  priority: 800,
  triggers: ">",

  start(parser) {
    if (parser.indented || parser.currentLine.charAt(parser.nextNonspace) !== ">") return 0;
    parser.advanceNextNonspace();
    parser.advanceOffset(1, false);
    if (isSpaceOrTab(parser.currentLine.charAt(parser.offset))) parser.advanceOffset(1, true);
    parser.closeUnmatchedBlocks();
    parser.addChild("block_quote", parser.nextNonspace);
    return 1;
  },

  continue(parser) {
    const ln = parser.currentLine;
    if (parser.indented || ln.charAt(parser.nextNonspace) !== ">") return 1;
    parser.advanceNextNonspace();
    parser.advanceOffset(1, false);
    if (isSpaceOrTab(ln.charAt(parser.offset))) parser.advanceOffset(1, true);
    return 0;
  },

  finalize() {},
  canContain: (type, parser) => !parser.rule(type).onlyInside,
  acceptsLines: false,
};
