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
 * rtf.js — the rendered document as Rich Text Format, for Pages, Word,
 * TextEdit, LibreOffice and the rest.
 *
 * Only the RTF every one of them reads: paragraphs with their indents,
 * spacing and borders, bold, italic, struck and monospaced text, hyperlink
 * fields, simple tables, and PNG and JPEG pictures (an image embedded in
 * the document as a data: URL; any other image becomes its alt text). Lists
 * are drawn with their bullets and numbers as text on a hanging indent,
 * which they all show the same way, rather than as RTF's list tables, which
 * they do not. Math is its TeX; a diagram its source.
 *
 * Everything outside ASCII is written as \uN, so the file is plain ASCII
 * whatever the text. The look is a plain document's, not the app's theme.
 * Input is the renderer's HTML as a tree (see tree.js).
 */

import { ELEMENT, SKIPPED, TEXT, dataImage, elements, hasClass, mathOf, runs, tableRows } from "./tree.js";

// Twips: 1/1440 inch. Lists and quotes indent by a quarter inch; the text
// is assumed 6.25 inches wide — A4 or Letter with one-inch margins.
const STEP = 360;
const WIDTH = 9000;
const PX = 15; // twips in a CSS pixel

// Colours, by their index in the colour table (1-based).
const COLOURS = [
  [31, 31, 36], //   1 text
  [5, 99, 193], //   2 links
  [87, 87, 95], //   3 quotes, notes
  [243, 243, 245], //4 code background
  [200, 200, 208], //5 rules and borders
  [255, 236, 153], //6 highlighted (<mark>)
];
const TEXT_COLOUR = 1;
const LINK = 2;
const SUBTLE = 3;
const CODE_BG = 4;
const BORDER = 5;
const MARK = 6;

const HEADING_SIZE = [0, 40, 32, 28, 24, 22, 22]; // half-points, by level
const BODY = 22; // 11 pt
const CODE = 19;

export function toRtf(root, { title = "" } = {}) {
  const head =
    "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n" +
    "{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica{\\*\\falt Arial};}{\\f1\\fmodern\\fcharset0 Menlo{\\*\\falt Courier New};}}\n" +
    `{\\colortbl;${COLOURS.map(([r, g, b]) => `\\red${r}\\green${g}\\blue${b};`).join("")}}\n` +
    (title ? `{\\info{\\title ${escape(title)}}}\n` : "");
  return `${head}${blocks(root.childNodes, { left: 0 })}}\n`;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

// ctx: { left (twips), quote, tight, marker: { text, used } }
function blocks(nodes, ctx) {
  let out = "";
  for (const run of runs(nodes)) {
    if (run.block) out += block(run.block, ctx);
    else if (!isBlank(run.inline)) out += paragraph(run.inline, ctx);
  }
  return out;
}

const isBlank = (nodes) => nodes.every((n) => n.nodeType === TEXT && !/\S/.test(n.data));

function block(el, ctx) {
  const name = el.localName;
  const math = mathOf(el);
  if (math) return open(ctx, "\\qc") + `\\f1\\fs${CODE} ${escape(math.tex)}\\par\n`;
  if (/^h[1-6]$/.test(name)) return heading(el, Number(name[1]), ctx);
  if (name === "section" && hasClass(el, "footnotes")) return footnotes(el, ctx);
  switch (name) {
    case "p":
    case "dt":
    case "summary":
    case "figcaption":
      return paragraph(el.childNodes, ctx, name === "dt" ? "\\b " : "");
    case "ul":
    case "ol":
      return list(el, ctx);
    case "blockquote":
      return blocks(el.childNodes, { ...ctx, left: ctx.left + STEP, quote: true, marker: null });
    case "dd":
      return blocks(el.childNodes, { ...ctx, left: ctx.left + STEP * 2, marker: null });
    case "pre":
      return code(el.textContent.replace(/\n$/, ""), ctx);
    case "hr":
      return rule(ctx);
    case "table":
      return table(el, ctx);
    default:
      return blocks(el.childNodes, ctx);
  }
}

// The start of a paragraph: its indent, spacing and border, in the
// default font — and, for a list item's first paragraph, its marker.
function open(ctx, props = "") {
  const after = ctx.tight ? 60 : 160;
  let s = `\\pard\\plain\\sa${after}\\sl276\\slmult1${props}`;
  if (ctx.quote) s += `\\brdrl\\brdrs\\brdrw24\\brsp160\\brdrcf${BORDER}`;
  const colour = ctx.quote ? SUBTLE : TEXT_COLOUR;
  if (ctx.marker && !ctx.marker.used) {
    ctx.marker.used = true;
    return `${s}\\li${ctx.left}\\fi-${STEP}\\tx${ctx.left}\\f0\\fs${BODY}\\cf${colour} ${escape(ctx.marker.text)}\\tab `;
  }
  return `${s}${ctx.left ? `\\li${ctx.left}` : ""}\\f0\\fs${BODY}\\cf${colour} `;
}

function paragraph(nodes, ctx, format = "") {
  return `${open(ctx)}${format}${inline(nodes)}\\par\n`;
}

function heading(el, level, ctx) {
  const before = level <= 2 ? 360 : 240;
  const props = `\\sb${before}\\keepn\\outlinelevel${level - 1}`;
  const colour = level === 6 ? `\\cf${SUBTLE}` : "";
  return `${open(ctx, props)}\\b\\fs${HEADING_SIZE[level]}${colour} ${inline(el.childNodes)}\\par\n`;
}

function code(text, ctx) {
  const props = `\\ri240\\cbpat${CODE_BG}`;
  return `${open({ ...ctx, tight: false }, props)}\\f1\\fs${CODE} ${escape(text, { keepSpaces: true })}\\par\n`;
}

function rule(ctx) {
  return `\\pard\\plain\\sb120\\sa240${ctx.left ? `\\li${ctx.left}` : ""}\\brdrb\\brdrs\\brdrw10\\brsp20\\brdrcf${BORDER}\\fs8\\par\n`;
}

function list(el, ctx) {
  const ordered = el.localName === "ol";
  let n = ordered ? Number.parseInt(el.getAttribute("start") ?? "1", 10) : 0;
  if (Number.isNaN(n)) n = 1;
  const items = elements(el).filter((c) => c.localName === "li");
  const tight = !items.some((li) => elements(li).some((c) => c.localName === "p"));
  let out = "";
  for (const li of items) {
    const marker = { text: ordered ? `${n++}.` : "\u2022", used: false };
    const inner = { ...ctx, left: ctx.left + STEP, tight, marker };
    // The marker goes on the item's first paragraph \u2014 or on a line of its
    // own, if the item is empty or starts with a list, a quote, a table.
    const first = [...runs(li.childNodes)].find((run) => run.block || !isBlank(run.inline));
    const carried = first && (first.inline || TAKES_MARKER.has(first.block.localName) || mathOf(first.block));
    if (!carried) out += `${open(inner)}\\par\n`;
    out += blocks(li.childNodes, inner);
  }
  return out;
}

// The blocks whose first line can carry a list item's marker.
const TAKES_MARKER = new Set(["p", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "summary", "figcaption"]);

function table(el, ctx) {
  const rows = tableRows(el);
  const columns = Math.max(0, ...rows.map((row) => row.cells.length));
  if (!columns) return "";
  const width = Math.floor((WIDTH - ctx.left) / columns);
  const edge = (side) => `\\clbrdr${side}\\brdrs\\brdrw10\\brdrcf${BORDER}`;
  let out = "";
  for (const row of rows) {
    out += `\\trowd\\trgaph100\\trleft${ctx.left}${row.head ? "\\trhdr" : ""}`;
    for (let i = 0; i < columns; i++) {
      out += edge("t") + edge("l") + edge("b") + edge("r") + (row.head ? `\\clcbpat${CODE_BG}` : "") + `\\cellx${ctx.left + width * (i + 1)}`;
    }
    out += "\n";
    for (let i = 0; i < columns; i++) {
      const cell = row.cells[i];
      const align = { center: "\\qc", right: "\\qr" }[cell?.align] ?? "\\ql";
      out += `\\pard\\plain\\intbl${align}\\f0\\fs${BODY}\\cf${TEXT_COLOUR} ${row.head ? "\\b " : ""}${cell ? inline(cell.node.childNodes) : ""}\\cell\n`;
    }
    out += "\\row\n";
  }
  // A paragraph after the table ends it, and spaces what follows.
  return out + "\\pard\\plain\\sa0\\fs12\\par\n";
}

// The footnotes section: a rule, then the notes, numbered.
function footnotes(section, ctx) {
  const ol = elements(section).find((c) => c.localName === "ol");
  if (!ol) return blocks(section.childNodes, ctx);
  let out = rule(ctx);
  elements(ol)
    .filter((c) => c.localName === "li")
    .forEach((li, i) => {
      const marker = { text: `${i + 1}.`, used: false };
      out += blocks(li.childNodes, { ...ctx, left: ctx.left + STEP, tight: true, quote: false, marker });
    });
  return out;
}

// ── Inline ───────────────────────────────────────────────────────────────────

// Text runs are collapsed as a browser collapses them; `state.space` says
// whether the output just ended in a space, so none is doubled across
// elements, and none starts a paragraph.
function inline(nodes) {
  const state = { space: true };
  let out = "";
  for (const node of nodes) out += inlineNode(node, state);
  return out;
}

const GROUPS = {
  em: "\\i",
  i: "\\i",
  cite: "\\i",
  var: "\\i",
  dfn: "\\i",
  strong: "\\b",
  b: "\\b",
  del: "\\strike",
  s: "\\strike",
  strike: "\\strike",
  u: "\\ul",
  ins: "\\ul",
  code: `\\f1\\fs${CODE}`,
  kbd: `\\f1\\fs${CODE}`,
  samp: `\\f1\\fs${CODE}`,
  tt: `\\f1\\fs${CODE}`,
  sup: "\\super",
  sub: "\\sub",
  mark: `\\highlight${MARK}`,
};

function inlineNode(node, state) {
  if (node.nodeType === TEXT) return text(node.data, state);
  if (node.nodeType !== ELEMENT || SKIPPED.has(node.localName)) return "";
  const name = node.localName;
  const math = mathOf(node);
  if (math) return `{\\f1\\fs${CODE} ${text(math.display ? `$$${math.tex}$$` : `$${math.tex}$`, state)}}`;
  if (name === "br") {
    state.space = true;
    return "\\line ";
  }
  if (name === "img") return image(node, state);
  if (name === "input") {
    if (node.getAttribute("type") !== "checkbox") return "";
    return text(node.getAttribute("checked") === null ? "\u2610" : "\u2611", state);
  }
  if (name === "a") return link(node, state);
  const inner = children(node, state);
  return GROUPS[name] ? `{${GROUPS[name]} ${inner}}` : inner;
}

function children(node, state) {
  let out = "";
  for (const child of node.childNodes) out += inlineNode(child, state);
  return out;
}

function text(s, state) {
  let out = "";
  for (const ch of s.replace(/[ \t\n\r\f]+/g, " ")) {
    if (ch === " ") {
      if (state.space) continue;
      state.space = true;
      out += " ";
    } else {
      state.space = false;
      out += escapeChar(ch);
    }
  }
  return out;
}

function link(a, state) {
  if (hasClass(a, "footnote-backref")) return "";
  const href = a.getAttribute("href") ?? "";
  const inner = children(a, state);
  // A link within the document has nowhere to go in RTF.
  if (!href || href.startsWith("#")) return inner;
  const target = escape(href).replace(/"/g, "%22");
  return `{\\field{\\*\\fldinst{HYPERLINK "${target}"}}{\\fldrslt{\\ul\\cf${LINK} ${inner}}}}`;
}

function image(img, state) {
  const alt = (img.getAttribute("alt") ?? "").trim();
  const picture = dataImage(img.getAttribute("src") ?? "");
  if (!picture || !picture.width || !picture.height) return text(alt ? `[Image: ${alt}]` : "[Image]", state);
  state.space = false;
  // At its CSS size, no wider than the page.
  const scale = Math.min(1, WIDTH / (picture.width * PX));
  const goalW = Math.round(picture.width * PX * scale);
  const goalH = Math.round(picture.height * PX * scale);
  const kind = picture.type === "png" ? "\\pngblip" : "\\jpegblip";
  return `{\\pict${kind}\\picw${picture.width}\\pich${picture.height}\\picwgoal${goalW}\\pichgoal${goalH}\n${hex(picture.bytes)}}`;
}

// ── Escaping ─────────────────────────────────────────────────────────────────

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function hex(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 64) {
    let line = "";
    for (let j = i; j < Math.min(i + 64, bytes.length); j++) line += HEX[bytes[j]];
    lines.push(line);
  }
  return lines.join("\n");
}

// Text for RTF: its specials escaped, the rest of Unicode as \uN (UTF-16
// code units, signed, each with a ? for readers that cannot show it).
// `keepSpaces` (code) keeps spaces and turns line breaks into \line.
export function escape(s, { keepSpaces = false } = {}) {
  let out = "";
  for (const ch of s) {
    if (ch === "\n") out += keepSpaces ? "\\line " : " ";
    else if (ch === "\t") out += keepSpaces ? "\\tab " : " ";
    else out += escapeChar(ch);
  }
  return out;
}

function escapeChar(ch) {
  if (ch === "\\" || ch === "{" || ch === "}") return "\\" + ch;
  const c = ch.codePointAt(0);
  if (c < 0x20) return "";
  if (c < 0x80) return ch;
  let units = "";
  for (let i = 0; i < ch.length; i++) {
    const u = ch.charCodeAt(i);
    units += `\\u${u > 0x7fff ? u - 0x10000 : u}?`;
  }
  return units;
}
