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
 * slug.js — the plain text of a node, and the ids headings get from it.
 *
 * Ids follow GitHub's scheme, since that is what people link to: lower
 * case, punctuation dropped, spaces to hyphens, and a repeat of an id
 * already used gets -1, -2…  "Hello, World!" → hello-world.
 */

// The text a reader sees in `node`: text and code literally, breaks as
// spaces, everything else by its children — but not an image's alt text,
// which is not seen (GitHub leaves it out of heading ids too).
export function plainText(node) {
  if (node.type === "text" || node.type === "code") return node.literal ?? "";
  if (node.type === "image") return "";
  if (node.type === "softbreak" || node.type === "linebreak") return " ";
  let out = "";
  for (const child of node.children ?? []) out += plainText(child);
  return out;
}

export function slugify(text) {
  // Not trimmed: GitHub doesn't (a heading starting with an image starts
  // its id with "-"), and the parser has trimmed the heading already.
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

// A slugger hands out each document's ids, unique within it. A heading
// with no letters or digits at all is "section".
export function slugger() {
  const used = new Set();
  const next = new Map();
  return (text) => {
    const base = slugify(text) || "section";
    let id = base;
    if (used.has(id)) {
      let n = next.get(base) ?? 1;
      do id = `${base}-${n++}`;
      while (used.has(id));
      next.set(base, n);
    }
    used.add(id);
    return id;
  };
}
