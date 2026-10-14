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
 * Footnotes, as GitHub and cmark-gfm write them.
 *
 *   Some text.[^note]
 *
 *   [^note]: The footnote. Later lines indented four
 *       spaces belong to it, blank lines and all.
 *
 * A definition is a container block; a reference is [^label] where such a
 * definition exists (anything else stays text). Footnotes are numbered by
 * first reference and listed at the end, each with links back to every
 * place it was referenced; unreferenced ones are left out.
 *
 * Definitions are global, like link reference definitions: they are kept
 * in the same reference map, under keys a link label can never produce
 * (NUL is never in the parsed text), and incremental reparse treats their
 * blocks as definitions (`definition: true`).
 */

import { Node } from "../../parser/nodes.js";
import { normalizeLabel, normalizeURI } from "../../parser/normalize.js";

const reDefinition = /^\[\^([^\]\s]+)\]:/;
const reReference = /\[\^([^\]\s]+)\]/y;
const CODE_INDENT = 4;

// A label compared as link labels are (case and spacing aside).
const norm = (label) => normalizeLabel(`[${label}]`);
export const key = (label) => "\u0000fn:" + norm(label);

function definitionStart(parser) {
  if (parser.indented) return 0;
  const m = parser.currentLine.slice(parser.nextNonspace).match(reDefinition);
  if (!m) return 0;
  parser.closeUnmatchedBlocks();
  const block = parser.addChild("footnote_definition", parser.nextNonspace);
  block.label = m[1];
  if (!parser.refmap[key(m[1])]) parser.refmap[key(m[1])] = { footnote: true, label: m[1] };
  parser.advanceNextNonspace();
  parser.advanceOffset(m[0].length, false);
  // The text after the marker starts the footnote, whatever its indent.
  parser.findNextNonspace();
  parser.advanceNextNonspace();
  return 1;
}

const definition = {
  type: "footnote_definition",
  definition: true,
  starts: [{ start: definitionStart, priority: 850, triggers: "[" }],
  continue(parser) {
    if (parser.blank) return 0;
    if (parser.indent >= CODE_INDENT) {
      parser.advanceOffset(CODE_INDENT, true);
      return 0;
    }
    return 1;
  },
  finalize() {},
  canContain: (type, parser) => !parser.rule(type).onlyInside,
  acceptsLines: false,
};

const reference = {
  name: "footnote_reference",
  triggers: "[",
  priority: 10,
  parse(state) {
    if (state.peek(state.pos + 1) !== "^") return false;
    reReference.lastIndex = state.pos;
    const m = reReference.exec(state.subject);
    if (!m) return false;
    const def = state.refmap?.[key(m[1])];
    if (!def) return false;
    const start = state.pos;
    state.pos = reReference.lastIndex;
    state.add(new Node("footnote_reference", { label: def.label }), start, state.pos);
    return true;
  },
};

// "![^1]" is a "!" and a footnote, not an image: claim the "!" before the
// image rule does.
const bang = {
  name: "footnote_bang",
  triggers: "!",
  priority: 10,
  parse(state) {
    if (state.peek(state.pos + 1) !== "[" || state.peek(state.pos + 2) !== "^") return false;
    reReference.lastIndex = state.pos + 1;
    const m = reReference.exec(state.subject);
    if (!m || !state.refmap?.[key(m[1])]) return false;
    state.text("!", state.pos, state.pos + 1);
    state.pos += 1;
    return true;
  },
};

// ── HTML ─────────────────────────────────────────────────────────────────────

const id = (label) => normalizeURI(label);

// Number the footnotes by first reference, and count every reference.
function collect(ast) {
  const order = new Map();
  const visit = (node) => {
    if (node.type === "footnote_reference") {
      const k = norm(node.label);
      if (!order.has(k)) order.set(k, { n: order.size + 1, label: node.label, refs: 0 });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast);
  const definitions = new Map();
  const defs = (node) => {
    if (node.type === "footnote_definition") {
      const k = norm(node.label);
      if (!definitions.has(k)) definitions.set(k, node);
    }
    for (const child of node.children ?? []) defs(child);
  };
  defs(ast);
  return { order, definitions };
}

function renderDocument(node, r) {
  r.footnotes = collect(node);
  r.children(node);
  const { order, definitions } = r.footnotes;
  if (!order.size) return;
  r.cr();
  r.lit('<section class="footnotes" data-footnotes>\n<ol>\n');
  for (const [k, note] of order) {
    const def = definitions.get(k);
    if (!def) continue;
    const fn = r.esc(id(def.label));
    r.lit(`<li id="fn-${fn}">\n`);
    r.lastOut = "\n";
    r.renderingFootnote = true;
    r.children(def);
    r.renderingFootnote = false;
    const backrefs = [];
    for (let i = 1; i <= note.refs; i++) {
      const suffix = i === 1 ? "" : `-${i}`;
      const idx = i === 1 ? `${note.n}` : `${note.n}-${i}`;
      const sup = i === 1 ? "" : `<sup class="footnote-ref">${i}</sup>`;
      backrefs.push(
        `<a href="#fnref-${fn}${suffix}" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="${idx}" aria-label="Back to reference ${idx}">↩${sup}</a>`,
      );
    }
    const links = backrefs.join(" ");
    const last = def.children?.[def.children.length - 1];
    if (last?.type === "paragraph" && r.buffer.endsWith("</p>\n")) {
      r.buffer = r.buffer.slice(0, -5) + " " + links + "</p>\n";
    } else {
      r.cr();
      r.lit(links + "\n");
    }
    r.lit("</li>\n");
  }
  r.lit("</ol>\n</section>\n");
}

function renderReference(node, r) {
  const note = r.footnotes?.order.get(norm(node.label));
  if (!note) {
    r.out(`[^${node.label}]`);
    return;
  }
  note.refs += 1;
  const fn = r.esc(id(note.label));
  const suffix = note.refs === 1 ? "" : `-${note.refs}`;
  r.lit(`<sup class="footnote-ref"><a href="#fn-${fn}" id="fnref-${fn}${suffix}" data-footnote-ref>${note.n}</a></sup>`);
}

export default {
  id: "footnotes",
  name: "Footnotes",
  version: "1.0.0",
  description: "Footnotes, as on GitHub: [^1] in the text, [^1]: the note anywhere, listed and linked at the end.",
  setup(api) {
    api.blockRule(definition);
    api.inlineRule(reference);
    api.inlineRule(bang);
    api.renderer("document", renderDocument);
    // Rendered once, at the end, from the document's renderer.
    api.renderer("footnote_definition", (node, r) => {
      if (r.renderingFootnote) r.children(node);
    });
    api.renderer("footnote_reference", renderReference);
    api.highlighter("footnote_reference", (node, h) => h.mark(node.pos.start.offset, node.pos.end.offset, "md-footnote"));
    api.highlighter("footnote_definition", (node, h) => {
      const src = h.source;
      const end = src.indexOf("]:", node.pos.start.offset);
      if (end !== -1 && end < node.pos.end.offset) h.mark(node.pos.start.offset, end + 2, "md-footnote");
      h.children(node);
    });
    api.completions({
      context: "inline",
      provide: () => [{ label: "Footnote", keywords: ["note", "reference", "[^"], hint: "[^1]", insert: "[^${1}]" }],
    });
    api.completions({
      context: "block",
      provide: () => [
        { label: "Footnote definition", keywords: ["note", "[^"], hint: "[^1]: ", insert: "[^${1}]: ${The note.}" },
      ],
    });
  },
};
