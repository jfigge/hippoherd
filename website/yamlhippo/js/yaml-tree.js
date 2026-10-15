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
 * yaml-tree.js — small helpers over the parser's tree, for the modules that
 * read it.
 *
 * An alias node points at the node its anchor is on — the same object, not a
 * copy — so a tree with aliases is a graph. Most readers (search, the tree
 * view) treat an alias as a leaf; the ones that need its content (schema,
 * diff, the type catalogue, JSON export) go through deref(), and bound how
 * much aliasing they will expand, because a few lines of aliases can stand
 * for billions of nodes ("billion laughs").
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/** Expanding aliases stops after this many nodes in one pass. */
export const ALIAS_BUDGET = 2_000_000;

/** The node an alias stands for (or the node itself). */
export function deref(node) {
  return node.kind === "alias" ? node.target : node;
}

/** True for objects and arrays. */
export function isCollection(node) {
  return node.kind === "object" || node.kind === "array";
}

/** The child nodes of a collection, in order (values only, for objects). */
export function childNodes(node) {
  if (node.kind === "object") return node.entries.map((e) => e.value);
  if (node.kind === "array") return node.items;
  return [];
}

/** A tag as shown: !Ref, !!str. */
export function tagName(node) {
  return node.tag ? node.tag.name : null;
}
