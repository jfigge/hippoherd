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
 * Strikethrough (GFM): ~one~ or ~~two~~ tildes, opening and closing runs
 * of the same length, flanking like emphasis. Three or more never strike.
 */

import { wrapped } from "../commonmark/highlight.js";

export default {
  id: "strikethrough",
  name: "Strikethrough",
  version: "1.0.0",
  description: "GitHub's ~~strikethrough~~: text between one or two tildes is struck out.",
  setup(api) {
    api.delimiter({
      char: "~",
      matches: (opener, closer) => opener.origdelims === closer.origdelims && opener.origdelims <= 2,
      use: (opener) => opener.numdelims,
      nodeType: () => "strikethrough",
    });
    api.renderer("strikethrough", (node, r) => {
      r.tag("del");
      r.children(node);
      r.tag("/del");
    });
    api.highlighter("strikethrough", wrapped("md-strike"));
    api.completions({
      context: "inline",
      provide: () => [{ label: "Strikethrough", keywords: ["del", "strike", "~~"], hint: "~~text~~", insert: "~~${text}~~" }],
    });
  },
};
