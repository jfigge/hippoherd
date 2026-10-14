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
 * preview-view.js — the rendered document.
 *
 * The HTML comes from MarkHippo's own renderer (with `safe` URLs), and the
 * page's Content-Security-Policy stops any script or inline handler in the
 * document's raw HTML from running. The CSP cannot stop everything raw HTML
 * can do, though: a <meta http-equiv="refresh"> would navigate the page
 * away (and, the document being saved, do it again on every visit), a
 * <base> would re-point every relative link, a <form> could pose as the
 * app. So the HTML is built inert in a <template> first, those elements are
 * removed there, and unsafe URLs in raw HTML's own attributes are cleared,
 * before anything reaches the page.
 *
 * Links in the document open in a new tab — never in this one, where they
 * would replace the editor — except in-document #anchors, which scroll the
 * preview.
 */

import { potentiallyUnsafe } from "./render/html.js";

// Elements raw HTML may not bring into the page at all. (Scripts, frames
// and objects are blocked by the CSP too; removing them keeps that true
// wherever the page is hosted.)
// SVG animation is among them: <set attributeName="href" to="…"> would give
// a link a new address after it was checked.
const REMOVED =
  "meta, base, link, script, style, iframe, frame, frameset, object, embed, form, portal, svg set, svg animate, svg animateMotion, svg animateTransform";
const XLINK = "http://www.w3.org/1999/xlink";
// Attributes that hold a URL something could be loaded from or run.
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href", "poster", "background"];
// (An SVG's xlink:href is namespaced, which attribute selectors do not
// match, so SVG links and references are looked at whatever they carry.)
const URL_SELECTOR = [...URL_ATTRIBUTES.map((a) => `[${CSS.escape(a)}]`), "svg a", "svg use", "svg image"].join(", ");

export class PreviewView {
  // `taskAttribute`: the attribute the renderer puts a task checkbox's
  // source offset in (its `taskAttribute` option); `onTask(offset)` is
  // called when one is clicked. `onUpdate()` runs after each new HTML is in
  // place (the plugins' enhancers). `rewrite(root)` adjusts the sanitized
  // HTML before it goes in — the desktop app points the document's own
  // images at the files beside it.
  constructor(el, scroller, { taskAttribute, onTask, onUpdate, rewrite } = {}) {
    this.el = el;
    this.scroller = scroller ?? el;
    this.taskAttribute = taskAttribute;
    this.onTask = onTask ?? (() => {});
    this.onUpdate = onUpdate ?? (() => {});
    this.rewrite = rewrite ?? (() => {});
    el.addEventListener("click", (e) => this.click(e));
  }

  update(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    sanitize(template.content);
    this.rewrite(template.content);
    // Keep the reader where they were: replacing the content resets nothing
    // the browser would preserve on its own.
    const top = this.scroller.scrollTop;
    this.el.replaceChildren(template.content);
    this.scroller.scrollTop = top;
    this.onUpdate();
  }

  // Every link-like element is caught — HTML links, image-map areas, SVG
  // links (whose address may be xlink:href) — and never followed in place.
  click(e) {
    const task = this.taskAttribute && e.target.closest(`input[type=checkbox][${this.taskAttribute}]`);
    if (task && this.el.contains(task)) {
      e.preventDefault();
      this.onTask(Number(task.getAttribute(this.taskAttribute)));
      return;
    }
    const a = e.target.closest("a, area");
    if (!a || !this.el.contains(a)) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? a.getAttributeNS(XLINK, "href");
    if (!href) return;
    if (href.startsWith("#")) {
      const target = href.length > 1 && this.el.querySelector(`[id="${CSS.escape(fragment(href))}"]`);
      if (target) target.scrollIntoView({ block: "start" });
      return;
    }
    let url;
    try {
      url = new URL(href, document.baseURI);
    } catch {
      return;
    }
    if (!potentiallyUnsafe(url.href)) window.open(url.href, "_blank", "noopener,noreferrer");
  }
}

// Remove what raw HTML must not do (see the top of this file).
export function sanitize(root) {
  for (const el of root.querySelectorAll(REMOVED)) {
    // A form's content can stay; the form itself goes.
    if (el.localName === "form") el.replaceWith(...el.childNodes);
    else el.remove();
  }
  // Raw HTML's inline styles: the page allows inline styles (Mermaid's
  // diagrams need them), but a document's HTML must not restyle the page.
  for (const el of root.querySelectorAll("[style]")) el.removeAttribute("style");
  for (const el of root.querySelectorAll(URL_SELECTOR)) {
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value !== null && potentiallyUnsafe(value)) el.removeAttribute(name);
    }
  }
}

// The id a #fragment names; a malformed escape is taken as written.
function fragment(href) {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}
