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
 * text.js — the rendered document as plain text, laid out to be read.
 *
 *   Title          headings: the first two levels underlined, as in a
 *   =====          README; the rest as they are
 *
 *   • item         lists, bulleted or numbered, nested by indenting
 *   > quoted       block quotes
 *       code       code, indented four spaces
 *   * * *          a thematic break
 *   a  b           tables, in aligned columns under a rule
 *   text (url)     links, with the address when it is not the text
 *   [Image: alt]   images
 *   $x^2$          math, as its TeX
 *   [1]            footnotes, listed at the end
 *
 * Input is the renderer's HTML as a tree (see tree.js); whitespace is
 * collapsed as a browser collapses it, except in code.
 */

import { ELEMENT, SKIPPED, TEXT, elements, hasClass, linkIsItsText, mathOf, runs, tableRows } from "./tree.js";

const RULE = "* * *";
// A <br>, kept apart from the whitespace that is collapsed around it.
const BREAK = "";
const length = (s) => [...s].length;

export function toText(root) {
  const text = blocks(root.childNodes).join("\n\n");
  return text ? text.replace(/[ \t]+$/gm, "") + "\n" : "";
}

// Each block of `nodes`, as text; none of them empty.
function blocks(nodes) {
  const out = [];
  for (const run of runs(nodes)) {
    const text = run.block ? block(run.block) : inline(run.inline);
    if (text) out.push(text);
  }
  return out;
}

function block(el) {
  const name = el.localName;
  const math = mathOf(el);
  if (math) return `$$\n${math.tex}\n$$`;
  if (/^h[1-6]$/.test(name)) return heading(el, Number(name[1]));
  if (name === "section" && hasClass(el, "footnotes")) return footnotes(el);
  switch (name) {
    case "p":
    case "dt":
    case "summary":
    case "figcaption":
      return inline(el.childNodes);
    case "ul":
    case "ol":
      return list(el);
    case "blockquote":
      return quote(blocks(el.childNodes).join("\n\n"));
    case "pre":
      return indent(el.textContent.replace(/\n$/, ""), "    ");
    case "dd":
      return indent(blocks(el.childNodes).join("\n\n"), "    ");
    case "hr":
      return RULE;
    case "table":
      return table(el);
    default:
      return blocks(el.childNodes).join("\n\n");
  }
}

function heading(el, level) {
  const text = inline(el.childNodes);
  if (!text || level > 2) return text;
  const width = Math.max(...text.split("\n").map(length));
  return `${text}\n${(level === 1 ? "=" : "-").repeat(width)}`;
}

// ── Inline ───────────────────────────────────────────────────────────────────

function inline(nodes) {
  let s = "";
  for (const node of nodes) s += inlineNode(node);
  return s
    .replace(/[ \t\n\r\f]+/g, " ")
    .replace(new RegExp(` ?${BREAK} ?`, "g"), "\n")
    .trim();
}

function inlineNode(node) {
  if (node.nodeType === TEXT) return node.data;
  if (node.nodeType !== ELEMENT || SKIPPED.has(node.localName)) return "";
  const math = mathOf(node);
  if (math) return math.display ? `$$${math.tex}$$` : `$${math.tex}$`;
  switch (node.localName) {
    case "br":
      return BREAK;
    case "img": {
      const alt = (node.getAttribute("alt") ?? "").trim();
      return alt ? `[Image: ${alt}]` : "[Image]";
    }
    case "input":
      if (node.getAttribute("type") !== "checkbox") return "";
      return node.getAttribute("checked") === null ? "[ ]" : "[x]";
    case "sup":
      if (hasClass(node, "footnote-ref")) return `[${node.textContent.trim()}]`;
      break;
    case "a":
      return link(node);
  }
  let s = "";
  for (const child of node.childNodes) s += inlineNode(child);
  return s;
}

function link(a) {
  if (hasClass(a, "footnote-backref")) return "";
  let s = "";
  for (const child of a.childNodes) s += inlineNode(child);
  const href = a.getAttribute("href") ?? "";
  // Links within the document, and links whose text is their address,
  // read as their text.
  if (!href || href.startsWith("#")) return s;
  const text = s.replace(/\s+/g, " ").trim();
  if (!text) return href;
  return linkIsItsText(text, href) ? s : `${s} (${href.replace(/^mailto:/i, "")})`;
}

// ── Lists, quotes, tables, notes ─────────────────────────────────────────────

function list(el) {
  const ordered = el.localName === "ol";
  let n = ordered ? Number.parseInt(el.getAttribute("start") ?? "1", 10) : 0;
  if (Number.isNaN(n)) n = 1;
  const items = elements(el).filter((c) => c.localName === "li");
  // A loose list (its items' text in paragraphs) keeps a blank line between
  // items, as the preview spaces them.
  const loose = items.some((li) => elements(li).some((c) => c.localName === "p"));
  const gap = loose ? "\n\n" : "\n";
  return items.map((li) => item(ordered ? `${n++}.` : "•", blocks(li.childNodes).join(gap))).join(gap);
}

// `body` after `marker`, its later lines under its first.
function item(marker, body) {
  const pad = " ".repeat(length(marker) + 1);
  const lines = body.split("\n");
  return [`${marker} ${lines[0]}`, ...lines.slice(1).map((line) => (line ? pad + line : line))].join("\n");
}

function quote(text) {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function indent(text, pad) {
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function table(el) {
  const rows = tableRows(el).map((row) => ({
    head: row.head,
    cells: row.cells.map((cell) => ({ text: inline(cell.node.childNodes).replace(/\n/g, " "), align: cell.align })),
  }));
  const columns = Math.max(0, ...rows.map((row) => row.cells.length));
  if (!columns) return "";
  const widths = Array.from({ length: columns }, (_, i) => Math.max(1, ...rows.map((row) => length(row.cells[i]?.text ?? ""))));
  const line = (row) =>
    widths
      .map((width, i) => {
        const { text = "", align = "" } = row.cells[i] ?? {};
        const room = width - length(text);
        if (align === "right") return " ".repeat(room) + text;
        if (align === "center") return " ".repeat(room >> 1) + text + " ".repeat(room - (room >> 1));
        return text + " ".repeat(room);
      })
      .join("  ");
  const out = [];
  rows.forEach((row, i) => {
    out.push(line(row));
    // The rule under the head.
    if (row.head && !rows[i + 1]?.head) out.push(widths.map((w) => "-".repeat(w)).join("  "));
  });
  return out.join("\n");
}

// The footnotes section: a rule, then each note under its number.
function footnotes(section) {
  const ol = elements(section).find((c) => c.localName === "ol");
  if (!ol) return blocks(section.childNodes).join("\n\n");
  const notes = elements(ol)
    .filter((c) => c.localName === "li")
    .map((li, i) => item(`[${i + 1}]`, blocks(li.childNodes).join("\n\n")));
  return [RULE, ...notes].join("\n\n");
}
