/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * align.js — lay two diffed documents out side by side, row for row.
 *
 * The result is a list of rows. Each row holds a line of the left text and a
 * line of the right text — or, where a side has nothing there, one of two
 * render-only fillers:
 *
 *   PLACEHOLDER  the other side has a member or element this side is missing.
 *                Drawn hatched; typing into it turns it into a real line.
 *   SPACER       nothing is missing, the sides just have different line counts
 *                here (a reordered member, a value formatted differently).
 *
 * Alignment follows the document structure. Inside a changed object or array,
 * matched members anchor rows to each other in the longest run that is in the
 * same order on both sides; members only on one side get placeholders exactly
 * where they sit. If half or more are out of order (Reorder at Off with the
 * keys shuffled), no anchors are used inside that container and its lines
 * simply pair up in order — each pane keeps its own order, without a wall of
 * spacers.
 *
 * Works on line numbers, so it assumes one member per line, which is how the
 * Diff tab lays a document out. A container with members sharing a line (or
 * on its opener's line) is aligned as one block.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/** Row cell values that are not line numbers. */
export const PLACEHOLDER = 0;
export const SPACER = -1;

/** Deeper than this, a changed container is aligned as one block. */
const MAX_ALIGN_DEPTH = 500;

/** [first line, last line] of a member (from its key) or element. */
function memberRange(node, entry) {
  return [entry ? entry.keyToken.line : node.start.line, node.end.line];
}

/** Longest strictly increasing subsequence of `values` (indices into it). */
function longestIncreasing(values) {
  const tails = []; // tails[k] = index of the smallest tail of a run of length k+1
  const prev = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const out = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/**
 * Give each child its block of lines: from its first line to the line before
 * the next child (so blank lines travel with the member above them). Null if
 * children share a line or sit on the container's own opener or closer line.
 */
function withBlocks(kids, openLine, closeLine) {
  for (let k = 0; k < kids.length; k++) {
    const [start, end] = kids[k].range;
    if (start <= openLine || end >= closeLine) return null;
    if (k > 0 && start <= kids[k - 1].range[1]) return null;
  }
  kids.forEach((kid, k) => {
    kid.block = [kid.range[0], k + 1 < kids.length ? kids[k + 1].range[0] - 1 : closeLine - 1];
  });
  return kids;
}

/**
 * @param diff        result of diffJson(leftAst, rightAst)
 * @param leftLines   number of lines in the left text (and rightLines)
 * @returns {{ rows: [left, right][], classes: { left: Map<line, cls>, right: Map<line, cls> } }}
 *   rows cells are 1-based line numbers, PLACEHOLDER or SPACER. classes marks
 *   the lines of each difference: 'missing' (left only), 'added' (right
 *   only), 'changed' and 'type'.
 */
export function alignDocuments(diff, leftAst, rightAst, leftLines, rightLines) {
  const rows = [];

  const pairRanges = (l0, l1, r0, r1) => {
    const n = Math.max(l1 - l0 + 1, r1 - r0 + 1, 0);
    for (let k = 0; k < n; k++) {
      rows.push([l0 + k <= l1 ? l0 + k : SPACER, r0 + k <= r1 ? r0 + k : SPACER]);
    }
  };

  const onlyOn = (side, from, to) => {
    for (let line = from; line <= to; line++) rows.push(side === "left" ? [line, PLACEHOLDER] : [PLACEHOLDER, line]);
  };

  const emitGap = (gapL, gapR) => {
    let i = 0;
    let j = 0;
    while (i < gapL.length || j < gapR.length) {
      const a = gapL[i];
      const b = gapR[j];
      if (a && !a.child.right) {
        onlyOn("left", a.block[0], a.block[1]);
        i++;
      } else if (b && !b.child.left) {
        onlyOn("right", b.block[0], b.block[1]);
        j++;
      } else if (a && b) {
        pairRanges(a.block[0], a.block[1], b.block[0], b.block[1]);
        i++;
        j++;
      } else if (a) {
        pairRanges(a.block[0], a.block[1], 1, 0);
        i++;
      } else {
        pairRanges(1, 0, b.block[0], b.block[1]);
        j++;
      }
    }
  };

  // Recursion follows the nesting of changed containers (MAX_ALIGN_DEPTH).
  const alignNode = (d, depth) => {
    const L = d.left;
    const R = d.right;
    const [l0, l1] = memberRange(L, d.leftEntry);
    const [r0, r1] = memberRange(R, d.rightEntry);
    const asBlock = d.status !== "changed" || !d.children || depth > MAX_ALIGN_DEPTH || L.start.line === L.end.line || R.start.line === R.end.line;
    if (asBlock) {
      pairRanges(l0, l1, r0, r1);
      return;
    }

    const side = (key) =>
      d.children
        .filter((c) => c[key])
        .map((child) => ({ child, range: memberRange(child[key], child[`${key}Entry`]) }))
        .sort((x, y) => x.range[0] - y.range[0]);
    const leftKids = withBlocks(side("left"), L.start.line, L.end.line);
    const rightKids = withBlocks(side("right"), R.start.line, R.end.line);
    if (!leftKids || !rightKids) {
      pairRanges(l0, l1, r0, r1);
      return;
    }

    // Head: the key line through the opener; then any lines before the first member.
    pairRanges(l0, L.start.line, r0, R.start.line);
    const firstL = leftKids.length ? leftKids[0].range[0] : L.end.line;
    const firstR = rightKids.length ? rightKids[0].range[0] : R.end.line;
    pairRanges(L.start.line + 1, firstL - 1, R.start.line + 1, firstR - 1);

    // Anchors: the longest run of matched members in the same order on both
    // sides — unless that is half of them or fewer (a shuffled container).
    const posL = new Map(leftKids.map((k, i) => [k.child, i]));
    const posR = new Map(rightKids.map((k, i) => [k.child, i]));
    const matched = leftKids.filter((k) => k.child.right).map((k) => k.child);
    let chain = longestIncreasing(matched.map((c) => posR.get(c))).map((i) => matched[i]);
    if (chain.length * 2 <= matched.length) chain = [];

    let li = 0;
    let ri = 0;
    for (const anchor of [...chain, null]) {
      const stopL = anchor ? posL.get(anchor) : leftKids.length;
      const stopR = anchor ? posR.get(anchor) : rightKids.length;
      emitGap(leftKids.slice(li, stopL), rightKids.slice(ri, stopR));
      li = stopL;
      ri = stopR;
      if (anchor) {
        const kl = leftKids[li++];
        const kr = rightKids[ri++];
        alignNode(anchor, depth + 1);
        pairRanges(kl.range[1] + 1, kl.block[1], kr.range[1] + 1, kr.block[1]);
      }
    }

    // The closer (and, for a member, nothing after it: l1 is the closer's line).
    pairRanges(L.end.line, l1, R.end.line, r1);
  };

  pairRanges(1, leftAst.start.line - 1, 1, rightAst.start.line - 1);
  alignNode(diff.root, 0);
  pairRanges(leftAst.end.line + 1, leftLines, rightAst.end.line + 1, rightLines);

  return { rows, classes: classify(diff.root) };
}

/** The lines each difference occupies, per side. */
function classify(root) {
  const classes = { left: new Map(), right: new Map() };
  const mark = (side, node, entry, cls) => {
    const [a, b] = memberRange(node, entry);
    for (let line = a; line <= b; line++) classes[side].set(line, cls);
  };
  const stack = [root];
  while (stack.length > 0) {
    const d = stack.pop();
    if (d.status === "missing") mark("left", d.left, d.leftEntry, "missing");
    else if (d.status === "added") mark("right", d.right, d.rightEntry, "added");
    else if (d.status === "type" || (d.status === "changed" && !d.children)) {
      mark("left", d.left, d.leftEntry, d.status);
      mark("right", d.right, d.rightEntry, d.status);
    } else if (d.status === "changed") {
      stack.push(...d.children);
    }
  }
  return classes;
}
