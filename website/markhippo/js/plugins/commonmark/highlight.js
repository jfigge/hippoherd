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
 * How the CommonMark node types are coloured in the edit pane (see
 * highlight/highlight.js). Tokens become mh-<token> classes:
 *
 *   md-heading md-h1…md-h6   a heading, all of it
 *   md-marker                syntax that is not content: # and closing #s,
 *                            setext underlines, emphasis delimiters, the
 *                            brackets of links, the backticks of code
 *   md-quote md-list         block quote > and list item markers
 *   md-emph md-strong        emphasis
 *   md-code                  a code span
 *   md-codeblock md-fence md-info
 *                            a code block, its fence lines and the
 *                            language of its info string
 *   md-link md-image md-url  link text, image alt text, and the
 *                            destination part — (url "title"), [ref]
 *   md-definition md-label md-string
 *                            a link reference definition and its parts
 *   md-html md-hr md-break md-escape md-entity
 */

import { decodeEntity } from "../../parser/normalize.js";

const reEscapeOrEntity = /\\[!-/:-@[-`{-~]|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g;
const reListMarker = /[-+*]|[0-9]{1,9}[.)]/y;
const reLabel = /[ \t]*\[(?:\\[^]|[^\\\]])*\]:/y;
const reDestination = /<(?:\\[^]|[^\\>\n])*>|\S+/y;

// Past spaces, and past a line break together with the next line's
// container markers (> and indentation), which belong to the containers.
function skipSpace(src, at) {
  while (src[at] === " " || src[at] === "\t") at++;
  if (src[at] === "\r") at++;
  if (src[at] === "\n") {
    at++;
    while (src[at] === " " || src[at] === "\t" || src[at] === ">") at++;
  }
  return at;
}

const start = (node) => node.pos.start.offset;
const end = (node) => node.pos.end.offset;

// Colour a container node as `token`, with the syntax before its first child
// and after its last as markers — **, [, ](url), and the like.
function wrapped(token, tailToken = "md-marker") {
  return (node, h) => {
    h.mark(start(node), end(node), token);
    const kids = node.children ?? [];
    if (kids.length) {
      h.mark(start(node), start(kids[0]), "md-marker");
      h.mark(end(kids[kids.length - 1]), end(node), tailToken);
    }
    h.children(node);
  };
}

export const highlighters = {
  heading(node, h) {
    h.mark(start(node), end(node), "md-heading");
    h.mark(start(node), end(node), "md-h" + node.level);
    const kids = node.children ?? [];
    if (!kids.length) {
      h.mark(start(node), end(node), "md-marker");
    } else {
      h.mark(start(node), start(kids[0]), "md-marker");
      h.mark(end(kids[kids.length - 1]), end(node), "md-marker");
    }
    h.children(node);
  },

  // Each line's > — found at the quote's own column, since lines further
  // in (or lazy continuation lines, which have none) belong to it too.
  block_quote(node, h) {
    const src = h.source;
    const column = node.pos.start.column - 1;
    for (let line = node.pos.start.line; line <= node.pos.end.line; line++) {
      let at = h.lineStart(line) + column;
      const stop = Math.min(h.lineEnd(line), at + 4);
      while (at < stop && src[at] === " ") at++;
      if (at < stop && src[at] === ">") h.mark(at, at + 1, "md-quote");
    }
    h.children(node);
  },

  item(node, h) {
    reListMarker.lastIndex = start(node);
    if (reListMarker.test(h.source)) h.mark(start(node), reListMarker.lastIndex, "md-list");
    h.children(node);
  },

  code_block(node, h) {
    h.mark(start(node), end(node), "md-codeblock");
    const first = node.pos.start.line;
    if (!node.fenced) {
      h.code(null, node.literal, first);
      return;
    }
    const src = h.source;
    const openEnd = h.lineEnd(first);
    h.mark(start(node), openEnd, "md-fence");
    let at = start(node);
    while (at < openEnd && (src[at] === "`" || src[at] === "~")) at++;
    while (at < openEnd && (src[at] === " " || src[at] === "\t")) at++;
    let infoEnd = openEnd;
    while (infoEnd > at && (src[infoEnd - 1] === " " || src[infoEnd - 1] === "\t")) infoEnd--;
    h.mark(at, infoEnd, "md-info");
    if (node.closed && node.pos.end.line > first) {
      const last = node.pos.end.line;
      h.mark(h.lineStart(last), h.lineEnd(last), "md-fence");
    }
    h.code(node.info, node.literal, first + 1);
  },

  html_block: (node, h) => h.mark(start(node), end(node), "md-html"),
  html_inline: (node, h) => h.mark(start(node), end(node), "md-html"),
  thematic_break: (node, h) => h.mark(start(node), end(node), "md-hr"),
  linebreak: (node, h) => h.mark(start(node), end(node), "md-break"),

  link_reference_definition(node, h) {
    const src = h.source;
    h.mark(start(node), end(node), "md-definition");
    reLabel.lastIndex = start(node);
    if (!reLabel.test(src)) return;
    h.mark(start(node), reLabel.lastIndex, "md-label");
    const dest = skipSpace(src, reLabel.lastIndex);
    reDestination.lastIndex = dest;
    if (!reDestination.test(src) || reDestination.lastIndex > end(node)) return;
    h.mark(dest, reDestination.lastIndex, "md-url");
    const title = skipSpace(src, reDestination.lastIndex);
    if (title < end(node)) h.mark(title, end(node), "md-string");
  },

  emph: wrapped("md-emph"),
  strong: wrapped("md-strong"),

  link(node, h) {
    if (node.autolink) {
      h.mark(start(node), end(node), "md-url");
      return;
    }
    wrapped("md-link", "md-url")(node, h);
  },

  image: wrapped("md-image", "md-url"),

  code(node, h) {
    const src = h.source;
    h.mark(start(node), end(node), "md-code");
    let ticks = 0;
    while (src[start(node) + ticks] === "`") ticks++;
    h.mark(start(node), start(node) + ticks, "md-marker");
    h.mark(end(node) - ticks, end(node), "md-marker");
  },

  // Text is plain, but for the backslash escapes and entity references the
  // parser has already decoded inside it.
  text(node, h) {
    const from = start(node);
    const slice = h.source.slice(from, end(node));
    if (slice.indexOf("\\") === -1 && slice.indexOf("&") === -1) return;
    reEscapeOrEntity.lastIndex = 0;
    let m;
    while ((m = reEscapeOrEntity.exec(slice)) !== null) {
      // A name HTML does not define stayed literal text.
      if (m[0][0] === "&" && decodeEntity(m[0]) === null) continue;
      h.mark(from + m.index, from + m.index + m[0].length, m[0][0] === "\\" ? "md-escape" : "md-entity");
    }
  },
};
