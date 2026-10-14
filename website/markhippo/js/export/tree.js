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
 * tree.js — what the exporters read: the rendered document as a tree of
 * HTML nodes.
 *
 * The exporters to plain text and RTF convert the renderer's HTML, not the
 * parser's tree, so every plugin's syntax exports without the plugin doing
 * anything more than render it. They read nodes through this much of the
 * DOM only — nodeType, localName, childNodes, getAttribute, textContent,
 * data — so they run on the page's DOM and, in the tests, on anything
 * shaped like it.
 */

export const ELEMENT = 1;
export const TEXT = 3;

// Elements that make a block of their own.
export const BLOCKS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

// Elements with nothing to say in words: a diagram's SVG, MathML (the math
// span around it carries the TeX), media, controls other than checkboxes.
export const SKIPPED = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "iframe",
  "math",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

export const elements = (node) => [...node.childNodes].filter((child) => child.nodeType === ELEMENT);

export function hasClass(node, name) {
  return (node.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

// A node's children in runs: each block element alone, and the inline
// nodes (text and inline elements) between them together.
export function* runs(nodes) {
  let inline = [];
  for (const node of nodes) {
    if (node.nodeType === ELEMENT && BLOCKS.has(node.localName)) {
      if (inline.length) yield { inline };
      inline = [];
      yield { block: node };
    } else if (node.nodeType === ELEMENT || node.nodeType === TEXT) {
      inline.push(node);
    }
  }
  if (inline.length) yield { inline };
}

// The TeX of a math element (the math plugin's span or div), before or
// after the enhancer turned it into MathML — which keeps the TeX as the
// element's title.
export function mathOf(node) {
  if (!hasClass(node, "math")) return null;
  return { tex: (node.getAttribute("title") ?? node.textContent).trim(), display: hasClass(node, "math-display") };
}

// A table's rows: [{ cells: [{ node, align }], head }], from its head,
// bodies and foot in order.
export function tableRows(table) {
  const rows = [];
  const add = (tr, head) => {
    const cells = elements(tr)
      .filter((c) => c.localName === "td" || c.localName === "th")
      .map((node) => ({ node, align: (node.getAttribute("align") ?? "").toLowerCase() }));
    rows.push({ cells, head });
  };
  for (const part of elements(table)) {
    if (part.localName === "tr") add(part, false);
    else if (["thead", "tbody", "tfoot"].includes(part.localName)) {
      for (const tr of elements(part)) if (tr.localName === "tr") add(tr, part.localName === "thead");
    }
  }
  return rows;
}

// Is a link's text just its address (an autolink, a bare URL, an email)?
export function linkIsItsText(text, href) {
  const plain = (s) =>
    s
      .trim()
      .replace(/^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/)?/i, "")
      .replace(/\/$/, "")
      .toLowerCase();
  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    // A malformed escape: compare as written.
  }
  return plain(text) === plain(href) || plain(text) === plain(decoded);
}

// The bytes of a base64 string (atob is not an ES built-in).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));

export function base64Bytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const c of clean) {
    value = (value << 6) | B64_VALUE.get(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (value >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, at);
}

// A data: URL's image, if it is one RTF can carry: { type, bytes, width,
// height } for base64 PNG and JPEG, else null.
export function dataImage(src) {
  const m = /^data:image\/(png|jpeg);base64,/i.exec(src);
  if (!m) return null;
  const bytes = base64Bytes(src.slice(m[0].length));
  const size = m[1].toLowerCase() === "png" ? pngSize(bytes) : jpegSize(bytes);
  return size ? { type: m[1].toLowerCase(), bytes, ...size } : null;
}

function pngSize(b) {
  // The signature, then the IHDR chunk: width and height, big-endian.
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[12] !== 0x49 || b[13] !== 0x48) return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    // Fill bytes may pad a marker.
    if (b[i + 1] === 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    const length = (b[i + 2] << 8) | b[i + 3];
    // A start-of-frame segment (C0–CF but for DHT, JPG and DAC) holds the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}
