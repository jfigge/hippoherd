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
 * The CommonMark inline rules (§6). Each is registered by trigger character;
 * the engine (parser/inlines.js) supplies the scan loop, the delimiter and
 * bracket stacks and "process emphasis".
 */

import { MAX_INLINE_NESTING } from "../../parser/inlines.js";
import { Node } from "../../parser/nodes.js";
import { ENTITY, decodeEntity, isEscapable, normalizeLabel, normalizeURI } from "../../parser/normalize.js";
import {
  isWhitespaceChar,
  parseLinkDestination,
  parseLinkLabel,
  parseLinkTitle,
  reAutolink,
  reEmailAutolink,
  reHtmlTag,
  spnl,
} from "../../parser/scanners.js";

// ── Line breaks (§6.7, §6.8) ────────────────────────────────────────────────

// A line ending: hard if the line ended in two or more spaces, else soft.
// The spaces belong to the break, not to the text before it.
export const newline = {
  name: "newline",
  triggers: "\n",
  parse(state) {
    const start = state.pos;
    state.pos += 1;
    let from = start;
    let hard = false;
    const last = state.block._last;
    if (last && last.type === "text" && last.literal.endsWith(" ")) {
      const trimmed = last.literal.replace(/ +$/, "");
      const spaces = last.literal.length - trimmed.length;
      hard = spaces >= 2;
      last.literal = trimmed;
      last._t -= spaces;
      from = start - spaces;
      if (trimmed === "") last.unlink();
    }
    state.add(new Node(hard ? "linebreak" : "softbreak"), from, state.pos);
    state.match(/ */y); // the next line's leading spaces
    return true;
  },
};

// ── Backslash escapes (§2.4) and backslash hard breaks ──────────────────────

export const backslash = {
  name: "backslash",
  triggers: "\\",
  parse(state) {
    const start = state.pos;
    const next = state.peek(start + 1);
    if (next === "\n") {
      state.pos += 2;
      state.add(new Node("linebreak"), start, state.pos);
    } else if (next !== "" && isEscapable(next)) {
      state.pos += 2;
      state.text(next, start, state.pos);
    } else {
      state.pos += 1;
      state.text("\\", start, state.pos);
    }
    return true;
  },
};

// ── Code spans (§6.1) ───────────────────────────────────────────────────────

const reTicksHere = /`+/y;
const reTicks = /`+/g;

export const codeSpan = {
  name: "code_span",
  triggers: "`",
  parse(state) {
    const start = state.pos;
    const ticks = state.match(reTicksHere);
    const afterOpenTicks = state.pos;
    reTicks.lastIndex = afterOpenTicks;
    let m;
    while ((m = reTicks.exec(state.subject)) !== null) {
      if (m[0].length !== ticks.length) continue;
      let contents = state.subject.slice(afterOpenTicks, m.index).replace(/\n/g, " ");
      // One space each side is stripped, if both are there and the span is
      // not all spaces.
      if (contents[0] === " " && contents[contents.length - 1] === " " && /[^ ]/.test(contents)) {
        contents = contents.slice(1, -1);
      }
      state.pos = m.index + m[0].length;
      state.add(new Node("code", { literal: contents }), start, state.pos);
      return true;
    }
    // No closing run: the backticks are literal.
    state.pos = afterOpenTicks;
    state.text(ticks, start, state.pos);
    return true;
  },
};

// ── Emphasis (§6.2) ─────────────────────────────────────────────────────────

const emphasisUse = (opener, closer) => (closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1);
const emphasisType = (use) => (use === 1 ? "emph" : "strong");

export const asterisk = { char: "*", ruleOf3: true, use: emphasisUse, nodeType: emphasisType };
export const underscore = { char: "_", intraword: false, ruleOf3: true, use: emphasisUse, nodeType: emphasisType };

// ── Links and images (§6.3, §6.4) ───────────────────────────────────────────

export const openBracket = {
  name: "link_open",
  triggers: "[",
  parse(state) {
    const start = state.pos;
    state.pos += 1;
    const node = state.text("[", start, state.pos);
    state.addBracket(node, start, false);
    return true;
  },
};

export const bang = {
  name: "image_open",
  triggers: "!",
  parse(state) {
    const start = state.pos;
    if (state.peek(start + 1) !== "[") return false;
    state.pos += 2;
    const node = state.text("![", start, state.pos);
    state.addBracket(node, start + 1, true);
    return true;
  },
};

export const closeBracket = {
  name: "link_close",
  triggers: "]",
  parse(state) {
    const bracketPos = state.pos;
    state.pos += 1;
    const startpos = state.pos;
    let opener = state.brackets;

    if (opener === null) {
      state.text("]", bracketPos, state.pos);
      return true;
    }
    if (!opener.active) {
      state.text("]", bracketPos, state.pos);
      state.removeBracket();
      return true;
    }

    const isImage = opener.image;
    const savepos = state.pos;
    let matched = false;
    let dest = null;
    let title = null;

    // An inline link: [text](destination "title")
    if (state.peek() === "(") {
      state.pos++;
      if (spnl(state) && (dest = parseLinkDestination(state)) !== null && spnl(state)) {
        // A title must be separated from the destination by whitespace.
        if (isWhitespaceChar(state.subject.charAt(state.pos - 1))) title = parseLinkTitle(state);
        spnl(state);
        if (state.peek() === ")") {
          state.pos += 1;
          matched = true;
        }
      }
      if (!matched) state.pos = savepos;
    }

    // A reference link: full [text][label], collapsed [text][] or shortcut [text].
    if (!matched) {
      const beforelabel = state.pos;
      const n = parseLinkLabel(state);
      let reflabel = null;
      if (n > 2) {
        reflabel = state.subject.slice(beforelabel, beforelabel + n);
      } else if (!opener.bracketAfter) {
        // The link text is the label — unless it holds a bracket.
        reflabel = state.subject.slice(opener.index, startpos);
      }
      if (n === 0) state.pos = savepos;
      if (reflabel !== null) {
        // refmap has no prototype, so any label is a safe key.
        const ref = state.refmap[normalizeLabel(reflabel)];
        if (ref) {
          dest = ref.destination;
          title = ref.title;
          matched = true;
        }
      }
    }

    const depth = matched ? state.depthAfter(opener.node) + 1 : 0;
    if (!matched || depth > MAX_INLINE_NESTING) {
      state.removeBracket();
      state.pos = startpos;
      state.text("]", bracketPos, state.pos);
      return true;
    }

    const node = new Node(isImage ? "image" : "link", { destination: dest, title: title ?? "" });
    node._depth = depth;
    let tmp = opener.node._next;
    while (tmp) {
      const next = tmp._next;
      node.appendChild(tmp);
      tmp = next;
    }
    state.add(node, opener.node._f, state.pos);
    state.processEmphasis(opener.previousDelimiter);
    state.removeBracket();
    opener.node.unlink();

    // No links in links: deactivate every earlier link opener. Below one
    // that is inactive already, all are (an earlier link did it), so the
    // walk can stop there — without that, "[a](b) [" repeated is quadratic.
    if (!isImage) {
      for (opener = state.brackets; opener !== null; opener = opener.previous) {
        if (opener.image) continue;
        if (!opener.active) break;
        opener.active = false;
      }
    }
    return true;
  },
};

// ── Autolinks (§6.5) and raw HTML (§6.6) ────────────────────────────────────

export const angle = {
  name: "autolink_or_html",
  triggers: "<",
  parse(state) {
    const start = state.pos;
    let m;
    if ((m = state.match(reEmailAutolink))) {
      const address = m.slice(1, -1);
      const link = new Node("link", { destination: normalizeURI("mailto:" + address), title: "", autolink: true });
      link.appendChild(textNode(address, start + 1, state.pos - 1));
      state.add(link, start, state.pos);
      return true;
    }
    if ((m = state.match(reAutolink))) {
      const uri = m.slice(1, -1);
      const link = new Node("link", { destination: normalizeURI(uri), title: "", autolink: true });
      link.appendChild(textNode(uri, start + 1, state.pos - 1));
      state.add(link, start, state.pos);
      return true;
    }
    if ((m = state.match(reHtmlTag))) {
      state.add(new Node("html_inline", { literal: m }), start, state.pos);
      return true;
    }
    return false;
  },
};

function textNode(literal, from, to) {
  const node = new Node("text", { literal });
  node._f = from;
  node._t = to;
  return node;
}

// ── Entity and numeric character references (§2.5) ─────────────────────────

const reEntityHere = new RegExp(ENTITY, "y");

export const entity = {
  name: "entity",
  triggers: "&",
  parse(state) {
    const start = state.pos;
    const m = state.match(reEntityHere);
    if (m === null) return false;
    const decoded = decodeEntity(m);
    if (decoded === null) return false;
    state.text(decoded, start, state.pos);
    return true;
  },
};
