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
 * HTML for the CommonMark node types, written to match the reference
 * renderer's output exactly (see render/html.js).
 */

import { plainText } from "../../render/slug.js";

function block(tagName) {
  return (node, r) => {
    r.cr();
    r.tag(tagName, r.attrs(node));
    r.cr();
    r.children(node);
    r.cr();
    r.tag("/" + tagName);
    r.cr();
  };
}

function inline(tagName) {
  return (node, r) => {
    r.tag(tagName);
    r.children(node);
    r.tag("/" + tagName);
  };
}

export const renderers = {
  block_quote: block("blockquote"),

  list(node, r) {
    const tagName = node.ordered ? "ol" : "ul";
    const attrs = r.attrs(node);
    if (node.ordered && node.start !== 1) attrs.push(["start", String(node.start)]);
    r.cr();
    r.tag(tagName, attrs);
    r.cr();
    r.children(node);
    r.cr();
    r.tag("/" + tagName);
    r.cr();
  },

  item(node, r) {
    r.tag("li", r.attrs(node));
    r.children(node);
    r.tag("/li");
    r.cr();
  },

  // In a tight list a paragraph is just its content.
  paragraph(node, r) {
    const grandparent = r.ancestor(2);
    if (grandparent && grandparent.type === "list" && grandparent.tight) {
      r.children(node);
      return;
    }
    r.cr();
    r.tag("p", r.attrs(node));
    r.children(node);
    r.tag("/p");
    r.cr();
  },

  heading(node, r) {
    const attrs = r.attrs(node);
    if (r.options.headingIds) attrs.push(["id", r.esc(r.slug(plainText(node)))]);
    r.cr();
    r.tag("h" + node.level, attrs);
    r.children(node);
    r.tag("/h" + node.level);
    r.cr();
  },

  code_block(node, r) {
    const lang = node.info ? node.info.split(/\s+/)[0] : "";
    const fence = lang && r.registry.fenceRenderers.get(lang.toLowerCase());
    if (fence) {
      fence(node, r, lang);
      return;
    }
    r.cr();
    r.tag("pre", r.attrs(node));
    r.tag("code", lang ? [["class", "language-" + r.esc(lang)]] : []);
    r.lit(r.code(node.literal, lang));
    r.tag("/code");
    r.tag("/pre");
    r.cr();
  },

  thematic_break(node, r) {
    r.cr();
    r.tag("hr", r.attrs(node), true);
    r.cr();
  },

  html_block(node, r) {
    r.cr();
    r.lit(r.options.html ? node.literal : "<!-- raw HTML omitted -->");
    r.cr();
  },

  // Definitions are data, not content.
  link_reference_definition() {},

  html_inline(node, r) {
    r.lit(r.options.html ? node.literal : "<!-- raw HTML omitted -->");
  },

  linebreak(node, r) {
    r.tag("br", [], true);
    r.cr();
  },

  emph: inline("em"),
  strong: inline("strong"),

  code(node, r) {
    r.tag("code");
    r.out(node.literal);
    r.tag("/code");
  },

  link(node, r) {
    const attrs = [["href", r.url(node.destination)]];
    if (node.title) attrs.push(["title", r.esc(node.title)]);
    r.tag("a", attrs);
    r.children(node);
    r.tag("/a");
  },

  // Everything inside an image is its alt text: plain, with no tags.
  image(node, r) {
    if (r.disableTags === 0) r.lit(`<img src="${r.url(node.destination)}" alt="`);
    r.disableTags += 1;
    r.children(node);
    r.disableTags -= 1;
    if (r.disableTags === 0) {
      if (node.title) r.lit(`" title="${r.esc(node.title)}`);
      r.lit('" />');
    }
  },
};
