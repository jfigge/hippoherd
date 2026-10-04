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
 * infer.js — a JSON Schema that describes a sample document.
 *
 * Two steps. First the sample is read into one Shape per position: every
 * element of an array is read into the same Shape (its `items`), and every
 * object at a position shares one map of properties, so differing elements
 * merge as they are read — there is no separate merge step:
 *
 *   Shape { types   — every JSON type seen here (a bit set)
 *           objects — how many objects were seen here
 *           props   — Map key → { shape, present (in how many of those
 *                     objects), raw (the key as first written) }
 *           items   — the Shape of every element of every array seen here }
 *
 * Then each Shape is written out as a schema:
 *
 *   - "type": one type, or a list when several were seen ("string", "null");
 *     integer when every number here was written as an integer, number as
 *     soon as one was written with a fraction or an exponent (1.0 included:
 *     written that way, it says the field is not an integer);
 *   - "properties" for objects, in the order keys were first seen, and
 *     "required": the keys present in every object at that position;
 *   - "items" for arrays: one schema, the merge of all their elements.
 *
 * The schema is built as an AST in the parser's shape, so formatter.js
 * writes it out (no JSON.stringify), and property names keep the exact text
 * they were written with in the sample.
 *
 * Iterative, like the parser and the formatter: depth is not limited by the
 * call stack.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { quoteString } from "../json-path.js";
import { isIntegerLiteral } from "../numbers.js";

export const DRAFTS = Object.freeze({
  "2020-12": "https://json-schema.org/draft/2020-12/schema",
  "07": "http://json-schema.org/draft-07/schema#",
});

/**
 * Each level of the sample is up to two levels of schema ("properties", then
 * the property's schema), and the parser stops at 10,000. Below this depth
 * a position's type is still given, but not what is inside it.
 */
export const MAX_SCHEMA_DEPTH = 4000;

const OBJECT = 1;
const ARRAY = 2;
const STRING = 4;
const INTEGER = 8;
const NUMBER = 16;
const BOOLEAN = 32;
const NULL = 64;

/** Type names in the order a list of them is written. */
const TYPE_ORDER = [
  [OBJECT, "object"],
  [ARRAY, "array"],
  [STRING, "string"],
  [INTEGER, "integer"],
  [NUMBER, "number"],
  [BOOLEAN, "boolean"],
  [NULL, "null"],
];

class Shape {
  constructor(depth) {
    this.depth = depth;
    this.types = 0;
    this.objects = 0;
    this.props = null;
    this.items = null;
  }
}

/**
 * Infer a schema from a parsed document.
 * @param ast      the parser's AST
 * @param options  { draft: '2020-12' | '07', required: whether to list required keys }
 * @returns {{ schema, depthLimited }}  schema is an AST: write it with formatter.format()
 */
export function inferSchema(ast, { draft = "2020-12", required = true } = {}) {
  const { shape, depthLimited } = observe(ast);
  return { schema: emit(shape, { uri: DRAFTS[draft] ?? DRAFTS["2020-12"], required }), depthLimited };
}

/** Read the sample into Shapes. */
function observe(ast) {
  const root = new Shape(0);
  let depthLimited = false;
  let serial = 0; // tells one object from the next, so a duplicate key counts once
  const work = [ast, root];

  while (work.length > 0) {
    const shape = work.pop();
    const node = work.pop();
    switch (node.kind) {
      case "object": {
        shape.types |= OBJECT;
        shape.objects++;
        if (shape.depth >= MAX_SCHEMA_DEPTH) {
          depthLimited ||= node.entries.length > 0;
          break;
        }
        shape.props ??= new Map();
        const id = ++serial;
        for (const entry of node.entries) {
          let prop = shape.props.get(entry.key);
          if (prop === undefined) {
            prop = { shape: new Shape(shape.depth + 1), present: 0, seenIn: 0, raw: entry.keyToken?.raw ?? quoteString(entry.key) };
            shape.props.set(entry.key, prop);
          }
          if (prop.seenIn !== id) {
            prop.seenIn = id;
            prop.present++;
          }
        }
        // Pushed last to first, so they are read first to last.
        for (let i = node.entries.length - 1; i >= 0; i--) {
          const entry = node.entries[i];
          work.push(entry.value, shape.props.get(entry.key).shape);
        }
        break;
      }
      case "array":
        shape.types |= ARRAY;
        if (node.items.length === 0) break;
        if (shape.depth >= MAX_SCHEMA_DEPTH) {
          depthLimited = true;
          break;
        }
        shape.items ??= new Shape(shape.depth + 1);
        for (let i = node.items.length - 1; i >= 0; i--) work.push(node.items[i], shape.items);
        break;
      case "string":
        shape.types |= STRING;
        break;
      case "number":
        shape.types |= isIntegerLiteral(node.raw) ? INTEGER : NUMBER;
        break;
      case "boolean":
        shape.types |= BOOLEAN;
        break;
      default:
        shape.types |= NULL;
    }
  }
  return { shape: root, depthLimited };
}

// ── Writing the schema as an AST (the parts formatter.js reads) ───────────

const str = (value) => ({ kind: "string", value, raw: quoteString(value) });
const member = (key, value) => ({ key, keyToken: null, value });
const object = () => ({ kind: "object", entries: [] });

function typeNode(types) {
  // An integer is a number, so where both were seen it is just "number".
  const t = types & NUMBER ? types & ~INTEGER : types;
  const names = TYPE_ORDER.filter(([bit]) => t & bit).map(([, name]) => str(name));
  return names.length === 1 ? names[0] : { kind: "array", items: names };
}

function emit(root, { uri, required }) {
  const top = object();
  top.entries.push(member("$schema", str(uri)));
  const work = [root, top];

  while (work.length > 0) {
    const out = work.pop();
    const shape = work.pop();
    out.entries.push(member("type", typeNode(shape.types)));

    if (shape.props !== null && shape.props.size > 0) {
      const properties = object();
      const always = [];
      for (const [key, prop] of shape.props) {
        const schema = object();
        properties.entries.push({ key, keyToken: { raw: prop.raw }, value: schema });
        work.push(prop.shape, schema);
        if (prop.present === shape.objects) always.push({ kind: "string", value: key, raw: prop.raw });
      }
      out.entries.push(member("properties", properties));
      if (required && always.length > 0) out.entries.push(member("required", { kind: "array", items: always }));
    }

    if (shape.items !== null) {
      const items = object();
      out.entries.push(member("items", items));
      work.push(shape.items, items);
    }
  }
  return top;
}
