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
 * Math, as GitHub writes it: LaTeX between dollar signs.
 *
 *   inline $e^{i\pi} + 1 = 0$, or display $$\sum_{k=1}^n k$$ in a line
 *
 *   $$                       a display block: $$ on lines of their own
 *   \int_0^1 x^2\,dx
 *   $$
 *
 *   ```math                  or a fenced block whose language is math
 *   ...
 *   ```
 *
 * An inline $ must hug its content ($5 and $6 is money, not math): no
 * space just inside either dollar, and no digit right after the closing
 * one. \$ is a dollar sign.
 *
 * The parser and renderer only mark math up — <span class="math …"> and
 * <div class="math …"> holding the TeX as text, which is what shows if
 * nothing else happens. In the app, the enhancer below turns each into
 * MathML with Temml (vendored, src/vendor/temml/, loaded the first time a
 * document has math); MathML is drawn by the browser itself, so the page
 * needs no script or style of Temml's beyond one stylesheet.
 */

import { Node } from "../../parser/nodes.js";

// ── Inline $…$ and $$…$$ ─────────────────────────────────────────────────────

const inlineMath = {
  name: "math_inline",
  triggers: "$",
  parse(state) {
    const start = state.pos;
    const subject = state.subject;
    let n = 0;
    while (subject[start + n] === "$") n++;
    if (n > 2) return false;
    const open = start + n;
    const close = findClose(subject, open, n);
    if (close === -1) return false;
    const literal = subject.slice(open, close);
    if (n === 1 && (/^\s/.test(literal) || /\s$/.test(literal) || /[0-9]/.test(subject[close + 1] ?? ""))) return false;
    if (!literal.trim()) return false;
    state.pos = close + n;
    state.add(new Node("math_inline", { literal: literal.replace(/\n/g, " "), display: n === 2 }), start, state.pos);
    return true;
  },
};

// The next run of exactly `n` unescaped dollars after `from`, or -1.
function findClose(subject, from, n) {
  for (let i = from; i < subject.length; i++) {
    const c = subject[i];
    if (c === "\\") {
      i++;
    } else if (c === "$") {
      let run = 0;
      while (subject[i + run] === "$") run++;
      if (run === n) return i;
      i += run - 1;
    }
  }
  return -1;
}

// ── $$ blocks ────────────────────────────────────────────────────────────────

const reOpen = /^\$\$[ \t]*$/;
const reClose = /^[ \t]{0,3}\$\$[ \t]*$/;

function blockStart(parser) {
  if (parser.indented || !reOpen.test(parser.currentLine.slice(parser.nextNonspace))) return 0;
  parser.closeUnmatchedBlocks();
  const block = parser.addChild("math_block", parser.nextNonspace);
  block.literal = "";
  block.closed = false;
  block._lines = [];
  parser.advanceOffset(parser.currentLine.length - parser.offset, false);
  return 2;
}

const mathBlock = {
  type: "math_block",
  starts: [{ start: blockStart, priority: 610, triggers: "$" }],
  continue(parser, block) {
    if (reClose.test(parser.currentLine.slice(parser.offset))) {
      block.closed = true;
      parser.lastLineLength = parser.currentLine.length;
      parser.finalize(block, parser.lineNumber);
      return 2;
    }
    return 0;
  },
  finalize(parser, block) {
    // The lines between the $$s (the first added line is the opener's).
    const lines = block._content.split("\n").slice(1, -1);
    block.literal = lines.join("\n");
  },
  canContain: () => false,
  acceptsLines: true,
};

// ── HTML ─────────────────────────────────────────────────────────────────────

function renderInline(node, r) {
  r.lit(`<span class="math ${node.display ? "math-display" : "math-inline"}">`);
  r.out(node.literal);
  r.lit("</span>");
}

function renderBlock(node, r) {
  r.cr();
  r.tag("div", [...r.attrs(node), ["class", "math math-display"]]);
  r.out(node.literal);
  r.tag("/div");
  r.cr();
}

// ```math fences are display math too.
function renderFence(node, r) {
  renderBlock({ ...node, literal: node.literal.replace(/\n$/, "") }, r);
}

// ── The enhancer: TeX → MathML ───────────────────────────────────────────────

let temml = null;
const cache = new Map();

async function enhance(elements) {
  const doc = elements[0].ownerDocument;
  if (!temml) {
    const css = doc.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("../../../vendor/temml/Temml-Local.css", import.meta.url).href;
    doc.head.append(css);
    temml = (await import("../../../vendor/temml/temml.mjs")).default;
  }
  for (const el of elements) {
    const tex = el.textContent;
    const display = el.classList.contains("math-display");
    const key = (display ? "D" : "I") + tex;
    let html = cache.get(key);
    if (html === undefined) {
      try {
        html = temml.renderToString(tex, { displayMode: display, throwOnError: false, trust: false });
      } catch {
        html = null;
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(key, html);
    }
    if (html) {
      el.innerHTML = html;
      el.title = tex;
    }
  }
}

// ── Edit pane ────────────────────────────────────────────────────────────────

function highlightInline(node, h) {
  const from = node.pos.start.offset;
  const to = node.pos.end.offset;
  const n = node.display ? 2 : 1;
  h.mark(from, to, "md-math");
  h.mark(from, from + n, "md-marker");
  h.mark(to - n, to, "md-marker");
}

function highlightBlock(node, h) {
  h.mark(node.pos.start.offset, node.pos.end.offset, "md-math");
  h.mark(node.pos.start.offset, h.lineEnd(node.pos.start.line), "md-marker");
  if (node.closed) h.mark(h.lineStart(node.pos.end.line), node.pos.end.offset, "md-marker");
}

export default {
  id: "math",
  name: "Math",
  version: "1.0.0",
  description: "LaTeX math as on GitHub: $inline$, $$display$$ and ```math blocks, drawn as MathML (with Temml).",
  setup(api) {
    api.inlineRule(inlineMath);
    api.blockRule(mathBlock);
    api.renderer("math_inline", renderInline);
    api.renderer("math_block", renderBlock);
    api.fenceRenderer("math", renderFence);
    api.enhancer({ selector: ".math", run: enhance });
    api.highlighter("math_inline", highlightInline);
    api.highlighter("math_block", highlightBlock);
    api.completions({
      context: "inline",
      provide: () => [{ label: "Math", detail: "LaTeX", keywords: ["latex", "equation", "formula", "$"], hint: "$x^2$", insert: "$$${x^2}$$" }],
    });
    api.completions({
      context: "block",
      provide: () => [
        { label: "Math block", detail: "LaTeX", keywords: ["latex", "equation", "display", "$$"], hint: "$$", insert: "$$$$\n${x^2}\n$$$$" },
      ],
    });
    api.completions({ context: "fence-info", provide: () => [{ label: "math", detail: "LaTeX math" }] });
  },
};
