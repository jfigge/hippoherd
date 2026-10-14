/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of JsonHippo.
 *
 * JsonHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * JsonHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with JsonHippo. If not, see <https://www.gnu.org/licenses/>.
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
