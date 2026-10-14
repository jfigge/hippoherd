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
 * The tag filter (GFM's "disallowed raw HTML"): in raw HTML, the opening
 * < of title, textarea, style, xmp, iframe, noembed, noframes, script and
 * plaintext tags is escaped, so they show as text instead of taking over
 * the page. (The app's preview also strips such elements; this is what
 * GitHub's own renderer does, for HTML that leaves MarkHippo.)
 */

const reDisallowed = /<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s/>]|$))/gi;

export const filterTags = (html) => html.replace(reDisallowed, "&lt;");

export default {
  id: "tag-filter",
  name: "Tag filter",
  version: "1.0.0",
  description: "GitHub's disallowed raw HTML: <script>, <style>, <iframe> and the like in a document show as text.",
  setup(api) {
    api.renderer("html_block", (node, r) => {
      r.cr();
      r.lit(r.options.html ? filterTags(node.literal) : "<!-- raw HTML omitted -->");
      r.cr();
    });
    api.renderer("html_inline", (node, r) => {
      r.lit(r.options.html ? filterTags(node.literal) : "<!-- raw HTML omitted -->");
    });
  },
};
