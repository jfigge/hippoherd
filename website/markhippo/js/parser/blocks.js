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
 * blocks.js — phase one: the block structure.
 *
 * This is the line-by-line algorithm from the CommonMark spec's appendix
 * ("A parsing strategy"), in the shape commonmark.js gave it, with every
 * piece of syntax moved out into block rules that plugins register:
 *
 *   1. Walk down the open blocks; each one's rule `continue`s the line or not.
 *   2. Try the registered block starts, in priority order, until a leaf opens
 *      or none matches.
 *   3. Close what did not match (unless the line is a lazy paragraph
 *      continuation) and add the rest of the line to the open leaf.
 *
 * A block rule is
 *
 *   { type, continue, finalize, canContain, acceptsLines,
 *     start?, priority?, triggers?,       — or starts: [{ start, priority, triggers }]
 *     inlineContent?, onlyInside?, lineAdded? }
 *
 * `triggers` lists the characters a start can begin with (on a line that is
 * not indented); when every start declares them, lines that begin with none
 * of them skip the starts altogether.
 *
 * `start(parser, container)` answers 0 (no match), 1 (opened a container;
 * keep looking) or 2 (opened a leaf; the rest of the line is its content).
 * `continue(parser, block)` answers 0 (matched), 1 (did not match) or 2 (the
 * line was consumed whole — a closing fence).
 *
 * Positions are kept as source offsets while parsing (_s, _e) and turned into
 * { line, column, offset } at the end (see parser/index.js).
 */

import { Node } from "./nodes.js";

const CODE_INDENT = 4;

// How deeply containers may nest. The spec sets no limit, but every tree
// walk downstream (and the line scan itself, which re-reads the indentation
// at every level) gets slower — and eventually overflows the stack — with
// depth. Past this, a container marker is just paragraph text. markdown-it
// draws the same line, at 100.
export const MAX_NESTING = 100;

export class BlockParser {
  constructor(registry) {
    this.registry = registry;
    this.blocks = registry.blocks;
    this.blockStarts = registry.blockStarts;
    this.triggers = registry.blockTriggers;
  }

  // Parse `lines` (from source.splitLines) into a tree of block nodes. The
  // leaf blocks that take inline content keep it in _content for phase two.
  parse(lines, starts, textLength) {
    this.doc = new Node("document");
    this.doc._s = 0;
    this.doc._open = true;
    this.tip = this.doc;
    this.oldtip = this.doc;
    this.refmap = Object.create(null);
    this.definitions = [];
    this.lines = lines;
    this.lineStarts = starts;
    this.textLength = textLength;
    this.lineNumber = 0;
    this.lastLineLength = 0;
    this.offset = 0;
    this.column = 0;
    this.lastMatchedContainer = this.doc;
    this.currentLine = "";
    this.allClosed = true;

    for (let i = 0; i < lines.length; i++) this.incorporateLine(lines[i]);
    while (this.tip) this.finalize(this.tip, lines.length);
    this.doc._e = textLength;
    return this.doc;
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  // Offset of a 0-based character index on a 1-based line.
  offsetAt(line, index) {
    if (line < 1) return 0;
    const start = line - 1 < this.lineStarts.length ? this.lineStarts[line - 1] : this.textLength;
    return start + index;
  }

  // 1-based line holding source offset `offset`.
  lineOf(offset) {
    const starts = this.lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  // ── Line scanning (used by the block rules) ───────────────────────────────

  findNextNonspace() {
    const line = this.currentLine;
    let i = this.offset;
    let cols = this.column;
    let c;
    while ((c = line.charAt(i)) !== "") {
      if (c === " ") {
        i++;
        cols++;
      } else if (c === "\t") {
        i++;
        cols += 4 - (cols % 4);
      } else {
        break;
      }
    }
    this.blank = c === "\n" || c === "\r" || c === "";
    this.nextNonspace = i;
    this.nextNonspaceColumn = cols;
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  advanceNextNonspace() {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  // Advance by `count` characters, or by `count` columns when `columns` is
  // set — in which case a tab may be only partly consumed.
  advanceOffset(count, columns) {
    const line = this.currentLine;
    let c;
    while (count > 0 && (c = line[this.offset])) {
      if (c === "\t") {
        const charsToTab = 4 - (this.column % 4);
        if (columns) {
          this.partiallyConsumedTab = charsToTab > count;
          const charsToAdvance = charsToTab > count ? count : charsToTab;
          this.column += charsToAdvance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          count -= charsToAdvance;
        } else {
          this.partiallyConsumedTab = false;
          this.column += charsToTab;
          this.offset += 1;
          count -= 1;
        }
      } else {
        this.partiallyConsumedTab = false;
        this.offset += 1;
        this.column += 1;
        count -= 1;
      }
    }
  }

  // ── Tree building ─────────────────────────────────────────────────────────

  // Open a block of `type` whose first character is at character index
  // `index` of the current line, closing whatever cannot contain it.
  addChild(type, index) {
    while (!this.rule(this.tip.type).canContain(type, this)) {
      this.finalize(this.tip, this.lineNumber - 1);
    }
    const block = new Node(type);
    block._s = this.offsetAt(this.lineNumber, index);
    block._line = this.lineNumber;
    block._open = true;
    block._content = "";
    block._segments = [];
    block._base = 0;
    this.tip.appendChild(block);
    this.tip = block;
    return block;
  }

  closeUnmatchedBlocks() {
    if (!this.allClosed) {
      while (this.oldtip !== this.lastMatchedContainer) {
        const parent = this.oldtip._parent;
        this.finalize(this.oldtip, this.lineNumber - 1);
        this.oldtip = parent;
      }
      this.allClosed = true;
    }
  }

  // Close `block`, which ends on line `lineNumber` (its end column is the
  // length of the last line seen).
  finalize(block, lineNumber) {
    const above = block._parent;
    block._open = false;
    block._e = this.offsetAt(lineNumber, this.lastLineLength);
    this.rule(block.type).finalize(this, block);
    this.tip = above;
  }

  rule(type) {
    const r = this.blocks.get(type);
    if (!r) throw new Error(`No block rule registered for "${type}"`);
    return r;
  }

  // Append the rest of the current line to the open leaf's content,
  // remembering where in the source each piece came from: a segment is
  // [contentIndex, sourceOffset, pinned, nextLineStart]. A pinned segment is
  // the spaces a partly consumed tab expands to; all of them map to the tab.
  addLine() {
    const tip = this.tip;
    const lineStart = this.offsetAt(this.lineNumber, 0);
    if (this.partiallyConsumedTab) {
      this.offset += 1; // skip over the tab
      const charsToTab = 4 - (this.column % 4);
      tip._segments.push([tip._content.length, lineStart + this.offset - 1, true, 0]);
      tip._content += " ".repeat(charsToTab);
    }
    tip._segments.push([tip._content.length, lineStart + this.offset, false, this.offsetAt(this.lineNumber + 1, 0)]);
    tip._content += this.currentLine.slice(this.offset) + "\n";
  }

  // ── The per-line algorithm ────────────────────────────────────────────────

  incorporateLine(ln) {
    let container = this.doc;
    this.oldtip = this.tip;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.lineNumber += 1;
    this.currentLine = ln;

    // 1. Which open blocks does this line continue?
    let lastChild;
    let depth = 0;
    while ((lastChild = container._last) && lastChild._open) {
      container = lastChild;
      depth++;
      this.findNextNonspace();
      const res = this.rule(container.type).continue(this, container);
      if (res === 0) continue;
      if (res === 2) return; // the line was consumed whole
      container = container._parent;
      depth--;
      break;
    }

    this.allClosed = container === this.oldtip;
    this.lastMatchedContainer = container;

    // 2. Does it start new blocks?
    let matchedLeaf = container.type !== "paragraph" && this.rule(container.type).acceptsLines;
    const starts = this.blockStarts;
    while (!matchedLeaf) {
      this.findNextNonspace();
      if (depth >= MAX_NESTING) {
        this.advanceNextNonspace();
        break;
      }
      // Nothing can start here: skip trying every rule.
      if (!this.indented && this.triggers && !this.triggers.has(ln.charAt(this.nextNonspace))) {
        this.advanceNextNonspace();
        break;
      }
      let i = 0;
      for (; i < starts.length; i++) {
        const res = starts[i].start(this, container);
        if (res === 1) {
          container = this.tip;
          depth++;
          break;
        }
        if (res === 2) {
          container = this.tip;
          matchedLeaf = true;
          break;
        }
      }
      if (i === starts.length) {
        this.advanceNextNonspace();
        break;
      }
    }

    // 3. Add what is left of the line.
    if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
      // Lazy paragraph continuation.
      this.addLine();
    } else {
      this.closeUnmatchedBlocks();
      const rule = this.rule(container.type);
      if (rule.acceptsLines) {
        this.addLine();
        if (rule.lineAdded && rule.lineAdded(this, container)) {
          this.lastLineLength = ln.length;
          this.finalize(container, this.lineNumber);
        }
      } else if (this.offset < ln.length && !this.blank) {
        this.addChild("paragraph", this.offset);
        this.advanceNextNonspace();
        this.addLine();
      }
    }
    this.lastLineLength = ln.length;
  }
}
