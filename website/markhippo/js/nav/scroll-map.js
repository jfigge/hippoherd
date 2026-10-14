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
 * scroll-map.js — matching scroll positions between two views of one
 * document.
 *
 * The edit pane and the preview are laid out differently (a heading is one
 * line in one and a large block in the other), so a scroll position in one
 * is mapped to the other through ANCHORS: pairs [a, b] of positions known
 * to show the same thing — a source line's top in the editor and the top
 * of the element rendered from it in the preview. Between anchors the
 * mapping is linear. Both ends are anchors too, so the views reach their
 * tops and bottoms together.
 */

// `pairs` in document order; aEnd and bEnd are the views' last scroll
// positions. Pairs that would make the mapping go backwards in either view
// (an element nested in another, say) are dropped.
export function scrollMap(pairs, aEnd, bEnd) {
  const a = [0];
  const b = [0];
  for (const [x, y] of pairs) {
    if (x > a[a.length - 1] && y > b[b.length - 1] && x < aEnd && y < bEnd) {
      a.push(x);
      b.push(y);
    }
  }
  if (aEnd > a[a.length - 1] && bEnd > b[b.length - 1]) {
    a.push(aEnd);
    b.push(bEnd);
  }
  return {
    forward: (x) => interpolate(a, b, x),
    backward: (y) => interpolate(b, a, y),
  };
}

function interpolate(from, to, x) {
  const n = from.length;
  if (n < 2 || x <= from[0]) return to[0];
  if (x >= from[n - 1]) return to[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid] <= x) lo = mid;
    else hi = mid;
  }
  return to[lo] + ((x - from[lo]) / (from[hi] - from[lo])) * (to[hi] - to[lo]);
}
