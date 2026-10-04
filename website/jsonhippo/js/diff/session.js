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
import { JsonHippoError } from "../parser/errors.js";
import { format } from "../formatter.js";
import { diffJson } from "./json-diff.js";
import { reorderToFollow } from "./reorder.js";
import { alignDocuments } from "./align.js";

const other = (side) => (side === "left" ? "right" : "left");

function lineCount(text) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

function tryParse(text) {
  if (text.trim() === "") return { empty: true, ast: null, error: null };
  try {
    return { empty: false, ast: parse(text).ast, error: null };
  } catch (err) {
    if (!(err instanceof JsonHippoError)) throw err;
    return { empty: false, ast: null, error: err };
  }
}

/** Pretty-print `text` if it is valid JSON; otherwise give it back unchanged. */
export function layOut(text, indent = "  ") {
  const { ast } = tryParse(text);
  return ast ? format(ast, { indent }) : text;
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
   *   errors: { left, right }      JsonHippoError or null
   *   empty:  { left, right }      true for a blank side
   *   result: { counts, equal, rows, classes } | null   — current, or the last good one while stale
   *   stale:  boolean
   * }}
   */
  compare(texts, { indent = "  " } = {}) {
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
    const reordered = format(reorderToFollow(parsed[slave].ast, parsed[other(slave)].ast), { indent });
    this.memory = { side: slave, original: this.memory ? this.memory.original : texts[slave], reordered };
    if (reordered !== texts[slave]) {
      texts[slave] = reordered;
      reparse(slave);
    }
  }
}
