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
 * tree-search.js — the tree filter's search, run against the AST.
 *
 * The tree renders lazily, so most nodes are not in the DOM when a filter is
 * typed; searching the DOM would miss them. This walks the AST instead and
 * reports every match, plus what the view needs to show them: each match's
 * path, the ancestors that must be expanded, and a parent map to walk up.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { parsePathQuery, PathSyntaxError } from "./json-path.js";

export class SearchError extends Error {
  constructor(message) {
    super(message);
    this.name = "SearchError";
  }
}

/** The text a scalar is matched (and displayed) as. */
export function valueText(node) {
  switch (node.kind) {
    case "string":
      return node.value;
    case "number":
      return node.raw;
    case "boolean":
      return node.value ? "true" : "false";
    case "null":
      return "null";
    default:
      return null;
  }
}

/** A query that starts like a path ($, $. or $[) and is not a regex search. */
export function isPathQuery(query, { regex = false } = {}) {
  const q = query.trim();
  return !regex && q[0] === "$" && (q.length === 1 || q[1] === "." || q[1] === "[");
}

/**
 * Search the AST.
 *
 * @param ast      root node from parse()
 * @param query    text, a regex source (regex: true), or a $-path
 * @param options  { scope: 'keys' | 'values' | 'both', caseSensitive, regex }
 * @returns {{
 *   matches:   [{ node, segments, key: [start, end] | null, value: [start, end] | null }],
 *   ancestors: Set<node>,       containers that hold at least one match
 *   parents:   Map<node, node>, parent of every match and ancestor
 *   mode:      'text' | 'regex' | 'path'
 * }}
 *   Matches are in document order. key/value are the matched range within
 *   the key or value text, for highlighting; null when that part did not
 *   match (and both null for a path match, which matches the whole node).
 * @throws {SearchError} for an invalid regex or path — never anything else.
 */
export function searchAst(ast, query, { scope = "both", caseSensitive = false, regex = false } = {}) {
  if (isPathQuery(query, { regex })) return searchPath(ast, query);

  let test;
  if (regex) {
    let re;
    try {
      re = new RegExp(query, caseSensitive ? "" : "i");
    } catch (err) {
      throw new SearchError(`Invalid regex: ${err.message.replace(/^Invalid regular expression: /, "")}`);
    }
    test = (text) => {
      const m = re.exec(text);
      return m === null ? null : [m.index, m.index + m[0].length];
    };
  } else {
    const needle = caseSensitive ? query : query.toLowerCase();
    test = (text) => {
      const i = (caseSensitive ? text : text.toLowerCase()).indexOf(needle);
      return i < 0 ? null : [i, i + needle.length];
    };
  }

  const checkKeys = scope !== "values";
  const checkValues = scope !== "keys";
  const result = { matches: [], ancestors: new Set(), parents: new Map(), mode: regex ? "regex" : "text" };

  walk(ast, (node, key, segments, frames) => {
    const keyHit = checkKeys && key !== undefined ? test(key) : null;
    const text = checkValues ? valueText(node) : null;
    const valueHit = text !== null ? test(text) : null;
    if (keyHit !== null || valueHit !== null) {
      record(result, node, segments, frames, keyHit, valueHit);
    }
  });
  return result;
}

function searchPath(ast, query) {
  let steps;
  try {
    steps = parsePathQuery(query);
  } catch (err) {
    if (err instanceof PathSyntaxError) throw new SearchError(`Invalid path: ${err.message} (at character ${err.index + 1})`);
    throw err;
  }
  const result = { matches: [], ancestors: new Set(), parents: new Map(), mode: "path" };

  // A node matches when its segments satisfy the steps. Walking the whole
  // tree once and testing each node's path keeps matches in document order
  // and handles '..' without a second traversal strategy.
  walk(ast, (node, _key, segments, frames) => {
    if (pathMatches(steps, 0, segments, 0)) record(result, node, segments, frames, null, null);
  });
  return result;
}

/** Do segments[j…] satisfy steps[i…]? */
function pathMatches(steps, i, segments, j) {
  if (i === steps.length) return j === segments.length;
  const step = steps[i];
  if (step.type === "descend") {
    // '..' then the next step may consume any later segment.
    for (let k = j; k < segments.length; k++) {
      if (pathMatches(steps, i + 1, segments, k)) return true;
    }
    return false;
  }
  if (j === segments.length) return false;
  const segment = segments[j];
  const ok =
    step.type === "wildcard" ||
    (step.type === "key" && typeof segment === "string" && segment === step.key) ||
    (step.type === "index" && typeof segment === "number" && segment === step.index);
  return ok && pathMatches(steps, i + 1, segments, j + 1);
}

function record(result, node, segments, frames, keyHit, valueHit) {
  result.matches.push({ node, segments: segments.slice(), key: keyHit, value: valueHit });
  // Mark every container on the way up, stopping at the first one already
  // marked: the rest of the chain above it was marked by an earlier match.
  let child = node;
  for (let d = frames.length - 1; d >= 0; d--) {
    const parent = frames[d].node;
    result.parents.set(child, parent);
    if (result.ancestors.has(parent)) break;
    result.ancestors.add(parent);
    child = parent;
  }
}

/**
 * Visit every node in document order: visit(node, key, segments, frames).
 * `key` is the member key for object members, undefined otherwise;
 * `segments` is the node's path; `frames` holds the open containers above it.
 * Both arrays are live — copy them to keep them. Iterative, so depth is not
 * limited by the call stack.
 */
export function walk(ast, visit) {
  const frames = [];
  const segments = [];

  const enter = (node, key) => {
    visit(node, key, segments, frames);
    const children = node.kind === "object" ? node.entries : node.kind === "array" ? node.items : null;
    if (children !== null && children.length > 0) frames.push({ node, children, i: 0 });
  };

  enter(ast, undefined);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.i === frame.children.length) {
      frames.pop();
      segments.length = frames.length;
      continue;
    }
    const index = frame.i++;
    segments.length = frames.length - 1;
    if (frame.node.kind === "object") {
      const entry = frame.children[index];
      segments.push(entry.key);
      enter(entry.value, entry.key);
    } else {
      segments.push(index);
      enter(frame.children[index], undefined);
    }
  }
}
