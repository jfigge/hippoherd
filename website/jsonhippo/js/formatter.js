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
 * formatter.js — pretty-print and minify, written out from the AST.
 *
 * Not JSON.stringify: going through JS values would round 12345678901234567890
 * to 12345678901234567000, collapse duplicate keys, and re-escape every string.
 * Writing from the AST keeps each number's and each string's source text
 * exactly, and keeps keys in source order, duplicates included.
 *
 * Iterative, like the parser, so a document nested 10,000 deep formats
 * without overflowing the call stack.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { quoteString } from "./json-path.js";

/** The indent settings the UI offers, by name. */
export const INDENTS = Object.freeze({ 2: "  ", 4: "    ", tab: "\t" });

/** Pretty-print `node` (any AST node, so a subtree works too). */
export function format(node, { indent = "  " } = {}) {
  return write(node, indent);
}

/** The most compact form: no whitespace at all outside strings. */
export function minify(node) {
  return write(node, "");
}

function scalarText(node) {
  switch (node.kind) {
    case "string":
    case "number":
      return node.raw;
    case "boolean":
      return node.value ? "true" : "false";
    default:
      return "null";
  }
}

function keyText(entry) {
  return entry.keyToken ? entry.keyToken.raw : quoteString(entry.key);
}

function write(root, indent) {
  const pretty = indent !== "";
  const colon = pretty ? ": " : ":";

  // Indent strings for the first levels are built once; deeper ones are rare
  // enough to build on demand (caching 10,000 of them would cost ~100 MB).
  const cache = [""];
  const pad = (depth) => {
    if (depth < 64) {
      while (cache.length <= depth) cache.push(cache[cache.length - 1] + indent);
      return cache[depth];
    }
    return indent.repeat(depth);
  };

  let out = "";
  const stack = []; // { children, isObject, i, depth } for each open container

  // Write a value's opening (or the whole of it, for scalars and empty
  // containers), pushing a frame when it has children still to write.
  const open = (node, depth) => {
    if (node.kind === "object" || node.kind === "array") {
      const isObject = node.kind === "object";
      const children = isObject ? node.entries : node.items;
      if (children.length === 0) {
        out += isObject ? "{}" : "[]";
      } else {
        out += isObject ? "{" : "[";
        stack.push({ children, isObject, i: 0, depth });
      }
    } else {
      out += scalarText(node);
    }
  };

  open(root, 0);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i === frame.children.length) {
      stack.pop();
      if (pretty) out += `\n${pad(frame.depth)}`;
      out += frame.isObject ? "}" : "]";
      continue;
    }
    if (frame.i > 0) out += ",";
    if (pretty) out += `\n${pad(frame.depth + 1)}`;
    const child = frame.children[frame.i++];
    if (frame.isObject) {
      out += keyText(child) + colon;
      open(child.value, frame.depth + 1);
    } else {
      open(child, frame.depth + 1);
    }
  }
  return out;
}
