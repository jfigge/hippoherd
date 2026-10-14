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
 * exporter.js — the document out of the app: printed (or saved as a PDF by
 * the print dialog), as an HTML page, RTF or plain text, or copied as rich
 * text to paste into email and documents.
 *
 * Every export starts from the renderer's HTML, sanitized as the preview's
 * is (preview-view.js), without the preview's own marks (source lines,
 * live checkboxes). The HTML page, the print and the copy are finished by
 * the plugins' enhancers — math as MathML, diagrams as SVG — in the light
 * theme, whatever the page's mode: paper is white. RTF and plain text read
 * the HTML as it is, so math is its TeX and a diagram its source.
 *
 * Printing never prints the page itself: the document is put in a print
 * area (#mh-print), which the print stylesheet shows alone, in the light
 * colours of the palette in use.
 *
 * In the desktop app (desktop.js) the shell prints, makes PDFs and holds
 * the clipboard, and the document's own pictures — files beside it, which
 * no export could reach by their relative paths — go into every export as
 * data: URLs.
 */

import { enhance } from "./enhance.js";
import { dataUrl } from "./image-import.js";
import { sanitize } from "./preview-view.js";
import { htmlPage, pageCss } from "./export/page.js";
import { toRtf } from "./export/rtf.js";
import { toText } from "./export/text.js";

// What the HTML page takes from the app's stylesheets besides the colours.
const PAGE_VARS = ["--brand", "--on-brand", "--sans", "--serif", "--mono", "--code-size", "--code-line"];
const STYLESHEETS = ["css/preview.css", "css/syntax.css"];

export class Exporter {
  // `render()`: the document's HTML, for export; `registry()`: the
  // plugins' registry (its enhancers); `colours()`: the light colours of
  // the palette in use; `title()`: the document's title; `printArea`: the
  // element printing shows; `preview`: the preview's element.
  //
  // The desktop app's: `localImages(root)` puts the document's own pictures
  // in `root` as data: URLs; `printer()` prints the print area and settles
  // when done; `clipboard(html, text)` copies.
  constructor({ render, registry, colours, title, printArea, preview, localImages, printer, clipboard }) {
    this.render = render;
    this.registry = registry;
    this.colours = colours;
    this.title = title;
    this.printArea = printArea;
    this.preview = preview;
    this.localImages = localImages ?? (async () => {});
    this.printer = printer ?? null;
    this.clipboard = clipboard ?? null;
    window.addEventListener("beforeprint", () => this.beforePrint());
    window.addEventListener("afterprint", () => this.afterPrint());
  }

  // The document, sanitized but not enhanced.
  tree() {
    const template = document.createElement("template");
    template.innerHTML = this.render();
    sanitize(template.content);
    return template.content;
  }

  // The document finished by the enhancers, in the light theme. They need
  // it in the page while they work, so it waits there out of sight.
  async finished(tree = this.tree()) {
    const stage = document.createElement("div");
    stage.className = "mh-export-stage";
    stage.setAttribute("aria-hidden", "true");
    stage.append(tree);
    document.body.append(stage);
    try {
      await Promise.all([enhance(stage, this.registry(), { dark: false }), this.localImages(stage)]);
    } finally {
      stage.remove();
    }
    return stage;
  }

  text() {
    return toText(this.tree());
  }

  async rtf() {
    const tree = this.tree();
    await this.localImages(tree);
    return toRtf(tree, { title: this.title() });
  }

  async html() {
    const tree = this.tree();
    const used = this.registry().enhancers.filter((e) => e.stylesheet && tree.querySelector(e.selector));
    // The styles are read while the enhancers work.
    const sheets = Promise.all([...STYLESHEETS.map((href) => new URL(href, document.baseURI).href), ...used.map((e) => e.stylesheet)].map(stylesheet));
    const [stage, css] = await Promise.all([this.finished(tree), sheets]);
    const computed = getComputedStyle(document.documentElement);
    const vars = { ...Object.fromEntries(PAGE_VARS.map((name) => [name, computed.getPropertyValue(name).trim()])), ...this.colours() };
    return htmlPage({ title: this.title(), body: stage.innerHTML, css: [...css, pageCss(vars)].join("\n") });
  }

  // Rich text (the finished HTML) and plain text together, for pasting
  // anywhere. Where the clipboard API is missing, the HTML is copied as
  // rendered, without waiting for the enhancers.
  async copy() {
    const text = this.text();
    if (this.clipboard) {
      await this.clipboard((await this.finished()).innerHTML, text);
      return;
    }
    if (window.ClipboardItem && navigator.clipboard?.write) {
      // The HTML is a promise, so the copy keeps the click's permission
      // while the enhancers work (Safari requires this).
      const html = this.finished().then((stage) => new Blob([stage.innerHTML], { type: "text/html" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/html": html, "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return;
    }
    const holder = document.createElement("div");
    holder.append(this.tree());
    const copied = copyEvent({ "text/html": holder.innerHTML, "text/plain": text });
    if (!copied) throw new Error("This browser would not copy.");
  }

  // ── Printing ─────────────────────────────────────────────────────────────

  async print() {
    const stage = await this.finished();
    this.fill([...stage.childNodes]);
    if (!this.printer) {
      window.print();
      return;
    }
    await this.printing(() => this.printer());
  }

  // The document as a PDF, which `save()` (the desktop app's) makes from
  // the print area and saves; answers what it does.
  async pdf(save) {
    const stage = await this.finished();
    this.fill([...stage.childNodes]);
    return this.printing(save);
  }

  // Printing done by the shell, which fires no print events of its own.
  async printing(run) {
    this.beforePrint();
    try {
      return await run();
    } finally {
      this.afterPrint();
    }
  }

  // Printing started from the browser (its menu), with no time to finish a
  // fresh copy: the preview as it is — math and all, but its diagrams in
  // the page's mode.
  beforePrint() {
    if (!this.printArea.hasChildNodes()) this.fill([...this.preview.cloneNode(true).childNodes]);
    // The title names the PDF. The page is light while it prints, so its
    // canvas is paper-white even with background graphics printed.
    const root = document.documentElement;
    this.saved ??= { title: document.title, scheme: root.style.colorScheme };
    document.title = this.title();
    root.style.colorScheme = "light";
  }

  afterPrint() {
    this.printArea.replaceChildren();
    if (!this.saved) return;
    document.title = this.saved.title;
    document.documentElement.style.colorScheme = this.saved.scheme;
    this.saved = null;
  }

  fill(nodes) {
    const area = this.printArea;
    area.replaceChildren(...nodes);
    for (const [name, value] of Object.entries(this.colours())) area.style.setProperty(name, value);
    area.style.colorScheme = "light";
  }
}

// A stylesheet's text, with what it loads relative to itself (Temml's font)
// carried inside it as data: URLs, so the page works from anywhere.
async function stylesheet(href) {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`Could not read ${href}`);
  let css = await response.text();
  const urls = new Set();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) if (!/^(?:data:|#)/i.test(m[2])) urls.add(m[2]);
  const inlined = new Map();
  for (const url of urls) {
    const res = await fetch(new URL(url, href));
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = blob.type || (/\.woff2$/i.test(url) ? "font/woff2" : "application/octet-stream");
    inlined.set(url, await dataUrl(new Blob([blob], { type })));
  }
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, url) => (inlined.has(url) ? `url("${inlined.get(url)}")` : m));
  return `/* ${href.split("/").pop()} */\n${css}`;
}

// Copy `data` ({ type: string }) the old way: a copy command whose event
// carries it. Answers whether the browser copied.
function copyEvent(data) {
  const put = (e) => {
    for (const [type, value] of Object.entries(data)) e.clipboardData.setData(type, value);
    e.preventDefault();
  };
  document.addEventListener("copy", put, { once: true });
  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", put);
  }
}
