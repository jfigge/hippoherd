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
 * Mermaid diagrams: a fenced block whose language is mermaid.
 *
 *   ```mermaid
 *   flowchart LR
 *     Write --> Preview
 *   ```
 *
 * The renderer writes the diagram's source as a code block marked
 * mh-mermaid — what shows if nothing else happens (in exported HTML, say).
 * In the app, the enhancer turns each into an SVG with Mermaid (vendored,
 * src/vendor/mermaid/, loaded the first time a document has a diagram,
 * and only the parts for the kinds of diagram it has). Mermaid runs at its
 * strict security level: no scripts or click handlers in diagrams, labels
 * as text.
 *
 * Diagrams are cached by source and theme, so re-rendering the preview as
 * you type redraws only the diagram being edited. Exports draw them in the
 * light theme whatever the page's mode.
 */

import { tokenizer, words } from "../code/tokenizer.js";

function renderFence(node, r) {
  r.cr();
  r.tag("pre", [...r.attrs(node), ["class", "mh-mermaid"]]);
  r.tag("code", [["class", "language-mermaid"]]);
  r.out(node.literal);
  r.tag("/code");
  r.tag("/pre");
  r.cr();
}

// ── The enhancer: source → SVG ───────────────────────────────────────────────

let mermaid = null;
let configured = null;
let counter = 0;
const cache = new Map();
// Drawing goes one call at a time: Mermaid has a single configuration, and
// the theme is part of it, so a light drawing (an export) and a dark one
// (the preview) must not interleave.
let drawing = Promise.resolve();

const keyOf = (theme, el) => theme + "\u0000" + el.textContent;

// Diagrams already drawn go in at once, so a re-render while typing does
// not flicker; the rest are drawn after any drawing already under way.
function enhance(elements, context = {}) {
  const theme = context.dark ? "dark" : "default";
  const pending = [];
  for (const el of elements) {
    const svg = cache.get(keyOf(theme, el));
    if (svg === undefined) pending.push(el);
    else place(el, svg);
  }
  if (!pending.length) return undefined;
  const run = drawing.then(() => draw(pending, theme));
  drawing = run.catch(() => {});
  return run;
}

async function draw(elements, theme) {
  if (!mermaid) mermaid = (await import("../../../vendor/mermaid/mermaid.esm.min.mjs")).default;
  for (const el of elements) {
    // Drawing is slow: not for a preview that has been redrawn since.
    if (!el.isConnected) continue;
    const key = keyOf(theme, el);
    let svg = cache.get(key);
    if (svg === undefined) {
      if (configured !== theme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, fontFamily: "inherit" });
        configured = theme;
      }
      const id = `mh-mermaid-${++counter}`;
      try {
        svg = (await mermaid.render(id, el.textContent)).svg;
      } catch (err) {
        svg = { error: String(err?.message ?? err).slice(0, 400) };
      }
      // Mermaid draws in a scratch element of its own, which it can leave
      // behind when a diagram fails.
      el.ownerDocument.getElementById(`d${id}`)?.remove();
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      cache.set(key, svg);
    }
    place(el, svg);
  }
}

// The diagram in place of its source; or, if it could not be drawn, why
// not, above the source.
function place(el, svg) {
  if (!el.isConnected) return;
  const doc = el.ownerDocument;
  const figure = doc.createElement("figure");
  figure.className = "mh-diagram";
  // The block's own attributes (its source line, which synced scroll
  // steers by, whatever the renderer named it).
  for (const attr of el.attributes) if (attr.name !== "class") figure.setAttribute(attr.name, attr.value);
  if (typeof svg === "string") {
    figure.innerHTML = svg;
    figure.title = "Mermaid diagram";
  } else {
    const note = doc.createElement("pre");
    note.className = "mh-diagram-error";
    note.textContent = `This diagram could not be drawn.\n${svg.error}`;
    figure.append(note, el.cloneNode(true));
  }
  el.replaceWith(figure);
}

// ── Colouring the source ─────────────────────────────────────────────────────

const KEYWORDS = words(
  "graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie journey gitGraph mindmap timeline quadrantChart requirementDiagram C4Context sankey-beta xychart-beta block-beta packet-beta architecture-beta kanban " +
    "subgraph end direction participant actor note over loop alt else opt par and critical break rect activate deactivate autonumber " +
    "class state section title dateFormat axisFormat excludes includes todayMarker commit branch checkout merge cherry-pick style classDef linkStyle click",
);

const language = {
  id: "mermaid",
  name: "Mermaid",
  aliases: ["mmd"],
  tokenize: tokenizer([
    [/\s+/, null],
    [/%%.*/, "comment"],
    [/"[^"\n]*"?/, "string"],
    [/(?:<?[-=.ox]{2,}>?|<-->|==>|-\.->|--[ox>]|\|[^|\n]*\|)/, "meta"],
    [/\b(?:TB|TD|BT|RL|LR)\b/, "literal"],
    [/[A-Za-z][\w-]*/, (text) => (KEYWORDS.has(text) ? "keyword" : null)],
    [/[0-9]+(?:\.[0-9]+)?/, "number"],
  ]),
};

export default {
  id: "mermaid",
  name: "Mermaid",
  version: "1.0.0",
  description: "Diagrams from text: flowcharts, sequence, class, state, gantt, pie and more, in ```mermaid blocks (with Mermaid).",
  setup(api) {
    api.fenceRenderer("mermaid", renderFence);
    api.enhancer({ selector: "pre.mh-mermaid", run: enhance });
    api.language(language);
    api.completions({ context: "fence-info", provide: () => [{ label: "mermaid", detail: "Mermaid diagram", keywords: ["diagram", "flowchart", "chart"] }] });
    api.completions({
      context: "block",
      provide: () => [
        {
          label: "Diagram",
          detail: "Mermaid",
          keywords: ["mermaid", "flowchart", "chart", "graph"],
          hint: "```mermaid",
          insert: "```mermaid\nflowchart LR\n  ${A} --> B\n```",
        },
      ],
    });
  },
};
