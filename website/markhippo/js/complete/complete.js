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
 * complete.js — suggestions for the cursor, from the plugins.
 *
 * Plugins register completion providers (`api.completions`):
 *
 *   { context: "block" | "inline" | "fence-info" | "link-ref" | "*" | [...],
 *     provide(ctx) → [item, …] }
 *
 * ctx is the context (see context.js) plus { ast, text, offset, registry }.
 * An item is
 *
 *   { label, detail?, keywords?, hint?, insert? }
 *
 * — `label` is what the list shows and what typing filters on (with
 * `keywords`), `detail` a short description, `hint` the markdown it stands
 * for, shown beside it (that is how the list teaches the syntax), and
 * `insert` the snippet it inserts (snippet.js; the label when absent).
 */

import { completionContext } from "./context.js";
import { rank } from "./match.js";

// The context at `offset` and every suggestion for it, unfiltered; or null
// when there is nothing to suggest there.
export function complete(registry, ast, text, offset, options = {}) {
  const context = completionContext(ast, text, offset, options);
  if (!context) return null;
  const ctx = { ...context, ast, text, offset, registry };
  const items = [];
  for (const provider of registry.completionProviders) {
    if (!wants(provider.context, context.kind)) continue;
    let provided;
    try {
      provided = provider.provide(ctx);
    } catch {
      // A failing provider costs its own suggestions, nothing more.
      continue;
    }
    for (const item of provided ?? []) {
      if (item && typeof item.label === "string" && item.label) items.push(item);
    }
  }
  return { context, items };
}

function wants(declared, kind) {
  if (declared === "*" || declared === kind) return true;
  return Array.isArray(declared) && declared.includes(kind);
}

export { rank };
