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
 * html.js — AST to HTML.
 *
 * One consumer of the parser's tree among several. Every node type renders
 * through a function registered in the registry (`api.renderer(type, fn)`);
 * the engine itself only knows how to render the types the core parser
 * produces with no plugins at all — documents, paragraphs and text. A type
 * nobody registered renders its children, so an unknown node never loses
 * its content.
 *
 * A renderer is `fn(node, r)`, where `r` is this HtmlRenderer: it writes
 * with r.tag(), r.out() (escaped text), r.lit() (raw HTML), r.code() (a code
 * block's content, coloured when its language is known) and r.cr(), and
 * descends with r.children(node). Output matches the CommonMark reference
 * renderer byte for byte, which is what the spec suite compares against.
 *
 * Options:
 *   html         emit raw HTML (blocks and inline); off → omitted. Default true.
 *   safe         neutralise javascript:, vbscript:, file: and non-image data:
 *                URLs. Default false.
 *   sourceLines  put data-line="N" (the 1-based source line) on block
 *                elements — the marks synced scroll steers by. A string
 *                names the attribute instead (the app uses a per-session
 *                name raw HTML cannot guess). Default false.
 *   softbreak    what a soft line break renders as. Default "\n".
 *   headingIds   give headings ids from their text (render/slug.js), so
 *                #links and the outline can reach them. Default false.
 */

import { codeToHtml, languageFor, tokenizeCode } from "../highlight/code.js";
import { slugger } from "./slug.js";

const reUnsafeProtocol = /^(?:javascript|vbscript|file|data):/i;
const reSafeDataProtocol = /^data:image\/(?:png|gif|jpeg|webp)/i;
const reNeedsEscape = /[&<>"]/;
const reEscape = /[&<>"]/g;
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(s) {
  return reNeedsEscape.test(s) ? s.replace(reEscape, (c) => ESCAPES[c]) : s;
}

// Is `url` one that could run script or reach the file system? Judged as a
// browser reads it: tabs and line breaks anywhere, and controls and spaces
// in front, are ignored ("java&#9;script:" is still javascript:).
export function potentiallyUnsafe(url) {
  // eslint-disable-next-line no-control-regex
  const plain = url.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, "");
  return reUnsafeProtocol.test(plain) && !reSafeDataProtocol.test(plain);
}

const CORE_RENDERERS = {
  document: (node, r) => r.children(node),
  paragraph(node, r) {
    r.cr();
    r.tag("p", r.attrs(node));
    r.children(node);
    r.tag("/p");
    r.cr();
  },
  text: (node, r) => r.out(node.literal),
  softbreak: (node, r) => r.lit(r.options.softbreak),
};

export class HtmlRenderer {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.options = { html: true, safe: false, sourceLines: false, softbreak: "\n", headingIds: false, ...options };
  }

  render(ast) {
    this.buffer = "";
    this.lastOut = "\n";
    this.disableTags = 0;
    this.stack = [];
    this.slug = slugger();
    this.node(ast);
    return this.buffer;
  }

  // ── For renderers ─────────────────────────────────────────────────────────

  node(node) {
    const fn = this.registry.renderers.get(node.type) ?? CORE_RENDERERS[node.type];
    if (fn) fn(node, this);
    else this.children(node);
  }

  children(node) {
    if (!node.children) return;
    this.stack.push(node);
    for (const child of node.children) this.node(child);
    this.stack.pop();
  }

  // The node `depth` levels above the one being rendered (1 = its parent).
  ancestor(depth = 1) {
    return this.stack[this.stack.length - depth] ?? null;
  }

  lit(s) {
    this.buffer += s;
    this.lastOut = s;
  }

  out(s) {
    this.lit(escapeHtml(s));
  }

  esc(s) {
    return escapeHtml(s);
  }

  // A newline, unless the output already ends with one.
  cr() {
    if (this.lastOut !== "\n") this.lit("\n");
  }

  // An HTML tag; attribute values must already be escaped. Suppressed inside
  // an image's alt text.
  tag(name, attrs, selfClosing) {
    if (this.disableTags > 0) return;
    let s = "<" + name;
    if (attrs) for (const [k, v] of attrs) s += ` ${k}="${v}"`;
    if (selfClosing) s += " /";
    this.lit(s + ">");
  }

  // The attributes every block element gets: its source line, if asked for.
  attrs(node) {
    const { sourceLines } = this.options;
    if (!sourceLines || !node.pos) return [];
    return [[typeof sourceLines === "string" ? sourceLines : "data-line", String(node.pos.start.line)]];
  }

  // A code block's content as HTML: coloured, if a plugin registered the
  // language its info string names (see highlight/code.js), else just
  // escaped.
  code(literal, info) {
    const lang = languageFor(this.registry, info);
    return lang ? codeToHtml(literal, tokenizeCode(lang, literal), escapeHtml) : escapeHtml(literal);
  }

  // A URL as it should be written into an attribute.
  url(url) {
    return this.options.safe && potentiallyUnsafe(url) ? "" : escapeHtml(url);
  }
}
