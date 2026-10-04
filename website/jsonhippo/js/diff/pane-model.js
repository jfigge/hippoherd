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
 * pane-model.js — one Diff pane's text, with its render-only rows.
 *
 * A Diff pane is a plain textarea, so a placeholder can only be shown as an
 * empty line in it. This model is what keeps those lines out of the JSON: it
 * holds the textarea's text (`raw`) alongside one metadata record per line,
 * and the pane's real text — what is parsed, copied, exported and carried
 * back to the Text tab — is `raw` with the filler lines taken out.
 *
 *   meta[i] = { fill: 'placeholder' | 'spacer' | undefined,
 *               cls:  'missing' | 'added' | 'changed' | 'type' | undefined }
 *
 * The metadata follows the user's edits (edit()): lines above an edit keep
 * theirs, lines below shift with it, and a placeholder the user types into is
 * promoted to a real line — given an indent and the comma the document will
 * need (promote()). Deleting a placeholder just removes it; the next compare
 * puts it back if the member is still missing, because it is not data.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { PLACEHOLDER } from "./align.js";

/** 0-based row containing `offset` (counts the newlines before it). */
export function rowAt(text, offset) {
  let row = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) row++;
  return row;
}

/** Offset where 0-based `row` starts. */
export function offsetOfRow(text, row) {
  let offset = 0;
  for (let r = 0; r < row; r++) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  return offset;
}

function rowEnd(text, start) {
  const nl = text.indexOf("\n", start);
  return nl === -1 ? text.length : nl;
}

/** Newlines in text[from, to). */
function newlinesBetween(text, from, to) {
  let n = 0;
  for (let i = text.indexOf("\n", from); i !== -1 && i < to; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

function lineCount(text) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

export class PaneModel {
  constructor(text = "") {
    this.setText(text);
  }

  /** Real text only: no fillers, no highlights. */
  setText(text) {
    this.raw = text;
    this.meta = Array.from({ length: lineCount(text) }, () => ({}));
  }

  /**
   * Lay `text` out down an alignment column: each cell a 1-based line number,
   * PLACEHOLDER or SPACER (align.js). `classes` maps line numbers to their
   * difference class. A column that does not hold every line exactly once, in
   * order, is refused — the text is kept as it is rather than risk losing any.
   * @returns {boolean} whether the layout was applied
   */
  layout(text, column, classes = new Map()) {
    const lines = text.split("\n");
    let expect = 1;
    for (const cell of column) {
      if (cell > 0) {
        if (cell !== expect) break;
        expect++;
      }
    }
    if (expect !== lines.length + 1) {
      this.setText(text);
      return false;
    }
    const raw = [];
    const meta = [];
    for (const cell of column) {
      if (cell > 0) {
        raw.push(lines[cell - 1]);
        meta.push({ cls: classes.get(cell) });
      } else {
        raw.push("");
        meta.push({ fill: cell === PLACEHOLDER ? "placeholder" : "spacer" });
      }
    }
    this.raw = raw.join("\n");
    this.meta = meta;
    return true;
  }

  /** The pane's JSON: every line except the render-only ones. */
  logicalText() {
    if (!this.meta.some((m) => m.fill)) return this.raw;
    return this.raw
      .split("\n")
      .filter((_, i) => !this.meta[i]?.fill)
      .join("\n");
  }

  /** Text between two raw offsets, filler lines left out (for copy and cut). */
  textBetween(start, end) {
    const a = rowAt(this.raw, start);
    const slice = this.raw.slice(start, end);
    const parts = slice.split("\n");
    if (!parts.some((_, k) => this.meta[a + k]?.fill)) return slice;
    return parts.filter((_, k) => !this.meta[a + k]?.fill).join("\n");
  }

  isFiller(row) {
    return Boolean(this.meta[row]?.fill);
  }

  /** 0-based raw row of 1-based logical line `n`. */
  rowOfLine(n) {
    let seen = 0;
    for (let r = 0; r < this.meta.length; r++) {
      if (!this.meta[r].fill && ++seen === n) return r;
    }
    return Math.max(0, this.meta.length - 1);
  }

  /** 1-based logical line of 0-based raw row `r`, or null for a filler. */
  lineOfRow(r) {
    if (this.meta[r]?.fill) return null;
    let n = 0;
    for (let i = 0; i <= r && i < this.meta.length; i++) if (!this.meta[i].fill) n++;
    return n;
  }

  /**
   * Logical offset of a raw offset. An offset on a filler row maps to the
   * start of the next real line (or the end of the text).
   */
  logicalOffset(rawOffset) {
    const row = rowAt(this.raw, rawOffset);
    let column = rawOffset - offsetOfRow(this.raw, row);
    let r = row;
    while (r < this.meta.length && this.meta[r]?.fill) {
      r++;
      column = 0;
    }
    const logical = this.logicalText();
    if (r >= this.meta.length) return logical.length;
    return offsetOfRow(logical, this.lineOfRow(r) - 1) + column;
  }

  /** Raw offset of a logical offset (fillers are empty lines, one '\n' each). */
  rawOffset(logicalOffset) {
    const logical = this.logicalText();
    const line = rowAt(logical, logicalOffset) + 1;
    const column = logicalOffset - offsetOfRow(logical, line - 1);
    return offsetOfRow(this.raw, this.rowOfLine(line)) + column;
  }

  /**
   * Account for an edit the browser made to the textarea.
   *
   * @param newRaw  the textarea's value after the edit
   * @param hint    the selection start before the edit — the edit cannot have
   *                begun after it (pass Infinity for undo/redo, which can)
   * @returns {{ promoted: number | null }} the row of a placeholder typed into
   */
  edit(newRaw, hint = Infinity) {
    const old = this.raw;
    if (newRaw === old) return { promoted: null };

    // The edit is what lies between the common prefix and the common suffix.
    const shorter = Math.min(old.length, newRaw.length);
    const prefixMax = Math.min(shorter, hint);
    let p = 0;
    while (p < prefixMax && old.charCodeAt(p) === newRaw.charCodeAt(p)) p++;
    let s = 0;
    while (s < shorter - p && old.charCodeAt(old.length - 1 - s) === newRaw.charCodeAt(newRaw.length - 1 - s)) s++;
    const inserted = newRaw.length - s - p;

    const a = rowAt(old, p); // first row the edit touches
    const b = a + newlinesBetween(old, p, old.length - s); // last old row it touches
    const c = a + newlinesBetween(newRaw, p, newRaw.length - s); // last new row
    const startA = p === 0 ? 0 : old.lastIndexOf("\n", p - 1) + 1; // row a starts at the same offset in both
    const newRowA = newRaw.slice(startA, rowEnd(newRaw, startA));

    const first = this.meta[a] ?? {};
    const last = this.meta[b] ?? {};
    let metaA;
    let promoted = null;
    if (first.fill) {
      if (newRowA === "") {
        metaA = first; // still empty (Enter on it): still a filler
      } else if (inserted > 0) {
        metaA = {}; // typed or pasted into: a real line now
        promoted = a;
      } else {
        metaA = { cls: last.cls }; // the line below was joined up into it
      }
    } else {
      metaA = { cls: first.cls };
    }
    const fresh = Array.from({ length: c - a }, () => ({}));
    this.meta.splice(a, b - a + 1, metaA, ...fresh);
    this.raw = newRaw;
    return { promoted };
  }

  /**
   * Finish promoting the placeholder at `row`, just typed into, so that once
   * the user has finished the document is still valid JSON:
   *
   *   - indent it like `indent` (the aligned line in the other pane), if the
   *     typed text did not bring its own indentation;
   *   - if a member follows it, put a comma after the new text (at the caret,
   *     so typing carries on in front of it);
   *   - if it is now the last member, put the comma on the line above instead.
   *
   * @returns {{ raw: string, caret: number }} the new text and caret
   */
  promote(row, caret, indent = "") {
    const raw = this.raw;
    const edits = [];
    const rowStart = offsetOfRow(raw, row);
    const rowText = raw.slice(rowStart, rowEnd(raw, rowStart));
    if (indent && !/^\s/.test(rowText)) edits.push({ at: rowStart, insert: indent, beforeCaret: true });

    const realRow = (r) => !this.meta[r]?.fill && raw.slice(offsetOfRow(raw, r), rowEnd(raw, offsetOfRow(raw, r))).trim() !== "";
    const textOfRow = (r) => raw.slice(offsetOfRow(raw, r), rowEnd(raw, offsetOfRow(raw, r)));
    const caretRow = rowAt(raw, caret);
    let next = -1;
    for (let r = caretRow + 1; r < this.meta.length; r++) {
      if (realRow(r)) {
        next = r;
        break;
      }
    }
    let prev = -1;
    for (let r = row - 1; r >= 0; r--) {
      if (realRow(r)) {
        prev = r;
        break;
      }
    }

    if (next !== -1 && /^[}\]]/.test(textOfRow(next).trim())) {
      if (prev !== -1) {
        const above = textOfRow(prev).trimEnd();
        if (!/[,{[]$/.test(above)) edits.push({ at: offsetOfRow(raw, prev) + above.length, insert: ",", beforeCaret: true });
      }
    } else if (next !== -1) {
      const caretRowStart = offsetOfRow(raw, caretRow);
      const before = raw.slice(caretRowStart, caret).trimEnd();
      const after = raw.slice(caret, rowEnd(raw, caretRowStart)).trim();
      if (after === "" && !before.endsWith(",")) edits.push({ at: caret, insert: ",", beforeCaret: false });
    }

    let text = raw;
    let newCaret = caret;
    edits.sort((x, y) => y.at - x.at);
    for (const e of edits) {
      text = text.slice(0, e.at) + e.insert + text.slice(e.at);
      if (e.at < caret || (e.at === caret && e.beforeCaret)) newCaret += e.insert.length;
    }
    // No line breaks were added, so every row keeps its metadata.
    this.raw = text;
    return { raw: text, caret: newCaret };
  }

  /** Leading whitespace of 0-based raw row `r`. */
  indentOf(r) {
    const start = offsetOfRow(this.raw, r);
    return /^[ \t]*/.exec(this.raw.slice(start, rowEnd(this.raw, start)))[0];
  }
}
