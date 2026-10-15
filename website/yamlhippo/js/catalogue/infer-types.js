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
 * infer-types.js — a reference for every custom type in a document.
 *
 * A custom tag (!Person, !Ref) names a type the document's reader knows and
 * YAML does not. Nothing declares what a !Person has in it, so this works it
 * out from the uses: every node tagged !Person, in every document of the
 * stream, is read and the uses are unioned into one reference —
 *
 *   - what kind of node the tag goes on (a mapping, a list, a scalar);
 *   - for mappings, every field seen: in how many uses it appears, so
 *     ALWAYS (in every use) from OPTIONAL, and the type(s) of its value;
 *   - for lists, the types of the items; for scalars, the types and some
 *     example values;
 *   - INCONSISTENCIES: a field whose value is a number in some uses and a
 *     string in others (age: 36 / age: "forty"), or a tag that is a mapping
 *     here and a scalar there. Each one lists the odd uses out, so they can
 *     be visited.
 *
 * A value's type is its kind — string, integer, number, boolean, null,
 * mapping, list — or, when it carries a custom tag itself, that tag: a
 * field `address: !Address {…}` has type !Address, which links the types
 * into a graph. Integers and other numbers are one type ("number") for
 * consistency, as a reader would treat them; null is reported as "nullable",
 * not as a clash.
 *
 * Only explicitly tagged nodes are profiled. Repeated untagged structures
 * are a separate feature.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { valueText, walk } from "../tree-search.js";
import { assignTagColors } from "../tag-colors.js";
import { isIntegerLiteral } from "../numbers.js";

/** Example values kept per scalar type. */
const MAX_EXAMPLES = 5;
/** Odd uses listed per inconsistency. */
const MAX_ODD = 20;

/** The type a value is reported as. */
export function typeOf(node) {
  if (node.kind === "alias") return typeOf(node.target);
  if (node.tag && node.tag.custom) return node.tag.name;
  switch (node.kind) {
    case "object":
      return "mapping";
    case "array":
      return "list";
    case "number":
      return node.json != null && isIntegerLiteral(node.json) ? "integer" : "number";
    default:
      return node.kind;
  }
}

/** Integers are numbers, for telling whether a field is consistent. */
const family = (type) => (type === "integer" ? "number" : type);

/** kind → how a tag's use reads ("mapping", "list", "scalar"). */
const useKind = (node) => (node.kind === "object" ? "mapping" : node.kind === "array" ? "list" : "scalar");

class TypeTally {
  constructor() {
    this.types = new Map(); // type → { count, nodes: [first few] }
  }

  add(type, node) {
    let t = this.types.get(type);
    if (!t) {
      t = { count: 0, nodes: [] };
      this.types.set(type, t);
    }
    t.count++;
    if (t.nodes.length < MAX_ODD) t.nodes.push(node);
  }

  /** The distinct type families, null aside. */
  families() {
    return new Set([...this.types.keys()].filter((t) => t !== "null").map(family));
  }

  get nullable() {
    return this.types.has("null");
  }

  get inconsistent() {
    return this.families().size > 1;
  }

  /**
   * The odd ones out: the uses whose type family is not the most common.
   * [{ type, node }]
   */
  odd() {
    if (!this.inconsistent) return [];
    const byFamily = new Map();
    for (const [type, t] of this.types) {
      if (type === "null") continue;
      const f = family(type);
      byFamily.set(f, (byFamily.get(f) ?? 0) + t.count);
    }
    const main = [...byFamily].sort((a, b) => b[1] - a[1])[0][0];
    const out = [];
    for (const [type, t] of this.types) {
      if (type === "null" || family(type) === main) continue;
      for (const node of t.nodes) if (out.length < MAX_ODD) out.push({ type, node });
    }
    return out;
  }

  /** [{ type, count }], most common first. */
  list() {
    return [...this.types].map(([type, t]) => ({ type, count: t.count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }
}

/**
 * @param documents  the parse result's documents ([{ ast }])
 * @param options    { colors: Map name → palette index, to match the tree's }
 * @returns [{
 *   name, color, count,
 *   kinds:   [{ kind: 'mapping'|'list'|'scalar', count }],
 *   fields:  [{ key, present, always, types: [{ type, count }], nullable, inconsistent, odd: [{ type, node }] }],
 *   items:   { types, nullable, inconsistent, odd } | null   (list uses)
 *   values:  { types, nullable, inconsistent, odd, examples: [text] } | null   (scalar uses)
 *   nodes:   the tagged nodes, in document order
 *   inconsistent: whether anything above disagrees
 * }]  in order of first appearance.
 */
export function inferTypes(documents, { colors = null } = {}) {
  const types = new Map();
  for (const doc of documents) {
    if (!doc.ast) continue;
    walk(doc.ast, (node) => {
      if (!node.tag || !node.tag.custom) return;
      let t = types.get(node.tag.name);
      if (!t) {
        t = { name: node.tag.name, nodes: [], kinds: new Map(), fields: new Map(), mappings: 0, items: null, values: null };
        types.set(node.tag.name, t);
      }
      t.nodes.push(node);
      const kind = useKind(node);
      t.kinds.set(kind, (t.kinds.get(kind) ?? 0) + 1);
      if (node.kind === "object") {
        t.mappings++;
        const seen = new Set();
        for (const entry of node.entries) {
          let f = t.fields.get(entry.key);
          if (!f) {
            f = { key: entry.key, present: 0, tally: new TypeTally(), order: t.fields.size };
            t.fields.set(entry.key, f);
          }
          if (!seen.has(entry.key)) {
            seen.add(entry.key);
            f.present++;
          }
          f.tally.add(typeOf(entry.value), entry.value);
        }
      } else if (node.kind === "array") {
        t.items ??= new TypeTally();
        for (const item of node.items) t.items.add(typeOf(item), item);
      } else {
        t.values ??= { tally: new TypeTally(), examples: [] };
        // The tag decides what the text means, so the type is what the text
        // would be read as without it.
        t.values.tally.add(scalarType(node), node);
        const text = valueText(node) ?? "";
        if (t.values.examples.length < MAX_EXAMPLES && !t.values.examples.includes(text)) t.values.examples.push(text);
      }
    });
  }

  const palette = colors ?? assignTagColors([...types.keys()]);
  return [...types.values()].map((t) => {
    const fields = [...t.fields.values()].map((f) => ({
      key: f.key,
      present: f.present,
      always: f.present === t.mappings,
      types: f.tally.list(),
      nullable: f.tally.nullable,
      inconsistent: f.tally.inconsistent,
      odd: f.tally.odd(),
    }));
    const summary = (tally) => (tally ? { types: tally.list(), nullable: tally.nullable, inconsistent: tally.inconsistent, odd: tally.odd() } : null);
    const items = summary(t.items);
    const values = t.values ? { ...summary(t.values.tally), examples: t.values.examples } : null;
    const kinds = [...t.kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
    return {
      name: t.name,
      color: palette.get(t.name) ?? 0,
      count: t.nodes.length,
      mappings: t.mappings,
      kinds,
      fields,
      items,
      values,
      nodes: t.nodes,
      inconsistent: kinds.length > 1 || fields.some((f) => f.inconsistent) || Boolean(items?.inconsistent) || Boolean(values?.inconsistent),
    };
  });
}

/** What a tagged scalar's text looks like: a number, a boolean … or text. */
function scalarType(node) {
  if (node.style !== "plain") return "string";
  const text = node.value;
  if (/^[-+]?[0-9]+$/.test(text)) return "integer";
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(text)) return "number";
  if (/^(?:true|false|True|False|TRUE|FALSE)$/.test(text)) return "boolean";
  if (text === "" || text === "~" || /^(?:null|Null|NULL)$/.test(text)) return "null";
  return "string";
}
