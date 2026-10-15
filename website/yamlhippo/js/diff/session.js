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
 * session.js — what the Diff tab knows between compares, without the DOM.
 *
 * compare() takes the two panes' texts and returns everything the view needs:
 * each side's parse error (if any), the texts to show (the Reorder switch can
 * rewrite one), and the differences laid out as rows. While either side is
 * invalid it returns the LAST GOOD result, so the highlights stay put instead
 * of flickering away mid-edit.
 *
 * The Reorder switch:
 *   'off'    each side in its own order
 *   'left'   Left is master: Right is rewritten in Left's order
 *   'right'  Right is master: Left is rewritten in Right's order
 * The rewrite is redone after each compare while the slave is untouched, so it
 * keeps following the master as the master is edited. Once the user edits the
 * slave, it is left alone. Back at 'off', an untouched slave reverts to the
 * order it had before; an edited one keeps its edits.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { parse } from "../parser/parser.js";
import { YamlHippoError } from "../parser/errors.js";
import { emitYaml } from "../yaml-emitter.js";
import { diffJson } from "./json-diff.js";
import { reorderToFollow } from "./reorder.js";
import { alignDocuments } from "./align.js";

const other = (side) => (side === "left" ? "right" : "left");

function lineCount(text) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/**
 * A stream of several documents is compared as one list of them, in which
 * — like any list here — order does not matter.
 */
function streamNode(result) {
  const docs = result.documents.map((d) => d.ast);
  if (docs.length === 1) return docs[0];
  return { kind: "array", items: docs, style: "block", stream: true, start: docs[0].start, end: docs[docs.length - 1].end };
}

function tryParse(text) {
  if (text.trim() === "") return { empty: true, ast: null, error: null };
  try {
    const result = parse(text);
    return { empty: false, ast: streamNode(result), result, error: null };
  } catch (err) {
    if (!(err instanceof YamlHippoError)) throw err;
    return { empty: false, ast: null, error: err };
  }
}

/**
 * Lay `text` out one entry per line (block style throughout, comments kept)
 * if it is valid YAML; otherwise give it back unchanged.
 */
export function layOut(text, indent = 2) {
  const { result } = tryParse(text);
  return result ? emitYaml(result, { indent, flow: false }) : text;
}

/**
 * Does `text` need laying out before it can be compared line by line? Only
 * when it is flow style — JSON, or a {…}/[…] document — whose members share
 * lines. Block YAML is compared as written.
 */
export function needsLayOut(text) {
  const { result } = tryParse(text);
  if (!result) return false;
  return result.documents.some((d) => d.ast && d.ast.style === "flow" && hasSharedLines(d.ast));
}

function hasSharedLines(node) {
  const kids = node.kind === "object" ? node.entries.map((e) => e.value) : node.kind === "array" ? node.items : [];
  if (kids.length === 0) return false;
  if (kids.length > 1 && kids.some((k, i) => i > 0 && k.start.line === kids[i - 1].end.line)) return true;
  return kids[0].start.line === node.start.line;
}

/** Write a (possibly reordered) tree back out: one document, or a stream of them. */
function write(node, indent) {
  if (node.stream) return emitYaml({ documents: node.items.map((ast) => ({ ast, start: ast.start })) }, { indent, flow: false });
  return emitYaml(node, { indent, flow: false });
}

export class DiffSession {
  constructor() {
    this.mode = "off"; // 'left' | 'off' | 'right'
    this.memory = null; // { side, original, reordered } — the slave's text before and after
    this.last = null; // last good result
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * @param texts   { left, right } — the panes' real texts
   * @returns {{
   *   state:  'ok' | 'error' | 'empty',
   *   texts:  { left, right }      the texts the panes should now hold
   *   errors: { left, right }      YamlHippoError or null
   *   empty:  { left, right }      true for a blank side
   *   result: { counts, equal, rows, classes } | null   — current, or the last good one while stale
   *   stale:  boolean
   * }}
   */
  compare(texts, { indent = 2 } = {}) {
    const out = { left: texts.left, right: texts.right };
    const parsed = { left: tryParse(out.left), right: tryParse(out.right) };
    const errors = { left: parsed.left.error, right: parsed.right.error };
    const empty = { left: parsed.left.empty, right: parsed.right.empty };

    if (errors.left || errors.right) {
      return { state: "error", texts: out, errors, empty, result: this.last, stale: this.last !== null };
    }
    if (empty.left || empty.right) {
      this.last = null;
      this.memory = null;
      return { state: "empty", texts: out, errors, empty, result: null, stale: false };
    }

    this.applyReorder(out, parsed, indent);

    const diff = diffJson(parsed.left.ast, parsed.right.ast);
    const { rows, classes } = alignDocuments(diff, parsed.left.ast, parsed.right.ast, lineCount(out.left), lineCount(out.right));
    this.last = { counts: diff.counts, equal: diff.equal, rows, classes, texts: { ...out } };
    return { state: "ok", texts: out, errors, empty, result: this.last, stale: false };
  }

  /** Rewrite (or restore) the slave side for the Reorder switch. Mutates `texts` and `parsed`. */
  applyReorder(texts, parsed, indent) {
    const slave = this.mode === "left" ? "right" : this.mode === "right" ? "left" : null;
    const reparse = (side) => {
      parsed[side] = tryParse(texts[side]);
    };

    // A slave from an earlier Reorder setting goes back to its own order, if untouched.
    if (this.memory && this.memory.side !== slave) {
      if (texts[this.memory.side] === this.memory.reordered) {
        texts[this.memory.side] = this.memory.original;
        reparse(this.memory.side);
      }
      this.memory = null;
    }
    if (!slave) return;

    const untouched = !this.memory || texts[slave] === this.memory.reordered;
    if (!untouched) return;
    const reordered = write(reorderToFollow(parsed[slave].ast, parsed[other(slave)].ast), indent);
    this.memory = { side: slave, original: this.memory ? this.memory.original : texts[slave], reordered };
    if (reordered !== texts[slave]) {
      texts[slave] = reordered;
      reparse(slave);
    }
  }
}
