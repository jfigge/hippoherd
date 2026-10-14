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
 * Shared helpers for the CommonMark block rules.
 */

export const isSpaceOrTab = (c) => c === " " || c === "\t";

export const reNonSpace = /[^ \t\f\v\r\n]/;

// Link reference definitions never render and never count as content: an
// item that holds only definitions is, for every structural purpose, empty.
export const isDefinition = (node) => node.type === "link_reference_definition";

export function firstContent(node) {
  let c = node._first;
  while (c && isDefinition(c)) c = c._next;
  return c;
}

export function lastContent(node) {
  let c = node._last;
  while (c && isDefinition(c)) c = c._prev;
  return c;
}

export function nextContent(node) {
  let c = node._next;
  while (c && isDefinition(c)) c = c._next;
  return c;
}
