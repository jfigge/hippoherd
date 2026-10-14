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
 * The CommonMark plugin: the whole of CommonMark 0.31.2 — parsing, HTML,
 * edit-pane colouring and autocomplete suggestions — registered through the public plugin API like any
 * third-party plugin; nothing here reaches into the core.
 */

import { blockQuote } from "./blocks/block-quote.js";
import { codeBlock } from "./blocks/code-block.js";
import { heading } from "./blocks/heading.js";
import { htmlBlock } from "./blocks/html-block.js";
import { item, list } from "./blocks/list.js";
import { paragraph } from "./blocks/paragraph.js";
import { thematicBreak } from "./blocks/thematic-break.js";
import {
  angle,
  asterisk,
  backslash,
  bang,
  closeBracket,
  codeSpan,
  entity,
  newline,
  openBracket,
  underscore,
} from "./inlines.js";
import { providers } from "./completions.js";
import { highlighters } from "./highlight.js";
import { renderers } from "./render.js";

export default {
  id: "commonmark",
  name: "CommonMark",
  version: "0.31.2",
  description: "Every construct of the CommonMark 0.31.2 spec: headings, lists, quotes, code, links, images, emphasis, raw HTML.",
  required: true,
  setup(api) {
    for (const rule of [paragraph, blockQuote, heading, codeBlock, htmlBlock, thematicBreak, list, item]) {
      api.blockRule(rule);
    }
    for (const rule of [newline, backslash, codeSpan, openBracket, bang, closeBracket, angle, entity]) {
      api.inlineRule(rule);
    }
    api.delimiter(asterisk);
    api.delimiter(underscore);
    for (const [type, fn] of Object.entries(renderers)) api.renderer(type, fn);
    for (const [type, fn] of Object.entries(highlighters)) api.highlighter(type, fn);
    for (const provider of providers) api.completions(provider);
  },
};
