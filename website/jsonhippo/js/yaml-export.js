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
 * yaml-export.js — Copy as YAML: the AST written out as block-style YAML.
 *
 * Written from the AST, like formatter.js, so numbers keep their source text
 * (12345678901234567890 stays every digit) and keys stay in source order,
 * duplicates included — although YAML forbids duplicate keys, so they are
 * counted for the caller to report.
 *
 * Layout, the same as YamlHippo's Format:
 *
 *   key: value           a mapping, one entry per line
 *   list:                a sequence, indented under its key
 *     - 1
 *     - name: x          a collection in a sequence starts on the dash's line
 *       size: 2
 *   empty: {}            an empty collection stays flow
 *
 * A string is written plain only when every YAML reader (1.1 or 1.2) reads
 * it back as that same string; anything that could be taken for a number,
 * boolean, null or date ("1.0", "yes", "~", "2026-10-18"), or that has a
 * character YAML gives meaning to, is double-quoted.
 *
 * Iterative, like the parser: depth is not limited by the call stack.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { quoteString } from "./json-path.js";

/** YAML has no tab indentation: the `tab` setting is written with 2 spaces. */
export const YAML_INDENTS = Object.freeze({ 2: 2, 4: 4, tab: 2 });

/** An implicit key may be at most this long; longer ones need `? key`. */
const KEY_LIMIT = 1024;

const INDICATOR_START = new Set([..."-?:,[]{}#&*!|>'\"%@`"]);

/**
 * Write `node` (any AST node) as YAML.
 * @returns { text, duplicates } — duplicates: how many keys repeat an
 *          earlier key of the same object
 */
export function toYaml(node, { indent = 2 } = {}) {
  let out = "";
  let duplicates = 0;
  const stack = []; // { children, isObject, i, col, inline } for each open collection

  const spaces = (n) => " ".repeat(n);
  const isEmpty = (n) => (n.kind === "object" ? n.entries.length === 0 : n.kind === "array" && n.items.length === 0);
  const isCollection = (n) => (n.kind === "object" || n.kind === "array") && !isEmpty(n);

  // Open a collection whose entries start at `col`. `inline`: the first entry
  // goes on the current line (after a dash, or at the root).
  const open = (n, col, inline) => {
    const isObject = n.kind === "object";
    const children = isObject ? n.entries : n.items;
    if (isObject) duplicates += countDuplicates(n.entries);
    stack.push({ children, isObject, i: 0, col, inline });
  };

  if (isCollection(node)) open(node, 0, true);
  else out += `${scalarText(node)}\n`;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i === frame.children.length) {
      stack.pop();
      continue;
    }
    const pad = frame.i === 0 && frame.inline ? "" : spaces(frame.col);
    const child = frame.children[frame.i++];
    if (frame.isObject) {
      const key = keyText(child.key);
      out += key.length > KEY_LIMIT ? `${pad}? ${key}\n${spaces(frame.col)}:` : `${pad}${key}:`;
      if (isCollection(child.value)) {
        out += "\n";
        open(child.value, frame.col + indent, false);
      } else {
        out += ` ${scalarText(child.value)}\n`;
      }
    } else if (isCollection(child)) {
      out += `${pad}- `;
      open(child, frame.col + 2, true);
    } else {
      out += `${pad}- ${scalarText(child)}\n`;
    }
  }
  return { text: out, duplicates };
}

function countDuplicates(entries) {
  if (entries.length < 2) return 0;
  const seen = new Set();
  let n = 0;
  for (const { key } of entries) {
    if (seen.has(key)) n++;
    else seen.add(key);
  }
  return n;
}

function scalarText(node) {
  switch (node.kind) {
    case "object":
      return "{}";
    case "array":
      return "[]";
    case "string":
      return plainSafe(node.value) ? node.value : yamlQuote(node.value);
    case "number":
      return node.raw;
    case "boolean":
      return node.value ? "true" : "false";
    default:
      return "null";
  }
}

function keyText(key) {
  return plainSafe(key, true) ? key : yamlQuote(key);
}

/**
 * A YAML double-quoted string. JSON's escapes are all YAML escapes too; YAML
 * also wants DEL, the C1 controls and the Unicode line separators escaped.
 */
export function yamlQuote(s) {
  return quoteString(s).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Can `text` be written as a plain scalar and read back as the same string by any YAML reader? */
export function plainSafe(text, isKey = false) {
  if (text === "" || text.length > KEY_LIMIT) return false;
  if (INDICATOR_START.has(text[0])) return false;
  if (text.startsWith("---") || text.startsWith("...")) return false;
  if (/^\s|\s$/.test(text)) return false;
  // eslint-disable-next-line no-control-regex -- control characters must be quoted
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text)) return false;
  if (text.includes(": ") || text.includes(" #") || text.endsWith(":")) return false;
  // Null, booleans (YAML 1.1's yes/no/on/off too), the merge and value keys.
  if (/^(~|null|y|n|yes|no|true|false|on|off|<<|=)$/i.test(text)) return false;
  // Anything number-like: ints, floats, hex, octal, 1_000, 1:30, dates, .inf, .nan.
  if (/^[-+]?\.?\d/.test(text) || /^[-+]?\.(inf|nan)$/i.test(text)) return false;
  if (isKey && /[,[\]{}:]/.test(text)) return false;
  return true;
}
