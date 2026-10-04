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
 * json-diff.js — a semantic comparison of two parsed JSON documents.
 *
 * Order is never a difference. Object members are matched by key; array
 * elements are matched by content — equal elements first, then the most
 * similar of what is left — so [1, 2] and [2, 1] are the same array, and an
 * object that moved from index 3 to index 0 and changed one field is reported
 * as one changed field, not as one element removed and another added.
 *
 * Values compare as JSON values: "3" and 3 are different types; 1.0, 1 and
 * 1e0 are the same number; "é" and "é" are the same string.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/**
 * Two array elements that are not equal are paired as "changed" only when
 * their similarity is ABOVE this (0..1). A shared key earns half credit even
 * when its value differs, so two objects with the same keys and no value in
 * common score exactly 0.5 and are not paired — that is a different record.
 */
export const SIMILARITY_THRESHOLD = 0.5;

/** Keys that identify a record. Equal values under one of these pair two objects outright. */
const ID_KEYS = ["id", "_id", "uuid", "guid", "key", "code"];

/**
 * Leftover elements (after the exact-match pass) are scored all against all
 * up to this many pairs. Past it, they pair by an identifying key, then each
 * is compared only with leftovers near the same relative position.
 */
const FULL_SCORE_LIMIT = 40000;
const WINDOW = 50;

/** Nesting this deep is compared by equality only (no recursion into it). */
const MAX_DIFF_DEPTH = 1000;

const isContainer = (n) => n.kind === "object" || n.kind === "array";

/**
 * A number's value as a canonical string, so "1.0", "1", "1e0" and "10e-1"
 * compare equal — exactly, at any precision, never through a double.
 */
export function canonicalNumber(raw) {
  let s = raw;
  let negative = false;
  if (s[0] === "-") {
    negative = true;
    s = s.slice(1);
  }
  let exponent = 0;
  const e = s.search(/[eE]/);
  if (e >= 0) {
    exponent = Number(s.slice(e + 1));
    s = s.slice(0, e);
  }
  let digits = s;
  const dot = s.indexOf(".");
  if (dot >= 0) {
    digits = s.slice(0, dot) + s.slice(dot + 1);
    exponent -= s.length - dot - 1;
  }
  digits = digits.replace(/^0+/, "");
  if (digits === "") return "0"; // 0, -0, 0.000
  const trimmed = digits.replace(/0+$/, "");
  exponent += digits.length - trimmed.length;
  return `${negative ? "-" : ""}${trimmed}e${exponent}`;
}

/** A 53-bit string hash (cyrb53). */
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Order-insensitive content hashes for AST nodes, memoised. Two nodes with
 * the same hash are treated as equal JSON values: an object's hash is built
 * from its members' hashes sorted, an array's from its elements' hashes
 * sorted, so neither depends on order. Computed bottom-up without recursion,
 * so depth is not limited by the call stack. (Two different values sharing a
 * 53-bit hash is possible in principle; the odds for any one comparison are
 * about 1 in 9 × 10^15.)
 */
export class Hasher {
  constructor() {
    this.memo = new Map();
  }

  hash(root) {
    const memo = this.memo;
    if (memo.has(root)) return memo.get(root);
    const stack = [root];
    while (stack.length > 0) {
      const node = stack[stack.length - 1];
      if (memo.has(node)) {
        stack.pop();
        continue;
      }
      if (!isContainer(node)) {
        stack.pop();
        memo.set(node, scalarHash(node));
        continue;
      }
      const kids = node.kind === "object" ? node.entries.map((e) => e.value) : node.items;
      let waiting = false;
      for (const kid of kids) {
        if (!memo.has(kid)) {
          stack.push(kid);
          waiting = true;
        }
      }
      if (waiting) continue;
      stack.pop();
      memo.set(node, this.containerHash(node));
    }
    return memo.get(root);
  }

  containerHash(node) {
    const memo = this.memo;
    if (node.kind === "object") {
      const parts = node.entries.map((e) => hashString(`k${e.key}\u0001${memo.get(e.value)}`));
      parts.sort((a, b) => a - b);
      return hashString(`o${parts.join(",")}`);
    }
    const parts = node.items.map((item) => memo.get(item));
    parts.sort((a, b) => a - b);
    return hashString(`a${parts.join(",")}`);
  }
}

function scalarHash(node) {
  switch (node.kind) {
    case "string":
      return hashString(`s${node.value}`);
    case "number":
      return hashString(`n${canonicalNumber(node.raw)}`);
    case "boolean":
      return hashString(node.value ? "b1" : "b0");
    default:
      return hashString("z");
  }
}

/** The first value under each key (duplicate keys: the first wins for scoring). */
function firstByKey(node) {
  const map = new Map();
  for (const e of node.entries) if (!map.has(e.key)) map.set(e.key, e.value);
  return map;
}

/**
 * How alike two values are, 0..1. Equal values score 1; different types 0;
 * unequal scalars 0. Objects: each shared key earns 0.5 plus half the
 * similarity of its two values, each key on one side only earns 0, averaged
 * over all keys — and an equal identifying key (id, uuid, …) lifts the score
 * to at least 0.9. Arrays: the share of elements they have in common.
 * Recursion into values is limited to `budget` levels.
 */
export function similarity(a, b, hasher, budget = 3) {
  if (a.kind !== b.kind) return 0;
  if (hasher.hash(a) === hasher.hash(b)) return 1;
  if (a.kind === "object") {
    const ka = firstByKey(a);
    const kb = firstByKey(b);
    const union = new Set([...ka.keys(), ...kb.keys()]);
    let sum = 0;
    let sameId = false;
    for (const key of union) {
      const va = ka.get(key);
      const vb = kb.get(key);
      if (va === undefined || vb === undefined) continue;
      const equal = hasher.hash(va) === hasher.hash(vb);
      const inner = equal ? 1 : budget > 0 ? similarity(va, vb, hasher, budget - 1) : 0;
      sum += 0.5 + 0.5 * inner;
      if (equal && !isContainer(va) && ID_KEYS.includes(key)) sameId = true;
    }
    const score = union.size === 0 ? 1 : sum / union.size;
    return sameId ? Math.max(score, 0.9) : score;
  }
  if (a.kind === "array") {
    const counts = new Map();
    for (const item of a.items) {
      const h = hasher.hash(item);
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    let common = 0;
    for (const item of b.items) {
      const h = hasher.hash(item);
      const n = counts.get(h);
      if (n) {
        common++;
        counts.set(h, n - 1);
      }
    }
    return common / Math.max(a.items.length, b.items.length);
  }
  return 0;
}

/** The identifying key every candidate object on both sides has as a scalar, if any. */
function commonIdKey(left, right) {
  const all = [...left, ...right];
  if (!all.every((n) => n.kind === "object")) return null;
  for (const key of ID_KEYS) {
    if (all.every((n) => n.entries.some((e) => e.key === key && !isContainer(e.value)))) return key;
  }
  return null;
}

/**
 * Pair the elements of two arrays, one-to-one, ignoring order.
 *
 *   1. Equal elements pair first (by content hash), earliest with earliest.
 *   2. Of what is left, containers pair with the most similar container of
 *      the same type, best scores first, if the score is above
 *      SIMILARITY_THRESHOLD. Scalars never pair unless equal.
 *   3. Anything still unpaired is only on its own side.
 *
 * @returns {{ pairs: [leftIndex, rightIndex][], leftOnly: number[], rightOnly: number[] }}
 */
export function pairItems(leftItems, rightItems, hasher = new Hasher()) {
  const pairs = [];
  const buckets = new Map();
  rightItems.forEach((item, j) => {
    const h = hasher.hash(item);
    if (!buckets.has(h)) buckets.set(h, []);
    buckets.get(h).push(j);
  });
  const usedRight = new Uint8Array(rightItems.length);
  const leftRest = [];
  leftItems.forEach((item, i) => {
    const queue = buckets.get(hasher.hash(item));
    if (queue && queue.length > 0) {
      const j = queue.shift();
      usedRight[j] = 1;
      pairs.push([i, j]);
    } else {
      leftRest.push(i);
    }
  });
  const rightRest = [];
  for (let j = 0; j < rightItems.length; j++) if (!usedRight[j]) rightRest.push(j);

  const candL = leftRest.filter((i) => isContainer(leftItems[i]));
  const candR = rightRest.filter((j) => isContainer(rightItems[j]));
  const pairedL = new Set();
  const pairedR = new Set();

  if (candL.length > 0 && candR.length > 0) {
    const scored = [];
    const consider = (i, j, li, lj) => {
      if (leftItems[i].kind !== rightItems[j].kind) return;
      const score = similarity(leftItems[i], rightItems[j], hasher);
      if (score > SIMILARITY_THRESHOLD) {
        const distance = Math.abs(li / candL.length - lj / candR.length);
        scored.push({ i, j, score, distance });
      }
    };

    if (candL.length * candR.length <= FULL_SCORE_LIMIT) {
      candL.forEach((i, li) => candR.forEach((j, lj) => consider(i, j, li, lj)));
    } else {
      // Large: pair by an identifying key first, then compare each leftover
      // only with leftovers near the same relative position.
      const idKey = commonIdKey(candL.map((i) => leftItems[i]), candR.map((j) => rightItems[j]));
      if (idKey !== null) {
        const byId = new Map();
        for (const j of candR) {
          const v = rightItems[j].entries.find((e) => e.key === idKey).value;
          const h = hasher.hash(v);
          if (!byId.has(h)) byId.set(h, []);
          byId.get(h).push(j);
        }
        for (const i of candL) {
          const v = leftItems[i].entries.find((e) => e.key === idKey).value;
          const queue = byId.get(hasher.hash(v));
          if (queue && queue.length > 0) {
            const j = queue.shift();
            pairs.push([i, j]);
            pairedL.add(i);
            pairedR.add(j);
          }
        }
      }
      const restL = candL.filter((i) => !pairedL.has(i));
      const restR = candR.filter((j) => !pairedR.has(j));
      restL.forEach((i, li) => {
        const centre = Math.round((li / Math.max(restL.length, 1)) * restR.length);
        for (let lj = Math.max(0, centre - WINDOW); lj < Math.min(restR.length, centre + WINDOW); lj++) {
          consider(i, restR[lj], li, lj);
        }
      });
    }

    scored.sort((x, y) => y.score - x.score || x.distance - y.distance || x.i - y.i);
    for (const { i, j } of scored) {
      if (pairedL.has(i) || pairedR.has(j)) continue;
      pairedL.add(i);
      pairedR.add(j);
      pairs.push([i, j]);
    }
  }

  return {
    pairs,
    leftOnly: leftRest.filter((i) => !pairedL.has(i)),
    rightOnly: rightRest.filter((j) => !pairedR.has(j)),
  };
}

/**
 * Compare two documents.
 *
 * @returns {{ root: DiffNode, counts: { added, missing, changed, type }, equal: boolean }}
 *
 * DiffNode: {
 *   status:  'equal' | 'changed' | 'type' | 'missing' | 'added',
 *   left, right:            AST nodes (null on the side it is missing from)
 *   leftEntry, rightEntry:  the object member ({ key, keyToken, value }) when it is one
 *   children:               DiffNode[] for a changed object or array, else null
 * }
 *
 * 'missing' is only on the left, 'added' only on the right. counts has one
 * per difference: an added or missing subtree counts once, a changed or
 * retyped value once, and a changed container counts only its differences.
 */
export function diffJson(left, right) {
  const hasher = new Hasher();
  const counts = { added: 0, missing: 0, changed: 0, type: 0 };

  const only = (node, entry, side) => {
    counts[side === "left" ? "missing" : "added"]++;
    return side === "left"
      ? { status: "missing", left: node, right: null, leftEntry: entry, rightEntry: null, children: null }
      : { status: "added", left: null, right: node, leftEntry: null, rightEntry: entry, children: null };
  };

  // Recursion follows the JSON nesting, which MAX_DIFF_DEPTH bounds.
  const compare = (a, b, aEntry, bEntry, depth) => {
    const node = { status: "equal", left: a, right: b, leftEntry: aEntry, rightEntry: bEntry, children: null };
    if (hasher.hash(a) === hasher.hash(b)) return node;
    if (a.kind !== b.kind) {
      node.status = "type";
      counts.type++;
      return node;
    }
    node.status = "changed";
    if (!isContainer(a) || depth >= MAX_DIFF_DEPTH) {
      counts.changed++;
      return node;
    }
    const children = [];
    if (a.kind === "object") {
      const byKey = new Map();
      for (const e of b.entries) {
        if (!byKey.has(e.key)) byKey.set(e.key, []);
        byKey.get(e.key).push(e);
      }
      const usedRight = new Set();
      for (const e of a.entries) {
        const match = byKey.get(e.key)?.shift();
        if (match) {
          usedRight.add(match);
          children.push(compare(e.value, match.value, e, match, depth + 1));
        } else {
          children.push(only(e.value, e, "left"));
        }
      }
      for (const e of b.entries) if (!usedRight.has(e)) children.push(only(e.value, e, "right"));
    } else {
      const { pairs, leftOnly, rightOnly } = pairItems(a.items, b.items, hasher);
      for (const [i, j] of pairs) children.push(compare(a.items[i], b.items[j], null, null, depth + 1));
      for (const i of leftOnly) children.push(only(a.items[i], null, "left"));
      for (const j of rightOnly) children.push(only(b.items[j], null, "right"));
    }
    node.children = children;
    return node;
  };

  const root = compare(left, right, null, null, 0);
  return { root, counts, equal: root.status === "equal", hasher };
}

/** Total number of differences in a counts object. */
export function totalDifferences(counts) {
  return counts.added + counts.missing + counts.changed + counts.type;
}
