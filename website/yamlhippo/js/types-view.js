/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of YamlHippo.
 *
 * YamlHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * YamlHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with YamlHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * types-view.js — the Types tab: a reference for every custom tag.
 *
 * The types (catalogue/infer-types.js) are listed down the left, each with
 * its chip in the tree's colour and its number of uses; the selected type's
 * reference is beside it: what it goes on, its fields (always or optional,
 * and their types), and any inconsistency, with links to the odd uses out.
 * "Show in tree" filters the tree to the type's nodes, which lights them up.
 *
 * The reference is worked out again only when the parse changes.
 */

import { escapeHtml, formatCount, plural } from "./util.js";

const PERCENT = (n, of) => (of === 0 ? "" : `${Math.round((n / of) * 100)}%`);

export class TypesView {
  /**
   * @param panel     the Types tab's <section>
   * @param callbacks {
   *   onShowTag(name)  — filter the tree to a tag
   *   onShowNode(node) — select a node in the tree
   *   onGoToError()    — show the parse error in the Text tab
   * }
   */
  constructor(panel, { onShowTag, onShowNode, onGoToError }) {
    this.panel = panel;
    this.onShowTag = onShowTag;
    this.onShowNode = onShowNode;
    this.onGoToError = onGoToError;
    this.list = panel.querySelector(".yh-types-list");
    this.detail = panel.querySelector(".yh-types-detail");
    this.body = panel.querySelector(".yh-types");
    this.message = panel.querySelector(".yh-types-message");

    this.source = null; // the documents the shown catalogue came from
    this.types = [];
    this.selected = null; // a type name
    this.oddNodes = [];

    panel.addEventListener("click", (e) => {
      const item = e.target.closest("[data-type-index]");
      if (item) {
        this.select(this.types[Number(item.dataset.typeIndex)].name);
        return;
      }
      const odd = e.target.closest("[data-odd]");
      if (odd) {
        this.onShowNode(this.oddNodes[Number(odd.dataset.odd)]);
        return;
      }
      const action = e.target.closest("[data-types]")?.dataset.types;
      if (action === "show" && this.selected) this.onShowTag(this.selected);
      else if (action === "go-to-error") this.onGoToError();
    });
    this.list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = this.types.findIndex((t) => t.name === this.selected);
      const next = this.types[Math.max(0, Math.min(this.types.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        this.select(next.name);
        this.list.querySelector('[aria-current="true"]')?.focus();
      }
    });
  }

  /** Show the catalogue for a parse. `types` is inferTypes()'s result for its documents. */
  show(documents, types) {
    if (this.source === documents) return;
    this.source = documents;
    this.types = types;
    this.showBody(true);
    if (types.length === 0) {
      this.list.innerHTML = "";
      this.detail.innerHTML =
        '<p class="yh-types-empty">No custom tags in this document. A custom tag — <code>!Person</code>, <code>!Ref</code> — names a type of your own; ' +
        "every node that carries one is listed here, with a reference worked out from all its uses.</p>";
      this.selected = null;
      return;
    }
    if (!types.some((t) => t.name === this.selected)) this.selected = types[0].name;
    this.renderList();
    this.renderDetail();
  }

  showError(err) {
    this.source = null;
    this.showBody(false);
    this.message.querySelector(".yh-types-message-title").textContent = err.toString();
    this.message.querySelector(".yh-types-message-hint").textContent = "Fix the YAML in the Text tab, and its types will show here.";
    this.message.querySelector('[data-types="go-to-error"]').hidden = false;
    this.message.classList.add("yh-tree-message--error");
  }

  showEmpty() {
    this.source = null;
    this.showBody(false);
    this.message.querySelector(".yh-types-message-title").textContent = "Nothing to show yet. Paste YAML in the Text tab, and its custom types will show here.";
    this.message.querySelector(".yh-types-message-hint").textContent = "";
    this.message.querySelector('[data-types="go-to-error"]').hidden = true;
    this.message.classList.remove("yh-tree-message--error");
  }

  showBody(on) {
    this.body.hidden = !on;
    this.message.hidden = on;
  }

  select(name) {
    this.selected = name;
    this.renderList();
    this.renderDetail();
  }

  renderList() {
    let html = "";
    this.types.forEach((t, i) => {
      const on = t.name === this.selected;
      html +=
        `<li><button type="button" class="yh-types-item" data-type-index="${i}" aria-current="${on}" tabindex="${on ? 0 : -1}">` +
        `<span class="yh-chip yh-tag yh-tag-c${t.color}">${escapeHtml(t.name)}</span>` +
        `<span class="yh-types-meta">${t.inconsistent ? '<span class="yh-types-flag-dot" title="Its uses disagree">⚠ </span>' : ""}${formatCount(t.count)}</span>` +
        "</button></li>";
    });
    this.list.innerHTML = html;
  }

  renderDetail() {
    const t = this.types.find((x) => x.name === this.selected);
    this.oddNodes = [];
    if (!t) {
      this.detail.innerHTML = "";
      return;
    }
    const kinds = t.kinds.map((k) => (t.kinds.length > 1 ? `${k.kind} ×${formatCount(k.count)}` : k.kind)).join(", ");
    let html =
      `<div class="yh-types-head"><h2 class="yh-types-title"><span class="yh-chip yh-tag yh-tag-c${t.color}">${escapeHtml(t.name)}</span></h2>` +
      `<span class="yh-types-summary">${escapeHtml(plural(t.count, "use"))} · ${escapeHtml(kinds)}</span>` +
      '<button type="button" class="yh-btn" data-types="show" title="Filter the tree to these nodes">Show in tree</button></div>';
    if (t.kinds.length > 1) {
      html += `<p class="yh-types-flag">⚠ ${escapeHtml(t.name)} is used on different kinds of node: ${escapeHtml(kinds)}.</p>`;
    }

    if (t.fields.length > 0) {
      html +=
        '<table class="yh-types-table"><thead><tr><th scope="col">Field</th><th scope="col">Present</th><th scope="col">Type</th><th scope="col">Notes</th></tr></thead><tbody>';
      for (const f of t.fields) {
        const presence = f.always
          ? `<span class="yh-types-presence--always">always</span>`
          : `<span class="yh-types-presence--optional">optional · ${formatCount(f.present)} of ${formatCount(t.mappings)} (${PERCENT(f.present, t.mappings)})</span>`;
        html +=
          `<tr><td><code>${escapeHtml(f.key)}</code></td><td>${presence}</td><td>${this.typesHtml(f)}</td>` +
          `<td>${this.notesHtml(f, `${f.key}`)}</td></tr>`;
      }
      html += "</tbody></table>";
    }
    if (t.items) {
      html += `<h3>Items</h3><p>${this.typesHtml(t.items)}</p>${this.notesHtml(t.items, "an item")}`;
    }
    if (t.values) {
      html +=
        `<h3>Values</h3><p>${this.typesHtml(t.values)}</p>` +
        `<p class="yh-types-summary">For example: ${t.values.examples.map((v) => `<code>${escapeHtml(v === "" ? "(empty)" : v)}</code>`).join(", ")}</p>` +
        this.notesHtml(t.values, "the value");
    }
    this.detail.innerHTML = html;
  }

  /** "string", or "number ×3, string ×1" when they disagree. */
  typesHtml(tally) {
    const shown = tally.types.filter((x) => x.type !== "null" || tally.types.length === 1);
    const several = shown.length > 1;
    let html = shown.map((x) => `<code>${escapeHtml(x.type)}</code>${several ? ` ×${formatCount(x.count)}` : ""}`).join(", ");
    if (tally.nullable && tally.types.length > 1) html += ' <span class="yh-types-summary">(nullable)</span>';
    return html;
  }

  /** The inconsistency, with a link to each odd use. */
  notesHtml(tally, what) {
    if (!tally.inconsistent) return "";
    const links = tally.odd.map(({ type, node }) => {
      const i = this.oddNodes.push(node) - 1;
      return `<button type="button" class="yh-link" data-odd="${i}" title="Show it in the tree">line ${node.start.line} (${escapeHtml(type)})</button>`;
    });
    return `<span class="yh-types-flag">⚠ ${escapeHtml(what)} is not always the same type — odd ones out: </span>${links.join(" ")}`;
  }
}
