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
 * reorder.js — the Reorder switch: lay one document out in the other's order.
 *
 * The slave's object members follow the master's key order, and its array
 * elements follow the order of the master elements they pair with (the same
 * pairing the diff uses). Members and elements found only in the slave go
 * after the matched ones, in their own original order. Recursive.
 *
 * Only order changes. The result is a reordered copy of the slave's AST whose
 * leaves are the slave's own nodes, so formatter.js writes every key, string
 * and number from its original source text — escapes and number spelling
 * included.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { Hasher, pairItems } from "./json-diff.js";

/** Deeper than this, a subtree keeps its own order. */
const MAX_REORDER_DEPTH = 1000;

/** A copy of `slave` with its members and elements in `master`'s order. */
export function reorderToFollow(slave, master, hasher = new Hasher()) {
  const visit = (s, m, depth) => {
    if (depth >= MAX_REORDER_DEPTH || s.kind !== m.kind) return s;

    if (s.kind === "object") {
      const byKey = new Map();
      for (const e of s.entries) {
        if (!byKey.has(e.key)) byKey.set(e.key, []);
        byKey.get(e.key).push(e);
      }
      const used = new Set();
      const entries = [];
      for (const me of m.entries) {
        const se = byKey.get(me.key)?.shift();
        if (se) {
          used.add(se);
          entries.push({ ...se, value: visit(se.value, me.value, depth + 1) });
        }
      }
      for (const se of s.entries) if (!used.has(se)) entries.push(se);
      return { ...s, entries };
    }

    if (s.kind === "array") {
      const { pairs } = pairItems(m.items, s.items, hasher);
      const slaveFor = new Map(pairs); // master index → slave index
      const used = new Set();
      const items = [];
      m.items.forEach((mi, i) => {
        const j = slaveFor.get(i);
        if (j !== undefined) {
          used.add(j);
          items.push(visit(s.items[j], mi, depth + 1));
        }
      });
      s.items.forEach((si, j) => {
        if (!used.has(j)) items.push(si);
      });
      return { ...s, items };
    }

    return s;
  };
  return visit(slave, master, 0);
}
