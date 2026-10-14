/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of MarkHippo.
 *
 * MarkHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * MarkHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with MarkHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * highlight.js — the colouring of the edit pane, from the AST.
 *
 * The same tree that renders the preview says what every stretch of the
 * source is, so the edit pane never guesses with regular expressions of its
 * own: a heading marker is coloured because the parser made it a heading,
 * and an unclosed fence turns the rest of the document into code because
 * that is what the parser understood.
 *
 * Every node type is coloured by a function a plugin registered
 * (`api.highlighter(type, fn)`); a type nobody registered just has its
 * children visited. A highlighter is `fn(node, h)`, where `h` is a
 * Highlighter:
 *
 *   h.mark(from, to, token)    colour source offsets [from, to) as `token`
 *   h.children(node)           visit the node's children
 *   h.source                   the document text
 *   h.lineStart(line)          offset where a 1-based line starts
 *   h.lineEnd(line)            offset where its content ends (before the
 *                              line ending)
 *   h.code(info, literal, firstLine)
 *                              colour a code block's content in the
 *                              language its info string names, if one is
 *                              registered (see highlight/code.js)
 *
 * Marks nest — emphasis inside a heading inside a block quote — and are
 * flattened into SEGMENTS: [from, to, className] triples, in order and not
 * overlapping, whose className lists every token covering that stretch, the
 * outermost first ("mh-md-heading mh-md-strong"). Text with no token is left
 * out.
 */

import { splitLines } from "../parser/source.js";
import { languageFor, tokenizeCode } from "./code.js";

// The segments of a whole document.
export function highlight(registry, ast) {
  const h = new Highlighter(registry, ast.source ?? "");
  const out = [];
  // Top-level blocks never overlap, so each is flattened on its own and the
  // sort inside flatten() stays small.
  for (const block of ast.children ?? []) {
    h.marks = [];
    h.node(block);
    flatten(h.marks, out);
  }
  return out;
}

export class Highlighter {
  constructor(registry, source) {
    this.registry = registry;
    this.source = source;
    this.starts = splitLines(source).starts;
    this.marks = [];
  }

  node(node) {
    const fn = this.registry.highlighters.get(node.type);
    if (fn) fn(node, this);
    else this.children(node);
  }

  children(node) {
    if (node.children) for (const child of node.children) this.node(child);
  }

  mark(from, to, token) {
    if (to > from) this.marks.push([from, to, token]);
  }

  lineStart(line) {
    return line - 1 < this.starts.length ? this.starts[line - 1] : this.source.length;
  }

  lineEnd(line) {
    if (line >= this.starts.length) return this.source.length;
    let end = this.starts[line];
    if (this.source[end - 1] === "\n") end--;
    if (this.source[end - 1] === "\r") end--;
    return end;
  }

  // Colour code — a code block's `literal` — whose first line is source line
  // `firstLine`. Each literal line is the END of its source line (container
  // markers and indentation are stripped from the front), which is how
  // tokens are put back in place; a line where that does not hold (a tab
  // the indentation split) is left plain.
  code(info, literal, firstLine) {
    const lang = languageFor(this.registry, info);
    if (!lang || !literal) return;
    const tokens = tokenizeCode(lang, literal);
    if (!tokens.length) return;
    const src = this.source;
    let k = 0;
    let lineFrom = 0;
    for (let line = firstLine; lineFrom < literal.length; line++) {
      let lineTo = literal.indexOf("\n", lineFrom);
      if (lineTo === -1) lineTo = literal.length;
      const end = this.lineEnd(line);
      const base = end - (lineTo - lineFrom);
      const aligned = base >= this.lineStart(line) && src.startsWith(literal.slice(lineFrom, lineTo), base);
      while (k < tokens.length && tokens[k][0] < lineTo) {
        const [from, to, token] = tokens[k];
        if (aligned) this.mark(base + Math.max(from, lineFrom) - lineFrom, base + Math.min(to, lineTo) - lineFrom, "tk-" + token);
        if (to > lineTo) break;
        k++;
      }
      lineFrom = lineTo + 1;
    }
  }
}

// Nested marks → flat segments, appended to `out`. Marks arrive outermost
// first (the walk is pre-order), and that order is kept in the class names.
export function flatten(marks, out = []) {
  if (!marks.length) return out;
  const events = [];
  for (let k = 0; k < marks.length; k++) {
    events.push([marks[k][0], 1, k], [marks[k][1], 0, k]);
  }
  // By position; at one position, closes before opens.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const active = [];
  let at = events[0][0];
  for (const [pos, open, k] of events) {
    if (pos > at && active.length) emit(out, at, pos, active, marks);
    at = pos;
    if (open) {
      let i = active.length;
      while (i > 0 && active[i - 1] > k) i--;
      active.splice(i, 0, k);
    } else {
      active.splice(active.indexOf(k), 1);
    }
  }
  return out;
}

function emit(out, from, to, active, marks) {
  let className = "";
  const seen = new Set();
  for (const k of active) {
    const token = marks[k][2];
    if (seen.has(token)) continue;
    seen.add(token);
    className += (className ? " mh-" : "mh-") + token;
  }
  const last = out[out.length - 1];
  if (last && last[1] === from && last[2] === className) last[1] = to;
  else out.push([from, to, className]);
}
