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
 * outline.js — the document's headings, for the outline panel and for
 * suggesting #links to them.
 *
 * Each heading's id is the one the preview gives it (render/slug.js, with
 * the renderer's `headingIds`): both hand out ids to the same headings in
 * the same order.
 */

import { plainText, slugger } from "../render/slug.js";

// [{ level, text, id, line, offset }], in document order.
export function outline(ast) {
  const slug = slugger();
  const items = [];
  const visit = (node) => {
    if (node.type === "heading") {
      // The id from exactly the text the renderer slugs; tidied for display.
      const raw = plainText(node);
      const text = raw.replace(/\s+/g, " ").trim();
      items.push({ level: node.level, text, id: slug(raw), line: node.pos.start.line, offset: node.pos.start.offset });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  if (ast) visit(ast);
  return items;
}

// The index of the heading whose section holds 1-based `line`: the last one
// at or above it (-1 above the first).
export function sectionAt(items, line) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].line <= line) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
