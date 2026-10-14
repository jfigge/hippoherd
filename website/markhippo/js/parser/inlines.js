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
 * inlines.js — phase two: inline content of the leaf blocks that have it
 * (paragraphs and headings, or any rule with `inlineContent: true`).
 *
 * The engine owns the parts every inline syntax shares — the scan loop, the
 * text runs between special characters, the delimiter stack with the spec's
 * "process emphasis" procedure (§6.2 and the appendix), and the bracket stack
 * that links and images use. What each special character MEANS comes from
 * the registered inline rules and delimiters.
 *
 * An inline rule is { name, triggers, priority?, parse(state) }: `parse` is
 * tried when the scan reaches one of its trigger characters, and answers true
 * if it consumed input (advancing state.pos and appending nodes).
 *
 * A delimiter is { char, intraword?, ruleOf3?, use(opener, closer),
 * nodeType(use) }: a run of `char` is pushed on the delimiter stack, and
 * pairs are resolved into nodes of nodeType(use) — "emph" and "strong" for
 * CommonMark's * and _.
 *
 * Inline nodes carry content indices (_f, _t: from and to, exclusive) into
 * the subject; parser/index.js maps them to source positions.
 */

import { Node } from "./nodes.js";
import { isPunctuation, isUnicodeWhitespace } from "./normalize.js";

const reTrim = /^[ \t\n]+|[ \t\n]+$/g;

// How deeply emphasis, links and images may nest. Past this, a delimiter
// pair or bracket pair stays literal text — the same kind of guard as
// blocks.js's MAX_NESTING, against input built to exhaust the stack.
export const MAX_INLINE_NESTING = 64;

// The character starting at `i`, whole even when it is a surrogate pair.
function charAt(s, i) {
  const cp = s.codePointAt(i);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

// The character ending just before `i`, whole even when it is a pair.
function charBefore(s, i) {
  if (i <= 0) return "";
  const low = s.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = s.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1];
}

const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

export class InlineParser {
  constructor(registry) {
    this.registry = registry;
    this.delimSpecs = registry.delimiters;
    const special = new Set(["\n", ...registry.inlineTriggers.keys(), ...registry.delimiters.keys()]);
    this.reText = new RegExp(`[^${[...special].map(escapeRe).join("")}]+`, "y");
  }

  // Parse the inline content of `block`. Answers how many leading characters
  // the trim removed, so content indices can be mapped back to the source.
  parse(block, content, refmap) {
    const trimmed = content.replace(reTrim, "");
    this.lead = trimmed.length ? content.search(/[^ \t\n]/) : 0;
    this.subject = trimmed;
    this.pos = 0;
    this.block = block;
    this.refmap = refmap;
    this.delimiters = null;
    this.brackets = null;
    while (this.parseInline()) {
      /* keep going */
    }
    this.processEmphasis(null);
    mergeText(block);
    for (const finish of this.registry.inlineFinishers) finish(this, block);
    return this.lead;
  }

  // ── Helpers for rules ─────────────────────────────────────────────────────

  peek(at = this.pos) {
    return at < this.subject.length ? this.subject[at] : "";
  }

  // Match a STICKY regex at pos; on success advance past it and answer the
  // matched text, else null.
  match(re) {
    re.lastIndex = this.pos;
    const m = re.exec(this.subject);
    if (m === null) return null;
    this.pos = re.lastIndex;
    return m[0];
  }

  // Append a node spanning subject[from, to) to the current block.
  add(node, from, to) {
    node._f = from;
    node._t = to;
    this.block.appendChild(node);
    return node;
  }

  text(literal, from, to) {
    return this.add(new Node("text", { literal }), from, to);
  }

  // ── The scan loop ─────────────────────────────────────────────────────────

  parseInline() {
    const c = this.peek();
    if (c === "") return false;
    const start = this.pos;

    const rules = this.registry.inlineTriggers.get(c);
    if (rules) {
      for (const rule of rules) {
        if (rule.parse(this)) return true;
        this.pos = start;
      }
    }
    if (this.delimSpecs.has(c) && this.handleDelim(c)) return true;
    if (c === "\n") {
      this.pos += 1;
      this.add(new Node("softbreak"), start, this.pos);
      return true;
    }
    const run = this.match(this.reText);
    if (run !== null) {
      this.text(run, start, this.pos);
      return true;
    }
    // A special character nothing claimed: plain text.
    const ch = charAt(this.subject, this.pos);
    this.pos += ch.length;
    this.text(ch, start, this.pos);
    return true;
  }

  // ── Delimiter runs (§6.2) ─────────────────────────────────────────────────

  scanDelims(c) {
    const spec = this.delimSpecs.get(c);
    const startpos = this.pos;
    let numdelims = 0;
    while (this.peek(startpos + numdelims) === c) numdelims++;
    if (numdelims === 0) return null;

    const before = charBefore(this.subject, startpos) || "\n";
    const after = charAt(this.subject, startpos + numdelims) || "\n";
    const afterWs = isUnicodeWhitespace(after);
    const afterPunct = isPunctuation(after);
    const beforeWs = isUnicodeWhitespace(before);
    const beforePunct = isPunctuation(before);

    const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
    const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
    let canOpen, canClose;
    if (spec.intraword === false) {
      canOpen = leftFlanking && (!rightFlanking || beforePunct);
      canClose = rightFlanking && (!leftFlanking || afterPunct);
    } else {
      canOpen = leftFlanking;
      canClose = rightFlanking;
    }
    return { numdelims, canOpen, canClose };
  }

  handleDelim(c) {
    const res = this.scanDelims(c);
    if (!res) return false;
    const start = this.pos;
    this.pos += res.numdelims;
    const node = this.text(this.subject.slice(start, this.pos), start, this.pos);
    if (res.canOpen || res.canClose) {
      this.delimiters = {
        cc: c,
        numdelims: res.numdelims,
        origdelims: res.numdelims,
        node,
        previous: this.delimiters,
        next: null,
        canOpen: res.canOpen,
        canClose: res.canClose,
      };
      if (this.delimiters.previous) this.delimiters.previous.next = this.delimiters;
    }
    return true;
  }

  removeDelimiter(delim) {
    if (delim.previous !== null) delim.previous.next = delim.next;
    if (delim.next !== null) delim.next.previous = delim.previous;
    else this.delimiters = delim.previous; // top of stack
  }

  removeDelimitersBetween(bottom, top) {
    if (bottom.next !== top) {
      bottom.next = top;
      top.previous = bottom;
    }
  }

  // The spec's "process emphasis" procedure, for every delimiter above
  // `stackBottom`.
  processEmphasis(stackBottom) {
    const openersBottom = new Map();
    const bottomFor = (key) => (openersBottom.has(key) ? openersBottom.get(key) : stackBottom);

    // Find the first closer above stackBottom.
    let closer = this.delimiters;
    while (closer !== null && closer.previous !== stackBottom) closer = closer.previous;

    while (closer !== null) {
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      const spec = this.delimSpecs.get(closer.cc);
      const key = `${closer.cc}${closer.canOpen ? 1 : 0}${closer.origdelims % 3}`;
      const bottom = bottomFor(key);

      // Look back for the first matching opener.
      let opener = closer.previous;
      let openerFound = false;
      while (opener !== null && opener !== stackBottom && opener !== bottom) {
        const oddMatch =
          spec.ruleOf3 &&
          (closer.canOpen || opener.canClose) &&
          closer.origdelims % 3 !== 0 &&
          (opener.origdelims + closer.origdelims) % 3 === 0;
        if (
          opener.cc === closer.cc &&
          opener.canOpen &&
          !oddMatch &&
          (!spec.matches || spec.matches(opener, closer))
        ) {
          openerFound = true;
          break;
        }
        opener = opener.previous;
      }

      // Too deep to nest another level: treat it as if there were no opener.
      let depth = 0;
      if (openerFound) {
        depth = this.depthAfter(opener.node, closer.node) + 1;
        if (depth > MAX_INLINE_NESTING) openerFound = false;
      }

      const oldCloser = closer;
      if (!openerFound) {
        closer = closer.next;
        // Later searches for this kind of closer need not look this far down.
        openersBottom.set(key, oldCloser.previous);
        // A closer that cannot open and has no opener is just text.
        if (!oldCloser.canOpen) this.removeDelimiter(oldCloser);
        continue;
      }

      const openerInl = opener.node;
      const closerInl = closer.node;
      const use = spec.use(opener, closer);

      // The opener's innermost (rightmost) characters and the closer's
      // innermost (leftmost) ones are the ones used.
      opener.numdelims -= use;
      closer.numdelims -= use;
      openerInl.literal = openerInl.literal.slice(0, openerInl.literal.length - use);
      openerInl._t -= use;
      closerInl.literal = closerInl.literal.slice(use);
      closerInl._f += use;

      const node = new Node(spec.nodeType(use));
      node._depth = depth;
      node._f = openerInl._t;
      node._t = closerInl._f;
      let tmp = openerInl._next;
      while (tmp && tmp !== closerInl) {
        const next = tmp._next;
        node.appendChild(tmp);
        tmp = next;
      }
      openerInl.insertAfter(node);

      this.removeDelimitersBetween(opener, closer);

      if (opener.numdelims === 0) {
        openerInl.unlink();
        this.removeDelimiter(opener);
      }
      if (closer.numdelims === 0) {
        closerInl.unlink();
        const next = closer.next;
        this.removeDelimiter(closer);
        closer = next;
      }
    }

    // Whatever is left over is text.
    while (this.delimiters !== null && this.delimiters !== stackBottom) {
      this.removeDelimiter(this.delimiters);
    }
  }

  // The deepest nesting among the siblings after `from` (up to `to`, or the
  // end): what wrapping them in one more node would build on.
  depthAfter(from, to = null) {
    let depth = 0;
    for (let n = from._next; n && n !== to; n = n._next) {
      if (n._depth > depth) depth = n._depth;
    }
    return depth;
  }

  // ── Brackets (links and images) ───────────────────────────────────────────

  // Push a [ or ![ opener. `index` is where its label's [ is.
  addBracket(node, index, image) {
    if (this.brackets !== null) this.brackets.bracketAfter = true;
    this.brackets = {
      node,
      previous: this.brackets,
      previousDelimiter: this.delimiters,
      index,
      image,
      active: true,
      bracketAfter: false,
    };
  }

  removeBracket() {
    this.brackets = this.brackets.previous;
  }
}

// Merge each run of adjacent text nodes into one: the delimiter algorithm
// leaves them split at every delimiter run, which nobody downstream wants.
function mergeText(parent) {
  let node = parent._first;
  while (node) {
    if (node.type === "text") {
      let next = node._next;
      while (next && next.type === "text") {
        node.literal += next.literal;
        node._t = next._t;
        const after = next._next;
        next.unlink();
        next = after;
      }
    } else if (node._first) {
      mergeText(node);
    }
    node = node._next;
  }
}
