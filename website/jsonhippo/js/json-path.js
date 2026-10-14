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
 * json-path.js — writing paths ($.items[3].name) and reading the simple path
 * queries the tree filter accepts ($.items[*].name).
 *
 * A path is held as an array of segments: a string for an object key, a
 * number for an array index. formatPath turns that into text.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

// Keys that can be written with a dot. Anything else goes in ["brackets"].
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Quote a string as a JSON string literal (the parser's inverse). */
export function quoteString(s) {
  let out = '"';
  let chunkStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let esc = null;
    if (c === 0x22) esc = '\\"';
    else if (c === 0x5c) esc = "\\\\";
    else if (c < 0x20) {
      esc = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" }[c] ?? `\\u${c.toString(16).padStart(4, "0")}`;
    }
    if (esc !== null) {
      out += s.slice(chunkStart, i) + esc;
      chunkStart = i + 1;
    }
  }
  return `${out}${s.slice(chunkStart)}"`;
}

/** ['items', 3, 'first name'] → $.items[3]["first name"] */
export function formatPath(segments) {
  let out = "$";
  for (const segment of segments) {
    if (typeof segment === "number") out += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) out += `.${segment}`;
    else out += `[${quoteString(segment)}]`;
  }
  return out;
}

/** Raised for a path query that cannot be read; `index` is where it went wrong. */
export class PathSyntaxError extends Error {
  constructor(message, index) {
    super(message);
    this.name = "PathSyntaxError";
    this.index = index;
  }
}

/**
 * Read a path query into steps. Supported, deliberately small:
 *
 *   $              the root
 *   .name  ["name"] ['name']   a key
 *   [3]            an array index
 *   .*  [*]        every child
 *   ..name  ..*    descendants at any depth (recursive descent)
 *
 * Returns [{ type: 'key', key } | { type: 'index', index } |
 *          { type: 'wildcard' } | { type: 'descend' }, …]
 */
export function parsePathQuery(query) {
  const q = query.trim();
  if (q[0] !== "$") throw new PathSyntaxError("A path starts with $", 0);
  const steps = [];
  let i = 1;

  while (i < q.length) {
    const c = q[i];
    if (c === ".") {
      i++;
      if (q[i] === ".") {
        steps.push({ type: "descend" });
        i++;
      }
      if (q[i] === "*") {
        steps.push({ type: "wildcard" });
        i++;
        continue;
      }
      const start = i;
      while (i < q.length && /[A-Za-z0-9_$-]/.test(q[i])) i++;
      if (i === start) {
        const afterDescend = steps.length > 0 && steps[steps.length - 1].type === "descend";
        throw new PathSyntaxError(afterDescend ? "Expected a key or '*' after '..'" : "Expected a key name after '.'", start);
      }
      steps.push({ type: "key", key: q.slice(start, i) });
    } else if (c === "[") {
      i++;
      if (q[i] === "*") {
        if (q[i + 1] !== "]") throw new PathSyntaxError("Expected ']' after '[*'", i + 1);
        steps.push({ type: "wildcard" });
        i += 2;
      } else if (q[i] === '"' || q[i] === "'") {
        const quote = q[i];
        let key = "";
        i++;
        while (i < q.length && q[i] !== quote) {
          if (q[i] === "\\" && i + 1 < q.length) i++;
          key += q[i++];
        }
        if (q[i] !== quote) throw new PathSyntaxError("Unterminated quoted key", i);
        if (q[i + 1] !== "]") throw new PathSyntaxError("Expected ']' after the quoted key", i + 1);
        steps.push({ type: "key", key });
        i += 2;
      } else {
        const start = i;
        while (i < q.length && q[i] >= "0" && q[i] <= "9") i++;
        if (i === start) throw new PathSyntaxError("Expected an index, '*' or a quoted key after '['", start);
        if (q[i] !== "]") throw new PathSyntaxError("Expected ']' after the index", i);
        steps.push({ type: "index", index: Number(q.slice(start, i)) });
        i++;
      }
    } else {
      throw new PathSyntaxError(`Unexpected '${c}' in path`, i);
    }
  }
  return steps;
}

/** The children of an AST node as [segment, node] pairs, in source order. */
export function childEntries(node) {
  if (node.kind === "object") return node.entries.map((e) => [e.key, e.value]);
  if (node.kind === "array") return node.items.map((item, i) => [i, item]);
  return [];
}
