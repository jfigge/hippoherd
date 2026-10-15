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
 * yaml-emitter.js — Format: the tree written back out as tidy YAML.
 *
 * Written from the tree, not from JS values, so nothing the parse kept is
 * lost: keys stay in source order (duplicates included), every scalar keeps
 * its source text where that text can stand on one line (12345678901234567890
 * stays every digit, 'single' stays single-quoted, 0x1F stays hex), tags,
 * anchors and aliases stay, and so do comments — each one before the entry it
 * preceded, or at the end of the line it ended.
 *
 * What Format normalises:
 *   - a quoted key that reads the same without quotes ("name": → name:);
 *   - indentation, to 2 or 4 spaces per level, lists indented under their key;
 *   - block style for collections — except a short flow collection of
 *     scalars ([a, b], {x: 1}) that fits on its line, which stays flow;
 *   - a scalar that ran over several lines (plain or quoted) goes on one line,
 *     double-quoted if it has to be; block scalars (| and >) are re-indented
 *     line for line and keep their chomping.
 *
 * Iterative, like the parser: depth is not limited by the call stack.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { quoteString } from "./json-path.js";
import { resolvePlain } from "./parser/resolve.js";

/** The indent settings the UI offers, by name. */
export const INDENTS = Object.freeze({ 2: 2, 4: 4 });

/** A kept flow collection may be at most this wide, indentation included. */
const FLOW_WIDTH = 80;

const INDICATOR_START = new Set([..."-?:,[]{}#&*!|>'\"%@`"]);

/**
 * Write a parse result (or a single node) as YAML.
 * @param input   the result of parse() — { documents, comments } — or a node
 * @param options { indent: 2 | 4, comments: true to keep them (default),
 *                  flow: false to write every collection in block style — one
 *                  entry per line, which is what the Diff tab aligns on,
 *                  plain: true to drop the quotes from every string that reads
 *                  the same without them — JSON converted to YAML }
 */
export function emitYaml(input, { indent = 2, comments = true, flow = true, plain = false } = {}) {
  const docs = input.documents ?? [{ ast: input, start: input.start ?? null }];
  const all = comments && input.comments ? input.comments : [];
  const out = [];
  let ci = 0;
  docs.forEach((doc, d) => {
    const next = docs[d + 1];
    const directives = Boolean(doc.version) || Object.keys(doc.tags ?? {}).length > 0;
    // Comments before the document (before its '---') go first.
    const docStart = doc.start?.offset ?? 0;
    while (ci < all.length && all[ci].offset < docStart) out.push(`#${all[ci++].text}`);
    if (directives) {
      if (d > 0) out.push("...");
      if (doc.version) out.push(`%YAML ${doc.version.join(".")}`);
      for (const [handle, prefix] of Object.entries(doc.tags ?? {})) out.push(`%TAG ${handle} ${prefix}`);
    }
    if (docs.length > 1 || doc.explicitStart || directives) out.push("---");
    const until = next?.start?.offset ?? Infinity;
    const lines = [];
    ci = writeDocument(doc.ast, lines, { step: indent, comments: all, ci, until, keepFlow: flow, plain });
    out.push(...lines);
  });
  while (ci < all.length) out.push(`#${all[ci++].text}`);
  return `${out.join("\n")}\n`;
}

function pad(n) {
  return " ".repeat(n);
}

/**
 * Write one document's root into `lines`. Returns the index of the first
 * comment not yet written.
 */
function writeDocument(root, lines, { step, comments, ci, until, keepFlow, plain }) {
  if (!root) return ci;

  const flush = (before, indentation) => {
    while (ci < comments.length && comments[ci].offset < before && comments[ci].offset < until) {
      const c = comments[ci++];
      if (c.ownLine || lines.length === 0) lines.push(`${pad(indentation)}#${c.text}`);
      else lines[lines.length - 1] += ` #${c.text}`;
    }
  };

  // Tasks, innermost last:
  //   { t: 'value', node, lead, type, indent }
  //     lead   the text before the value on its first line
  //     type   'root' | 'item' (after "- " or "? " or ": ": a block mapping
  //            or list may start on the same line) | 'value' (after "key:")
  //     indent the column nested block content starts at
  //   { t: 'entries' | 'items', node, i, indent, first } — a block collection
  //     being written; `first` is the lead its first child continues, or null
  const tasks = [{ t: "value", node: root, lead: "", type: "root", indent: 0 }];

  while (tasks.length > 0) {
    const task = tasks[tasks.length - 1];

    if (task.t === "entries") {
      const entries = task.node.entries;
      if (task.i === entries.length) {
        tasks.pop();
        continue;
      }
      const entry = entries[task.i++];
      const keyNode = entry.keyNode ?? { kind: "string", value: entry.key };
      const start = keyNode.start?.offset ?? entry.value.start?.offset;
      if (start !== undefined) flush(start, task.indent);
      const lead = task.first !== null && task.i === 1 ? task.first : pad(task.indent);
      const key = inlineKey(keyNode);
      if (key === null) {
        // A collection (or block scalar) as a key: "? key" then ": value".
        tasks.push({ t: "value", node: entry.value, lead: `${pad(task.indent)}: `, type: "item", indent: task.indent + 2 });
        tasks.push({ t: "value", node: keyNode, lead: `${lead}? `, type: "item", indent: task.indent + 2 });
      } else {
        tasks.push({ t: "value", node: entry.value, lead: `${lead}${key}:`, type: "value", indent: task.indent + step, entryIndent: task.indent });
      }
      continue;
    }

    if (task.t === "items") {
      const items = task.node.items;
      if (task.i === items.length) {
        tasks.pop();
        continue;
      }
      const item = items[task.i++];
      if (item.start) flush(item.start.offset, task.indent);
      const lead = task.first !== null && task.i === 1 ? task.first : pad(task.indent);
      tasks.push({ t: "value", node: item, lead: `${lead}- `, type: "item", indent: task.indent + 2 });
      continue;
    }

    // A value.
    tasks.pop();
    const { node, lead, type, indent } = task;
    const props = propsText(node);

    if (node.kind === "alias") {
      inline(lines, lead, type, node.raw ?? `*${node.name}`);
      continue;
    }

    if (node.kind !== "object" && node.kind !== "array") {
      if (node.style === "literal" || node.style === "folded") {
        writeBlockScalar(lines, node, task, props, step, flush);
      } else {
        const text = plain && node.kind === "string" && !node.tag && plainSafe(node.value) ? node.value : scalarText(node, false);
        inline(lines, lead, type, join(props, text));
      }
      continue;
    }

    const list = node.kind === "object" ? node.entries : node.items;
    if (list.length === 0) {
      inline(lines, lead, type, join(props, node.kind === "object" ? "{}" : "[]"));
      continue;
    }
    const flow = keepFlow ? keptFlow(node, lead.length + props.length + 1) : null;
    if (flow !== null) {
      inline(lines, lead, type, join(props, flow));
      continue;
    }

    const kind = node.kind === "object" ? "entries" : "items";
    if (type === "value") {
      lines.push(props ? `${lead} ${props}` : lead);
      tasks.push({ t: kind, node, i: 0, indent, first: null });
    } else if (type === "item") {
      if (props) {
        lines.push(`${lead}${props}`);
        tasks.push({ t: kind, node, i: 0, indent: lead.length, first: null });
      } else {
        tasks.push({ t: kind, node, i: 0, indent: lead.length, first: lead });
      }
    } else {
      if (props) lines.push(props);
      tasks.push({ t: kind, node, i: 0, indent: 0, first: null });
    }
  }
  flush(Infinity, 0);
  return ci;
}

/** A value that sits on its lead's line. */
function inline(lines, lead, type, text) {
  if (type === "value") lines.push(text === "" ? lead : `${lead} ${text}`);
  else if (type === "item") lines.push(text === "" ? lead.trimEnd() : `${lead}${text}`);
  else lines.push(text);
}

function join(props, text) {
  if (props === "") return text;
  return text === "" ? props : `${props} ${text}`;
}

/** "!Person &p" — a node's tag and anchor, as written before it. */
function propsText(node) {
  let out = "";
  if (node.tag) out = node.tag.name;
  if (node.anchor !== undefined) out = out ? `${out} &${node.anchor}` : `&${node.anchor}`;
  return out;
}

/**
 * A key that fits before a ':' on one line, or null for one that needs the
 * explicit "? " form (a collection, a block scalar).
 */
function inlineKey(node) {
  if (node.kind === "alias") return `${node.raw ?? `*${node.name}`} `;
  if (node.kind === "object" || node.kind === "array") {
    const flow = node.kind === "object" ? node.entries.length === 0 : node.items.length === 0;
    if (flow) return join(propsText(node), node.kind === "object" ? "{}" : "[]");
    return null;
  }
  if (node.style === "literal" || node.style === "folded") return null;
  // A quoted key that reads the same without its quotes loses them: keys
  // are names, and JSON's "name": becomes YAML's name:.
  if (node.kind === "string" && (node.style === "double" || node.style === "single") && plainSafe(node.value, false, true)) {
    return join(propsText(node), node.value);
  }
  return join(propsText(node), scalarText(node, false, true));
}

/**
 * A scalar on one line: its source text when that already is one line,
 * otherwise its value, plain where that reads back the same, else in double
 * quotes.
 */
export function scalarText(node, inFlow, isKey = false) {
  const raw = node.raw ?? "";
  const oneLine = raw.indexOf("\n") === -1 && raw.indexOf("\r") === -1;
  if (node.kind !== "string") {
    if (node.raw !== undefined && oneLine && !(inFlow && raw.endsWith(":"))) return raw;
    if (node.kind === "null") return node.raw === "" ? "" : "null";
    if (node.kind === "boolean") return node.value ? "true" : "false";
    return String(node.json ?? node.value);
  }
  if (node.style === "single" || node.style === "double") {
    if (oneLine) return raw;
    return quoteString(node.value);
  }
  if (node.style === "plain" && oneLine && raw !== "" && !(inFlow && /[,[\]{}]/.test(raw))) return raw;
  if (plainSafe(node.value, inFlow, isKey)) return node.value;
  return quoteString(node.value);
}

/** Can `text` be written as a plain scalar and read back as the same string? */
export function plainSafe(text, inFlow = false, isKey = false) {
  if (text === "" || text.length > 1024) return false;
  if (resolvePlain(text).kind !== "string") return false;
  if (INDICATOR_START.has(text[0])) return false;
  if (text.startsWith("---") || text.startsWith("...")) return false;
  if (/^\s|\s$/.test(text)) return false;
  // eslint-disable-next-line no-control-regex -- control characters must be quoted
  if (/[\u0000-\u001f\u007f\u0085\u2028\u2029\ufeff]/.test(text)) return false;
  if (text.includes(": ") || text.includes(" #") || text.endsWith(":")) return false;
  if ((inFlow || isKey) && /[,[\]{}]/.test(text)) return false;
  if (isKey && text.includes(":")) return false;
  return true;
}

/**
 * A short flow collection of scalars, written on one line — or null when the
 * collection should be written in block style.
 */
function keptFlow(node, used) {
  if (node.style !== "flow") return null;
  const parts = [];
  let width = used + 2;
  if (node.kind === "array") {
    for (const item of node.items) {
      const text = flowScalar(item);
      if (text === null) return null;
      parts.push(text);
      width += text.length + 2;
      if (width > FLOW_WIDTH) return null;
    }
    return `[${parts.join(", ")}]`;
  }
  for (const entry of node.entries) {
    if (entry.keyNode && entry.keyNode.kind !== "string" && entry.keyNode.kind !== "number" && entry.keyNode.kind !== "boolean" && entry.keyNode.kind !== "null") {
      return null;
    }
    const k = entry.keyNode;
    const key =
      k && k.kind === "string" && (k.style === "double" || k.style === "single") && plainSafe(k.value, true, true)
        ? join(propsText(k), k.value)
        : k
          ? flowScalar(k, true)
          : quoteString(entry.key);
    const value = flowScalar(entry.value);
    if (key === null || value === null) return null;
    const text = value === "" ? key : `${key}: ${value}`;
    parts.push(text);
    width += text.length + 2;
    if (width > FLOW_WIDTH) return null;
  }
  return `{${parts.join(", ")}}`;
}

function flowScalar(node, isKey = false) {
  if (node.kind === "alias") return node.raw ?? `*${node.name}`;
  if (node.kind === "object" || node.kind === "array") {
    const empty = node.kind === "object" ? node.entries.length === 0 : node.items.length === 0;
    return empty ? join(propsText(node), node.kind === "object" ? "{}" : "[]") : null;
  }
  if (node.style === "literal" || node.style === "folded") return join(propsText(node), quoteString(node.value));
  const text = scalarText(node, true, isKey);
  if (node.kind === "null" && text === "" && !isKey) return join(propsText(node), "null");
  return join(propsText(node), text);
}

/**
 * A literal or folded scalar, re-indented line for line from its source, so
 * folding and every space inside it are exactly as they were.
 */
function writeBlockScalar(lines, node, task, props, step, flush) {
  const { lead, type, indent } = task;
  const raw = node.raw ?? "";
  const nl = raw.indexOf("\n");
  const sourceLines = nl === -1 ? [] : raw.slice(nl + 1).split("\n");
  const from = node.blockIndent ?? 0;
  const content = sourceLines.map((line) => line.slice(Math.min(from, leading(line))).replace(/\r$/, ""));

  // Where the content goes, and the indentation its parent has (which an
  // explicit indentation indicator is counted from).
  let contentIndent;
  let parentIndent;
  if (type === "value") {
    contentIndent = indent;
    parentIndent = task.entryIndent ?? Math.max(indent - step, 0);
  } else if (type === "item") {
    contentIndent = lead.length;
    parentIndent = Math.max(lead.length - 2, 0);
  } else {
    contentIndent = step;
    parentIndent = 0;
  }
  const firstText = content.find((l) => l.trim() !== "");
  const needsIndicator = firstText !== undefined && (firstText[0] === " " || firstText[0] === "\t");
  const chomp = node.chomping === "strip" ? "-" : node.chomping === "keep" ? "+" : "";
  const header = `${node.style === "folded" ? ">" : "|"}${needsIndicator ? contentIndent - parentIndent : ""}${chomp}`;

  inline(lines, lead, type, join(props, header));
  // The header's own comment stays on the header line.
  flush(node.start.offset + (nl === -1 ? raw.length : nl), 0);
  for (const line of content) lines.push(line === "" ? "" : `${pad(contentIndent)}${line}`);
  // Kept trailing blank lines are in the value but not in the source text.
  if (node.chomping === "keep") {
    const trailing = /\n*$/.exec(node.value)[0].length;
    for (let i = 1; i < trailing; i++) lines.push("");
  }
}

function leading(line) {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}
