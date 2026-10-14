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
 * scanners.js — the pieces of syntax more than one rule needs: link labels,
 * destinations and titles (inline links AND reference definitions), raw HTML
 * (inline tags AND HTML blocks), and autolinks.
 *
 * The scan functions work on any object with `subject`, `pos`, `peek()` and
 * `match(stickyRegex)` — the inline parser, or a ScanState over a string.
 */

import { ESCAPABLE, isEscapable, normalizeLabel, normalizeURI, unescapeString } from "./normalize.js";

// ── Raw HTML (§6.6) ─────────────────────────────────────────────────────────

// How deeply parentheses may nest in a link destination.
const MAX_LINK_PARENS = 32;

const WS = "[ \\t\\n\\r\\f\\v]";
const TAGNAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
const SINGLEQUOTEDVALUE = "'[^']*'";
const DOUBLEQUOTEDVALUE = '"[^"]*"';
const ATTRIBUTEVALUE = `(?:${UNQUOTEDVALUE}|${SINGLEQUOTEDVALUE}|${DOUBLEQUOTEDVALUE})`;
const ATTRIBUTEVALUESPEC = `(?:${WS}*=${WS}*${ATTRIBUTEVALUE})`;
const ATTRIBUTE = `(?:${WS}+${ATTRIBUTENAME}${ATTRIBUTEVALUESPEC}?)`;
export const OPENTAG = `<${TAGNAME}${ATTRIBUTE}*${WS}*/?>`;
export const CLOSETAG = `</${TAGNAME}${WS}*>`;
const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION = "<[?][\\s\\S]*?[?]>";
const DECLARATION = "<![A-Za-z]+[^>]*>";
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
const HTMLTAG = `(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSINGINSTRUCTION}|${DECLARATION}|${CDATA})`;

export const reHtmlTag = new RegExp(HTMLTAG, "y");

/* eslint-disable no-control-regex -- the spec's grammar names control characters */

// ── Autolinks (§6.5) ────────────────────────────────────────────────────────

export const reAutolink = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/y;
export const reEmailAutolink =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;

// ── Links (§6.3, §4.7) ──────────────────────────────────────────────────────

const ESCAPED_CHAR = "\\\\" + ESCAPABLE;
const reLinkTitle = new RegExp(
  `"(?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\"\\x00])*"` +
    `|'(?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\'\\x00])*'` +
    `|\\((?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\()\\x00])*\\)`,
  "y",
);
const reLinkDestinationBraces = /<(?:[^<>\n\\\x00]|\\.)*>/y;
const reLinkLabel = /\[(?:[^\\[\]]|\\.){0,1000}\]/sy;
const reSpnl = /[ \t]*(?:\n[ \t]*)?/y;
const reSpaceAtEndOfLine = /[ \t]*(?:\n|$)/y;
const reWhitespaceChar = /[ \t\n\x0b\x0c\x0d]/;

// A cursor over a plain string, for scanning outside the inline parser.
export class ScanState {
  constructor(subject, pos = 0) {
    this.subject = subject;
    this.pos = pos;
  }
  peek(at = this.pos) {
    return at < this.subject.length ? this.subject[at] : "";
  }
  match(re) {
    re.lastIndex = this.pos;
    const m = re.exec(this.subject);
    if (m === null) return null;
    this.pos = re.lastIndex;
    return m[0];
  }
}

// Optional spaces or tabs, with up to one line ending among them.
export function spnl(s) {
  s.match(reSpnl);
  return true;
}

export function isWhitespaceChar(ch) {
  return reWhitespaceChar.test(ch);
}

// A link label, brackets included: answers its length, or 0.
export function parseLinkLabel(s) {
  const m = s.match(reLinkLabel);
  return m === null || m.length > 1001 ? 0 : m.length;
}

// A link destination: answers it unescaped and percent-encoded, or null.
export function parseLinkDestination(s) {
  const res = s.match(reLinkDestinationBraces);
  if (res !== null) return normalizeURI(unescapeString(res.slice(1, -1)));
  if (s.peek() === "<") return null;

  const savepos = s.pos;
  let openparens = 0;
  let c;
  while ((c = s.peek()) !== "") {
    if (c === "\\" && isEscapable(s.peek(s.pos + 1))) {
      s.pos += 2;
    } else if (c === "(") {
      s.pos += 1;
      openparens += 1;
      // The spec lets implementations limit nesting; cmark's 32 keeps a run
      // of "[a](" from rescanning the rest of the paragraph at every "]".
      if (openparens > MAX_LINK_PARENS) return null;
    } else if (c === ")") {
      if (openparens < 1) break;
      s.pos += 1;
      openparens -= 1;
    } else if (reWhitespaceChar.test(c) || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) {
      break;
    } else {
      s.pos += 1;
    }
  }
  if (s.pos === savepos && c !== ")") return null;
  if (openparens !== 0) return null;
  return normalizeURI(unescapeString(s.subject.slice(savepos, s.pos)));
}

// A link title, quotes included in the match: answers it unescaped, or null.
export function parseLinkTitle(s) {
  const title = s.match(reLinkTitle);
  return title === null ? null : unescapeString(title.slice(1, -1));
}

// A link reference definition at s.pos (§4.7). On success adds it to
// `refmap` (first definition wins) and answers
// { length, label, destination, title }; else answers null with s.pos
// unchanged.
export function parseReference(s, refmap) {
  const startpos = s.pos;
  const labelLength = parseLinkLabel(s);
  if (labelLength === 0) return null;
  const rawlabel = s.subject.slice(startpos, startpos + labelLength);

  if (s.peek() !== ":") {
    s.pos = startpos;
    return null;
  }
  s.pos++;

  spnl(s);
  const destination = parseLinkDestination(s);
  if (destination === null) {
    s.pos = startpos;
    return null;
  }

  const beforetitle = s.pos;
  spnl(s);
  let title = null;
  if (s.pos !== beforetitle) title = parseLinkTitle(s);
  if (title === null) s.pos = beforetitle;

  // The definition must end the line; a title that does not can be dropped,
  // leaving a destination that does.
  let atLineEnd = s.match(reSpaceAtEndOfLine) !== null;
  if (!atLineEnd && title !== null) {
    title = null;
    s.pos = beforetitle;
    atLineEnd = s.match(reSpaceAtEndOfLine) !== null;
  }
  if (!atLineEnd) {
    s.pos = startpos;
    return null;
  }

  const label = normalizeLabel(rawlabel);
  if (label === "") {
    s.pos = startpos;
    return null;
  }
  if (!Object.hasOwn(refmap, label)) {
    refmap[label] = { destination, title: title ?? "" };
  }
  return { length: s.pos - startpos, label, destination, title: title ?? "" };
}
