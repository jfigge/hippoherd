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
 * context.js — where the cursor is, as autocomplete sees it.
 *
 * The context comes from the parser's tree (is the cursor in a code block?
 * on a fence's opening line? in a code span?) and from the text just
 * before the cursor (a / that starts a command, the [ of a reference).
 * It is one of:
 *
 *   block       a / at the start of a line (inside any quotes and list
 *               items), or an explicit request on a line with no content
 *               yet: block types — headings, lists, quotes, code…
 *   inline      a / starting a word mid-line, or an explicit request
 *               there: inline scaffolding — links, images, emphasis…
 *   fence-info  the info string of a code fence's opening line: languages
 *   link-ref    after "][": the document's link reference labels
 *   link-anchor after "](#": the document's headings, by their ids
 *
 * and the answer is { kind, from, query, prefix }: the suggestion replaces
 * text[from, cursor), `query` is what has been typed of it, and `prefix` is
 * what a new line needs to stay in the same quotes and list items.
 */

import { lineStartAt } from "../highlight/lines.js";

// Quote markers, list markers and indentation at the start of a line.
const CONTAINERS = String.raw`(?:[ \t]{0,3}(?:>[ \t]?|(?:[-+*]|[0-9]{1,9}[.)])[ \t]+))*[ \t]*`;
// Only ever used to MATCH (which always succeeds, greedily, in one pass):
// a test that could fail would backtrack exponentially through the
// ambiguous spaces of a deeply nested line.
const reContainers = new RegExp(`^${CONTAINERS}`);
const reSlashCommand = /^\/([A-Za-z0-9-]*)$/;
const reInlineSlash = /(?:^|\s)\/([A-Za-z0-9-]*)$/;
const reFenceInfo = /(?:`{3,}|~{3,})([ \t]*)([^\s`]*)$/;
const reLinkRef = /\]\[([^\][\n]*)$/;
const reLinkAnchor = /\]\(#([^)\s]*)$/;

// Inline nodes inside which nothing is suggested.
const VERBATIM = new Set(["code", "html_inline", "html_block"]);

export function completionContext(ast, text, offset, { explicit = false } = {}) {
  const lineStart = lineStartAt(text, offset);
  const before = text.slice(lineStart, offset);
  const lead = before.match(reContainers)[0];
  const rest = before.slice(lead.length);
  const prefix = continuation(lead);
  const at = (kind, from, query) => ({ kind, from, query, prefix });

  const path = ast ? pathAt(ast, offset) : [];
  const code = path.find((n) => n.type === "code_block") ?? openFenceBefore(path[path.length - 1], offset);
  if (code) {
    if (!code.fenced || code.pos.start.offset < lineStart) return null;
    // From just after the fence, so spaces typed before the language are
    // part of the suggestion (and a dismissed one stays dismissed).
    const m = before.match(reFenceInfo);
    return m ? at("fence-info", offset - m[1].length - m[2].length, m[2]) : null;
  }
  if (path.some((n) => VERBATIM.has(n.type))) return null;

  let m = before.match(reLinkRef);
  if (m) return at("link-ref", offset - m[1].length, m[1]);
  m = before.match(reLinkAnchor);
  if (m) return at("link-anchor", offset - m[1].length, m[1]);
  m = rest.match(reSlashCommand);
  if (m) return at("block", lineStart + lead.length, m[1]);
  m = before.match(reInlineSlash);
  if (m) return at("inline", offset - m[1].length - 1, m[1]);
  if (explicit) return at(rest === "" ? "block" : "inline", offset, "");
  return null;
}

// An unclosed fence runs to the end of its container, but its node ends
// with its last line of content: a cursor on an empty line after it (at the
// end of the document, say) is still in it.
function openFenceBefore(container, offset) {
  const kids = container?.children ?? [];
  const last = kids[kids.length - 1];
  if (!last || last.pos.end.offset > offset) return null;
  return last.type === "code_block" && last.fenced && !last.closed ? last : null;
}

// The nodes containing `offset`, outermost first. A node ending exactly at
// the offset contains it too: the cursor sits at its end.
export function pathAt(ast, offset) {
  const path = [];
  let node = ast;
  while (node) {
    path.push(node);
    let next = null;
    for (const child of node.children ?? []) {
      if (child.pos.start.offset > offset) break;
      if (offset <= child.pos.end.offset) next = child;
    }
    node = next;
  }
  return path;
}

// What continues a line's containers onto a new line: the quote markers
// stay, list markers become the spaces of their width.
export function continuation(lead) {
  return lead.replace(/(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t])/g, (marker) => " ".repeat(marker.length));
}
