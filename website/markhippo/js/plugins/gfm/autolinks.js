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
 * Autolinks, extended (GFM): bare www., http://, https://, ftp:// links and
 * email addresses become links without the <angle brackets>.
 *
 *   www.example.com   https://example.com/path   me@example.com
 *   mailto:me@example.com   xmpp:me@example.com/resource
 *
 * They are found in the plain text the inline parser leaves (an inline
 * finisher), never inside links, images or code. A link starts at a word
 * boundary; trailing punctuation (?!.,:*_~'"), an unbalanced ")" and a
 * trailing entity-like &name; are left out of it, as the GFM spec says.
 */

import { Node } from "../../parser/nodes.js";
import { normalizeURI } from "../../parser/normalize.js";

const reBoundary = /[\s*_~("'<>[\]]/;
const isLocal = (c) => /[A-Za-z0-9.+_-]/.test(c);
const isDomainChar = (c) => /[A-Za-z0-9_.-]/.test(c) || c.codePointAt(0) >= 0x80;

// A domain at text[at…]: its end, or -1 if invalid. `dots`: at least one
// period required. GFM: no underscore in the last two labels.
function domainEnd(text, at, dots) {
  let end = at;
  while (end < text.length && isDomainChar(text[end])) end++;
  // Trailing periods are punctuation, not domain.
  while (end > at && text[end - 1] === ".") end--;
  if (end === at) return -1;
  const labels = text.slice(at, end).split(".");
  if (dots && labels.length < 2) return -1;
  if (labels.slice(-2).some((l) => l.includes("_"))) return -1;
  return end;
}

// Extend a link over its path, then trim what GFM says is not part of it.
function pathEnd(text, start, end) {
  while (end < text.length && !/[\s<]/.test(text[end])) end++;
  return trimEnd(text, start, end);
}

function trimEnd(text, start, end) {
  for (;;) {
    const last = text[end - 1];
    if ("?!.,:*_~'\"".includes(last)) {
      end--;
    } else if (last === ")") {
      const link = text.slice(start, end);
      const open = (link.match(/\(/g) ?? []).length;
      const close = (link.match(/\)/g) ?? []).length;
      if (close <= open) return end;
      end--;
    } else if (last === ";") {
      const m = text.slice(0, end).match(/&[A-Za-z0-9]+;$/);
      if (!m) return end;
      end -= m[0].length;
    } else {
      return end;
    }
  }
}

// An email at text[at…] (local@domain): its end, or -1.
function emailEnd(text, at) {
  let i = at;
  while (i < text.length && isLocal(text[i])) i++;
  if (i === at || text[i] !== "@") return -1;
  let end = i + 1;
  while (end < text.length && /[A-Za-z0-9_.-]/.test(text[end])) end++;
  while (end > i + 1 && text[end - 1] === ".") end--;
  const domain = text.slice(i + 1, end);
  if (!domain.includes(".") || /[-_]$/.test(domain)) return -1;
  return end;
}

// The autolink starting at text[at], if there is one: { end, href }.
// `emailOnly`: only an email address (mailto:, xmpp: or plain) may start
// here, not a www. or http:// link.
function linkAt(text, at, emailOnly) {
  const rest = text.slice(at, at + 8).toLowerCase();
  if (rest.startsWith("mailto:") || rest.startsWith("xmpp:")) {
    const scheme = rest.startsWith("mailto:") ? 7 : 5;
    let end = emailEnd(text, at + scheme);
    if (end === -1) return null;
    if (scheme === 5 && text[end] === "/") {
      let r = end + 1;
      while (r < text.length && /[A-Za-z0-9@.]/.test(text[r])) r++;
      end = trimEnd(text, at, r);
    }
    return { end, href: text.slice(at, end) };
  }
  if (emailOnly) {
    const end = emailEnd(text, at);
    return end === -1 ? null : { end, href: "mailto:" + text.slice(at, end) };
  }
  if (rest.startsWith("www.")) {
    const end = domainEnd(text, at + 4, false);
    if (end === -1) return null;
    const stop = pathEnd(text, at, end);
    return { end: stop, href: "http://" + text.slice(at, stop) };
  }
  const scheme = /^(?:https?|ftp):\/\//i.exec(text.slice(at, at + 8));
  if (scheme) {
    const end = domainEnd(text, at + scheme[0].length, false);
    if (end === -1) return null;
    const stop = pathEnd(text, at, end);
    return { end: stop, href: text.slice(at, stop) };
  }
  const end = emailEnd(text, at);
  return end === -1 ? null : { end, href: "mailto:" + text.slice(at, end) };
}

function autolinkText(state, node) {
  const text = node.literal;
  // Only text that is exactly its source: offsets map one to one.
  if (state.subject.slice(node._f, node._t) !== text) return;
  const pieces = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const before = i === 0 ? (node._f > 0 ? state.subject[node._f - 1] : " ") : text[i - 1];
    // Links start at a word boundary; an email may also follow other
    // punctuation ("at:me@example.com"), but never part of a local part.
    const open = reBoundary.test(before);
    const emailOnly = !open && !isLocal(before) && !/[A-Za-z0-9]/.test(before);
    if (!open && !emailOnly) continue;
    const found = linkAt(text, i, emailOnly);
    if (!found || found.end <= i) continue;
    if (i > from) pieces.push({ text: text.slice(from, i), at: from });
    pieces.push({ text: text.slice(i, found.end), at: i, href: found.href });
    i = found.end - 1;
    from = found.end;
  }
  if (!pieces.length) return;
  if (from < text.length) pieces.push({ text: text.slice(from), at: from });
  for (const piece of pieces) {
    const f = node._f + piece.at;
    const t = f + piece.text.length;
    let out = new Node("text", { literal: piece.text });
    out._f = f;
    out._t = t;
    if (piece.href) {
      const link = new Node("link", { destination: normalizeURI(piece.href), title: "", autolink: true });
      link._f = f;
      link._t = t;
      link.appendChild(out);
      out = link;
    }
    node.insertBefore(out);
  }
  node.unlink();
}

function finish(state, parent) {
  for (let node = parent._first; node; ) {
    const next = node._next;
    if (node.type === "text") autolinkText(state, node);
    else if (node.type !== "link" && node.type !== "image" && node._first) finish(state, node);
    node = next;
  }
}

export default {
  id: "autolinks",
  name: "Autolinks",
  version: "1.0.0",
  description: "GitHub's bare links: www.example.com, https://example.com and email addresses become links on their own.",
  setup(api) {
    api.inlineFinisher(finish);
  },
};
