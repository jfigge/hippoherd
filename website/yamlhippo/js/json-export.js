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
 * json-export.js — a YAML document as JSON, and what that costs.
 *
 * YAML is a superset of JSON, so the trip is lossy, and this module is
 * honest about it. toJson() writes the document and returns, beside the
 * text, the list of everything that did not survive:
 *
 *   anchor       an &anchor's name is dropped (JSON has no references)
 *   alias        an alias is copied out in full
 *   recursive    an alias inside its own anchor: written as null
 *   tag          a tag is dropped (JSON has no tags) — !Ref, !!set …
 *   key          a key that is not a string becomes one (1 → "1")
 *   special      .inf, -.inf and .nan have no JSON form: null
 *   comment      comments are dropped
 *   documents    only one document of a stream is written
 *
 * lossiness() is the same judgement for one node, which the tree uses to
 * mark the nodes that will not survive conversion cleanly.
 *
 * Numbers are written exactly (0x1F → 31, 12345678901234567890 → every
 * digit), through the parser's `json` text, never through a double. The JSON
 * goes through formatter.js, never JSON.stringify.
 *
 * Iterative: depth is not limited by the call stack.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { format, minify } from "./formatter.js";
import { quoteString } from "./json-path.js";
import { keyString } from "./parser/parser.js";
import { ALIAS_BUDGET } from "./yaml-tree.js";

/** Tags whose value is still written cleanly as JSON (the tag itself is dropped silently). */
const HARMLESS_TAGS = new Set(["!", "tag:yaml.org,2002:str", "tag:yaml.org,2002:int", "tag:yaml.org,2002:float", "tag:yaml.org,2002:bool", "tag:yaml.org,2002:null", "tag:yaml.org,2002:map", "tag:yaml.org,2002:seq"]);

/**
 * Why `node` does not survive conversion to JSON cleanly: a list of reasons,
 * empty when it does. `entry` is the mapping entry holding it, if any, so a
 * non-string key is reported on its value's row.
 */
export function lossiness(node, entry = null) {
  const reasons = [];
  if (node.kind === "alias") {
    reasons.push(node.recursive ? `recursive alias *${node.name}: JSON cannot hold a loop, so it becomes null` : `alias *${node.name}: JSON has no references, so it is copied out in full`);
  }
  if (node.tag && !HARMLESS_TAGS.has(node.tag.full)) reasons.push(`tag ${node.tag.name}: JSON has no tags, so it is dropped`);
  if (node.kind === "number" && (node.json === null || node.json === undefined)) reasons.push(`${node.value} has no JSON form: it becomes null`);
  if (entry && entry.keyNode && entry.keyNode.kind !== "string") {
    reasons.push(`key ${entry.key === "" ? "(empty)" : entry.key} is ${entry.keyNode.kind === "object" || entry.keyNode.kind === "array" ? "a collection" : `a ${entry.keyNode.kind}`}: JSON keys are strings`);
  }
  return reasons;
}

/**
 * Write one document as JSON.
 * @param doc      a document from parse() ({ ast }) or a node
 * @param options  { indent: "  " | "    " | "" (minified),
 *                   comments: the document's comments (or just how many),
 *                   documents: how many the stream had,
 *                   restAt: where the documents not written start }
 * @returns {{ text, dropped: [{ kind, count, example, at }], budgetExceeded }}
 *   `at` is the first place it happened ({ line, column, offset }).
 */
export function toJson(doc, { indent = "  ", comments = 0, documents = 1, restAt = null } = {}) {
  const root = doc.ast ?? doc;
  const notes = new Map();
  const note = (kind, example, at) => {
    const n = notes.get(kind);
    if (n) n.count++;
    else notes.set(kind, { kind, count: 1, example, at: at ?? null });
  };

  let budget = ALIAS_BUDGET;
  let budgetExceeded = false;
  const out = { value: null };
  // Work items: { node, put(jsonNode), stack (the anchored nodes being
  // expanded, to catch an alias inside its own anchor) }
  const work = [{ node: root, put: (v) => (out.value = v), expanding: new Set() }];

  while (work.length > 0) {
    const { node: source, put, expanding } = work.pop();
    let node = source;
    let inside = expanding;
    if (node.kind === "alias") {
      if (node.recursive || expanding.has(node.target)) {
        note("recursive", `*${node.name}`, node.start);
        put({ kind: "null", value: null, raw: "null" });
        continue;
      }
      note("alias", `*${node.name}`, node.start);
      node = node.target;
      inside = new Set(expanding).add(node);
    }
    // Every node written out as part of an alias's copy counts against the
    // budget: a few lines of aliases can stand for billions of nodes.
    if (inside.size > 0 && --budget < 0) {
      budgetExceeded = true;
      put({ kind: "null", value: null, raw: "null" });
      continue;
    }
    if (node.tag && !HARMLESS_TAGS.has(node.tag.full)) note("tag", node.tag.name, node.tag.token);
    if (node.anchor !== undefined && expanding.size === 0 && source === node) note("anchor", `&${node.anchor}`, node.anchorToken);

    switch (node.kind) {
      case "object": {
        const obj = { kind: "object", entries: [] };
        put(obj);
        const slots = node.entries.map((entry) => {
          const key = jsonKey(entry, note);
          const slot = { key, keyToken: { raw: quoteString(key) }, value: null };
          obj.entries.push(slot);
          return slot;
        });
        for (let i = node.entries.length - 1; i >= 0; i--) {
          const slot = slots[i];
          work.push({ node: node.entries[i].value, put: (v) => (slot.value = v), expanding: inside });
        }
        break;
      }
      case "array": {
        const arr = { kind: "array", items: new Array(node.items.length).fill(null) };
        put(arr);
        for (let i = node.items.length - 1; i >= 0; i--) {
          work.push({ node: node.items[i], put: (v) => (arr.items[i] = v), expanding: inside });
        }
        break;
      }
      case "string":
        put({ kind: "string", value: node.value, raw: quoteString(node.value) });
        break;
      case "number":
        if (node.json === null || node.json === undefined) {
          note("special", node.value, node.start);
          put({ kind: "null", value: null, raw: "null" });
        } else {
          put({ kind: "number", value: node.json, raw: node.json });
        }
        break;
      case "boolean":
        put({ kind: "boolean", value: node.value, raw: String(node.value) });
        break;
      default:
        put({ kind: "null", value: null, raw: "null" });
    }
  }

  const commentCount = Array.isArray(comments) ? comments.length : comments;
  if (commentCount > 0) {
    notes.set("comment", { kind: "comment", count: commentCount, example: null, at: Array.isArray(comments) ? comments[0] : null });
  }
  if (documents > 1) {
    notes.set("documents", { kind: "documents", count: documents, example: null, at: restAt });
  }
  const text = indent === "" ? minify(out.value) : format(out.value, { indent });
  return { text, dropped: [...notes.values()], budgetExceeded };
}

function jsonKey(entry, note) {
  const keyNode = entry.keyNode;
  if (!keyNode || keyNode.kind === "string") return entry.key;
  if (keyNode.kind === "alias") {
    note("alias", `*${keyNode.name}`, keyNode.start);
    const target = keyNode.target;
    if (target.kind !== "string") note("key", keyString(target), keyNode.start);
    return keyString(target);
  }
  note("key", entry.key, keyNode.start);
  return entry.key;
}

/** One line per kind of loss, for the notice beside the converted text. */
export function describeDropped(dropped, { documents = 1, current = 1 } = {}) {
  const say = {
    anchor: (n) => `${n.count === 1 ? "an anchor was" : `${n.count} anchors were`} dropped (${n.example}${n.count > 1 ? ", …" : ""})`,
    alias: (n) => `${n.count === 1 ? "an alias was" : `${n.count} aliases were`} copied out in full (${n.example}${n.count > 1 ? ", …" : ""})`,
    recursive: (n) => `${n.count === 1 ? "a recursive alias" : `${n.count} recursive aliases`} became null`,
    tag: (n) => `${n.count === 1 ? "a tag was" : `${n.count} tags were`} dropped (${n.example}${n.count > 1 ? ", …" : ""})`,
    key: (n) => `${n.count === 1 ? "a key that is not a string was" : `${n.count} keys that are not strings were`} turned into ${n.count === 1 ? "a string" : "strings"} (${n.example})`,
    special: (n) => `${n.count === 1 ? `${n.example} has` : `${n.count} numbers (${n.example}, …) have`} no JSON form and became null`,
    comment: (n) => `${n.count === 1 ? "a comment was" : `${n.count} comments were`} dropped`,
    documents: () => `only document ${current} of ${documents} was converted`,
  };
  return dropped.map((n) => say[n.kind](n));
}
