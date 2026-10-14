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
 * match.js — filtering and ranking suggestions by what has been typed.
 *
 * A suggestion matches when the query is its label or one of its keywords
 * exactly (best: "js" is JavaScript, not JSON), a prefix of one, the start
 * of a word in one, a substring, or the initials of one ("cb" finds
 * "Code block"). Case is ignored.
 */

export function score(query, item) {
  if (!query) return 0;
  const q = query.toLowerCase();
  let best = null;
  const names = [item.label, ...(item.keywords ?? [])];
  for (let i = 0; i < names.length; i++) {
    const s = scoreName(q, names[i].toLowerCase());
    if (s === null) continue;
    // The label itself beats a keyword that matches as well.
    const total = i === 0 ? s : s - 5;
    if (best === null || total > best) best = total;
  }
  return best;
}

function scoreName(q, name) {
  if (name === q) return 120;
  if (name.startsWith(q)) return 100 - Math.min(20, name.length - q.length);
  if (name.split(/[\s\-_/.]+/).some((word) => word.startsWith(q))) return 70;
  if (name.includes(q)) return 50;
  // Initials: "cb" for "code block".
  const initials = name
    .split(/[\s\-_/.]+/)
    .map((word) => word[0] ?? "")
    .join("");
  return q.length > 1 && initials.startsWith(q) ? 40 : null;
}

// The items that match `query`, best first; ties keep their given order.
export function rank(items, query) {
  return items
    .map((item, order) => ({ item, order, score: score(query, item) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.item);
}
