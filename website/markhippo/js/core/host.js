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
 * host.js — the plugin host: the one object the app (and anything else)
 * talks to.
 *
 *   const mh = createMarkHippo({ plugins: [commonmark] });
 *   const doc = mh.parse(text);            // positioned AST
 *   const next = mh.reparse(doc, newText); // incremental, same result
 *   const html = mh.render(doc, { sourceLines: true });
 *   const segments = mh.highlight(doc);    // edit-pane colouring
 *   const found = mh.complete(doc, text, offset); // autocomplete
 */

import { createRegistry, installPlugin } from "./registry.js";
import { parse } from "../parser/index.js";
import { reparse } from "../parser/incremental.js";
import { HtmlRenderer } from "../render/html.js";
import { highlight } from "../highlight/highlight.js";
import { complete } from "../complete/complete.js";

export function createMarkHippo({ plugins = [] } = {}) {
  const registry = createRegistry();
  for (const plugin of plugins) installPlugin(registry, plugin);

  return {
    registry,
    get plugins() {
      return registry.plugins.slice();
    },
    use(plugin) {
      installPlugin(registry, plugin);
      return this;
    },
    parse: (text) => parse(registry, text),
    reparse: (prev, text, options) => reparse(registry, prev, text, options),
    render: (ast, options) => new HtmlRenderer(registry, options).render(ast),
    highlight: (ast) => highlight(registry, ast),
    complete: (ast, text, offset, options) => complete(registry, ast, text, offset, options),
  };
}
