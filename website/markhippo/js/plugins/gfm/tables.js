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
 * The tables plugin (GFM): parsing in tables-parse.js; here, the HTML
 * (as cmark-gfm writes it), the edit pane's colours and the suggestion.
 */

import { table, tableCell, tableRow } from "./tables-parse.js";

function renderTable(node, r) {
  const [head, ...body] = node.children ?? [];
  r.cr();
  r.tag("table", r.attrs(node));
  r.cr();
  r.tag("thead");
  r.cr();
  if (head) r.node(head);
  r.tag("/thead");
  r.cr();
  if (body.length) {
    r.tag("tbody");
    r.cr();
    for (const row of body) r.node(row);
    r.tag("/tbody");
    r.cr();
  }
  r.tag("/table");
  r.cr();
}

function renderRow(node, r) {
  r.tag("tr", r.attrs(node));
  r.cr();
  r.children(node);
  r.tag("/tr");
  r.cr();
}

function renderCell(node, r) {
  const name = node.header ? "th" : "td";
  r.tag(name, node.align ? [["align", node.align]] : []);
  r.children(node);
  r.tag("/" + name);
  r.cr();
}

// The pipes between cells, as markup; the delimiter row too.
function highlightTable(node, h) {
  const head = node.children?.[0];
  if (head) {
    const line = node.pos.start.line + 1;
    let at = h.lineStart(line) + head.pos.start.column - 1;
    const end = h.lineEnd(line);
    while (at < end && (h.source[at] === " " || h.source[at] === "\t" || h.source[at] === ">")) at++;
    h.mark(at, end, "md-marker");
  }
  h.children(node);
}

function highlightRow(node, h) {
  const src = h.source;
  for (let i = node.pos.start.offset; i < node.pos.end.offset; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "|") h.mark(i, i + 1, "md-marker");
  }
  h.children(node);
}

function highlightCell(node, h) {
  if (node.header) h.mark(node.pos.start.offset, node.pos.end.offset, "md-table-head");
  h.children(node);
}

export default {
  id: "tables",
  name: "Tables",
  version: "1.0.0",
  description: "GitHub's pipe tables, with column alignment from the delimiter row.",
  setup(api) {
    api.blockRule(table);
    api.blockRule(tableRow);
    api.blockRule(tableCell);
    api.renderer("table", renderTable);
    api.renderer("table_row", renderRow);
    api.renderer("table_cell", renderCell);
    api.highlighter("table", highlightTable);
    api.highlighter("table_row", highlightRow);
    api.highlighter("table_cell", highlightCell);
    api.completions({
      context: "block",
      provide: () => [
        {
          label: "Table",
          keywords: ["grid", "columns", "|"],
          hint: "| a | b |",
          insert: "| ${Column} | Column |\n| --- | --- |\n|  |  |",
        },
      ],
    });
  },
};
