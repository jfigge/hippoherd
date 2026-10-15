/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of YamlHippo.
 *
 * YamlHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * YamlHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with YamlHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * tag-colors.js — one colour per custom tag name, the same every time.
 *
 * The page's CSP allows no inline styles, so a tag cannot be given an
 * arbitrary colour; it gets one of PALETTE_SIZE palette classes
 * (yh-tag-c0 … yh-tag-c11, light and dark variants in app.css). The class
 * comes from a hash of the name, so `!Ref` is the same colour in every file
 * and every session. Two names that hash to the same colour in one document
 * are moved apart — the later one (in order of first appearance) takes the
 * next free colour — until the palette runs out.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { walk } from "./tree-search.js";

export const PALETTE_SIZE = 12;

/** A stable 32-bit FNV-1a hash of a string. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The palette slot a name prefers. */
export function preferredColor(name) {
  return fnv1a(name) % PALETTE_SIZE;
}

/**
 * Colours for tag names, given in order of first appearance.
 * @returns {Map<string, number>} name → palette index
 */
export function assignTagColors(names) {
  const colors = new Map();
  const used = new Set();
  for (const name of names) {
    if (colors.has(name)) continue;
    let slot = preferredColor(name);
    if (used.size < PALETTE_SIZE) {
      while (used.has(slot)) slot = (slot + 1) % PALETTE_SIZE;
    }
    used.add(slot);
    colors.set(name, slot);
  }
  return colors;
}

/**
 * Every custom tag in a stream of documents, in order of first appearance:
 * [{ name, count, color }].
 */
export function customTags(documents) {
  const counts = new Map();
  for (const doc of documents) {
    if (!doc.ast) continue;
    walk(doc.ast, (node, _key, _segments, _frames, entry) => {
      const k = entry?.keyNode;
      if (k && k.tag && k.tag.custom) counts.set(k.tag.name, (counts.get(k.tag.name) ?? 0) + 1);
      if (node.tag && node.tag.custom) counts.set(node.tag.name, (counts.get(node.tag.name) ?? 0) + 1);
    });
  }
  const colors = assignTagColors([...counts.keys()]);
  return [...counts].map(([name, count]) => ({ name, count, color: colors.get(name) }));
}
