/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * tree-view.js — the Tree tab: a collapsible tree rendered from the AST.
 *
 * Lazy: a container's children are only put in the DOM the first time it is
 * expanded, so a 5 MB document starts as its root and first level. Children
 * past PAGE_SIZE wait behind a "show more" row, so one 100,000-item array
 * cannot freeze the page either.
 *
 * Which containers are open is held as a Set of AST nodes (this.expanded),
 * not read back from the DOM. That one Set is what makes the toolbar, the
 * filter and its undo cheap: Collapse all, Expand all, Expand to level N,
 * "show the matches" and "put it back how it was" are each just a different
 * Set followed by one render.
 *
 * The AST is never modified. Each rendered node keeps a record (this.recs,
 * found through the element's data-id) pointing at its AST node, which is
 * how a row links back to its source position.
 *
 * A row with a lint warning — on its key or on its value — carries a small
 * warning mark, and the detail bar says what the warning is.
 *
 * DOM work goes through jQuery (event delegation, classes, insertion); the
 * markup itself is built as one HTML string per render, which is what keeps
 * ten thousand rows inside the time budget.
 */

import { formatPath } from "./json-path.js";
import { valueText } from "./tree-search.js";
import { copyText, escapeHtml, flashButton, formatCount, plural } from "./util.js";

/** Children rendered per page before a "show more" row. */
export const PAGE_SIZE = 10000;

/**
 * The page size inside a filtered container. Filtering 'zip' over 8,457
 * people opens 8,457 people and 8,457 addresses: 25,000 rows, 1.4 s to draw
 * in Chrome. A page of 500 draws in well under the 500 ms budget, and the
 * count, Previous and Next still cover every match — stepping to one past
 * the page renders up to it.
 */
export const FILTER_PAGE_SIZE = 500;

/** Above this many nodes, Expand all / Expand to level ask first. */
export const CONFIRM_NODES = 5000;

/**
 * A bulk render (Expand all, a filter, a restore) stops opening containers
 * this many levels below where it started. The HTML parser caps element
 * nesting (Chromium at 512 elements — 256 tree levels, as each is an <li> and
 * a <ul>); past that it silently re-parents, which would scramble the tree.
 * Deeper containers can still be opened one at a time.
 */
const BULK_DEPTH = 200;

/** Longest string value shown in a row; the rest is a "… (n chars)" note. */
const MAX_SHOWN = 300;

const ICON = (name, cls = "") => `<svg class="jh-icon${cls}" aria-hidden="true"><use href="#jh-i-${name}"/></svg>`;
const CHEVRON = `<span class="jh-toggle" aria-hidden="true">${ICON("chevron")}</span>`;
const NO_TOGGLE = '<span class="jh-toggle jh-toggle--none" aria-hidden="true"></span>';

// The row is kept quiet so the data reads first. Containers carry a { } or
// [ ] mark (told apart by shape); scalars carry one small dot, the same for
// every type, because the value already says what it is — "text", 12, true,
// null. Counts are not shown on rows: an open container shows its children,
// and a selected one states its size in the detail bar.
const MARK = { object: ICON("object", " jh-type"), array: ICON("array", " jh-type") };
const DOT = '<span class="jh-dot" aria-hidden="true"></span>';
const WARN = ICON("warn");

/**
 * Control characters shown as their Unicode "control pictures" (\n → ␊).
 * One code unit in, one out, so match ranges from the search still line up.
 */
function visible(text) {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replace(/[\u0000-\u001f\u007f]/g, (c) => String.fromCharCode(c === "\u007f" ? 0x2421 : 0x2400 + c.charCodeAt(0)));
}

/** Escaped HTML for `text`, with [start, end) wrapped in a highlight. */
function highlighted(text, range) {
  if (!range || range[1] <= range[0] || range[0] >= text.length) return escapeHtml(text);
  const [s, e] = [range[0], Math.min(range[1], text.length)];
  return `${escapeHtml(text.slice(0, s))}<mark class="jh-hl">${escapeHtml(text.slice(s, e))}</mark>${escapeHtml(text.slice(e))}`;
}

/** "object · 5 keys", "array · 3 items", "string" — for the detail bar. */
function describeNode(node) {
  if (node.kind === "object") return `object · ${plural(node.entries.length, "key")}`;
  if (node.kind === "array") return `array · ${plural(node.items.length, "item")}`;
  return node.kind;
}

function childCount(node) {
  return node.kind === "object" ? node.entries.length : node.kind === "array" ? node.items.length : 0;
}

function isContainer(node) {
  return node.kind === "object" || node.kind === "array";
}

export class TreeView {
  /**
   * @param $panel    the Tree tab's <section>, as a jQuery object
   * @param callbacks {
   *   onSelect({ node, path })          — a node was selected (or null)
   *   onShowInText({ node, keyToken })  — "Show in text" for a node
   *   onGoToError()                     — "Go to error" from the invalid state
   *   formatValue(node) → string        — the node's value as text, for Copy value
   * }
   */
  constructor($panel, { onSelect, onShowInText, onGoToError, formatValue }) {
    this.$panel = $panel;
    this.$tree = $panel.find(".jh-tree");
    this.$wrap = $panel.find(".jh-tree-wrap");
    this.$message = $panel.find(".jh-tree-message");
    this.$detail = $panel.find(".jh-detail");
    this.$confirm = $panel.find(".jh-confirm");
    this.$level = $panel.find("#jh-level");
    this.onSelect = onSelect;
    this.onShowInText = onShowInText;
    this.onGoToError = onGoToError;
    this.formatValue = formatValue;

    this.ast = null;
    this.stats = null;
    this.warnings = new Map(); // key token or AST node → its lint warnings
    this.expanded = new Set();
    this.shown = new Map(); // container node → how many children are rendered
    this.recs = [];
    this.recByNode = new Map();
    this.selected = null; // AST node
    this.filter = null; // see applyFilter()
    this.saved = null; // the unfiltered state, while a filter is on
    this.pendingConfirm = null;

    this.bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get hasDocument() {
    return this.ast !== null;
  }

  /** Show a freshly parsed document: the root and its first level. */
  setDocument(ast, stats, warnings = []) {
    this.ast = ast;
    this.stats = stats;
    this.warnings = new Map();
    for (const w of warnings) {
      const list = this.warnings.get(w.target);
      if (list) list.push(w);
      else this.warnings.set(w.target, [w]);
    }
    this.expanded = new Set([ast]);
    this.shown = new Map();
    this.selected = null;
    this.filter = null;
    this.saved = null;
    this.$message.prop("hidden", true);
    this.$tree.prop("hidden", false);
    this.hideConfirm();
    this.render();
    this.$wrap.scrollTop(0);
    this.updateDetail();
  }

  /** Invalid input: the same error as the Text tab, never a partial tree. */
  showError(err) {
    this.clearDocument();
    this.$message.addClass("jh-tree-message--error");
    this.$message.find(".jh-tree-message-title").text(err.toString());
    this.$message.find(".jh-tree-message-hint").text(err.hint ?? "").prop("hidden", !err.hint);
    this.$message.find('[data-tree="go-to-error"]').prop("hidden", false);
  }

  showEmpty(message = "Nothing to show yet. Paste JSON in the Text tab.") {
    this.clearDocument();
    this.$message.removeClass("jh-tree-message--error");
    this.$message.find(".jh-tree-message-title").text(message);
    this.$message.find(".jh-tree-message-hint").text("").prop("hidden", true);
    this.$message.find('[data-tree="go-to-error"]').prop("hidden", true);
  }

  /**
   * Narrow the tree to a search result (from tree-search.js): expand every
   * ancestor of every match, mark the matches, and leave everything else
   * out. The unfiltered state is kept so clearFilter() can put it back.
   */
  applyFilter(result) {
    if (!this.ast) return;
    if (this.saved === null) {
      this.saved = { expanded: this.expanded, shown: this.shown, selected: this.selected, scrollTop: this.$wrap.scrollTop() };
    }
    const matches = new Map();
    for (const m of result.matches) matches.set(m.node, m);
    this.filter = { matches, ancestors: result.ancestors, parents: result.parents, current: null };
    this.expanded = new Set(result.ancestors);
    this.shown = new Map();
    this.render();
    this.$wrap.scrollTop(0);
  }

  /** Back to exactly the expand/collapse state from before the filter. */
  clearFilter() {
    if (this.saved === null) return;
    const { expanded, shown, selected, scrollTop } = this.saved;
    this.saved = null;
    this.filter = null;
    this.expanded = expanded;
    this.shown = shown;
    this.selected = selected;
    this.render();
    this.$wrap.scrollTop(scrollTop);
    this.updateDetail();
  }

  /** Make `node` (a filter match) the current one: reveal it and scroll to it. */
  showMatch(node) {
    if (!this.filter) return;
    this.filter.current = node;
    this.$tree.find(".jh-node--match-current").removeClass("jh-node--match-current");
    const li = this.reveal(node);
    if (!li) return;
    $(li).addClass("jh-node--match-current");
    this.scrollIntoView(li);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  clearDocument() {
    this.ast = null;
    this.stats = null;
    this.warnings = new Map();
    this.recs = [];
    this.recByNode = new Map();
    this.selected = null;
    this.filter = null;
    this.saved = null;
    this.$tree.empty().prop("hidden", true);
    this.$message.prop("hidden", false);
    this.hideConfirm();
    this.updateDetail();
  }

  /** Rebuild the whole tree from this.expanded. */
  render() {
    this.recs = [];
    this.recByNode = new Map();
    const root = this.makeRec(this.ast, null, undefined, null, 0);
    this.$tree.html(this.nodeHtml(root, 0));
    const focus = (this.selected && this.recByNode.get(this.selected)) || root;
    this.setTabStop(this.elementOf(focus));
  }

  makeRec(node, parent, seg, keyToken, depth) {
    const insideMatch = parent !== null && (parent.insideMatch || (this.filter?.matches.has(parent.node) ?? false));
    const rec = { id: this.recs.length, node, parent, seg, keyToken, depth, insideMatch, kids: undefined, rendered: false };
    this.recs.push(rec);
    this.recByNode.set(node, rec);
    return rec;
  }

  /**
   * The child indices a container shows. All of them normally (null); under
   * a filter, a container that is only there because a match sits below it
   * shows just the children leading to matches.
   */
  kidsOf(rec) {
    if (rec.kids !== undefined) return rec.kids;
    const f = this.filter;
    let kids = null;
    if (f && !rec.insideMatch && !f.matches.has(rec.node)) {
      kids = [];
      const node = rec.node;
      const n = childCount(node);
      for (let i = 0; i < n; i++) {
        const child = node.kind === "object" ? node.entries[i].value : node.items[i];
        if (f.matches.has(child) || f.ancestors.has(child)) kids.push(i);
      }
    }
    rec.kids = kids;
    return kids;
  }

  /** One node's <li>, including its rendered children when it is open. */
  nodeHtml(rec, bulkDepth) {
    const node = rec.node;
    const f = this.filter;
    const match = f?.matches.get(node);
    const container = isContainer(node);
    let open = container && this.expanded.has(node);
    if (open && bulkDepth >= BULK_DEPTH) {
      this.expanded.delete(node);
      open = false;
    }

    let cls = "jh-node";
    if (container) cls += open ? " jh-node--expanded" : " jh-node--collapsed";
    if (match) cls += " jh-node--match";
    if (f && f.current === node) cls += " jh-node--match-current";
    if (this.selected === node) cls += " jh-node--selected";

    // Label: the member name, the array index, or "JSON" for the root.
    let key;
    if (rec.parent === null) key = '<span class="jh-key jh-key--root">JSON</span>';
    else if (typeof rec.seg === "number") key = `<span class="jh-key jh-key--index">${rec.seg}</span>`;
    else key = `<span class="jh-key">${highlighted(visible(rec.seg), match?.key)}</span>`;

    let rest = "";
    if (container) {
      // Under a filter, a container that has lost children says so — the
      // one count that is not visible any other way.
      const n = childCount(node);
      const kids = f && !rec.insideMatch && !f.matches.has(node) ? this.kidsOf(rec) : null;
      if (kids && kids.length < n) {
        rest = `<span class="jh-count" title="The filter hides the rest">${formatCount(kids.length)} of ${formatCount(n)}</span>`;
      }
    } else {
      rest = `<span class="jh-colon">:</span>${this.scalarHtml(node, match?.value)}`;
    }

    const warns = this.warningsOf(rec);
    if (warns) rest += `<span class="jh-warn-mark" title="${escapeHtml(warns.map((w) => w.message).join("\n"))}">${WARN}</span>`;

    const aria = container ? ` aria-expanded="${open}"` : "";
    let html =
      `<li class="${cls}" role="treeitem" aria-level="${rec.depth + 1}"${aria} aria-selected="${this.selected === node}" tabindex="-1" data-id="${rec.id}">` +
      `<div class="jh-row">${container ? CHEVRON : NO_TOGGLE}${container ? MARK[node.kind] : DOT}${key}${rest}</div>`;
    if (open) {
      rec.rendered = true;
      html += this.childrenHtml(rec, bulkDepth + 1);
    }
    return `${html}</li>`;
  }

  /** The warnings on a row — on its key and on its value — or null. */
  warningsOf(rec) {
    if (this.warnings.size === 0) return null;
    const onKey = rec.keyToken ? this.warnings.get(rec.keyToken) : undefined;
    const onValue = this.warnings.get(rec.node);
    if (!onKey) return onValue ?? null;
    return onValue ? onKey.concat(onValue) : onKey;
  }

  scalarHtml(node, range) {
    if (node.kind === "string") {
      const text = visible(node.value);
      const shown = text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) : text;
      const more = text.length > MAX_SHOWN ? `<span class="jh-truncated">… (${formatCount(text.length)} chars)</span>` : "";
      return `<span class="jh-value jh-value--string">"${highlighted(shown, range)}"</span>${more}`;
    }
    return `<span class="jh-value jh-value--${node.kind}">${highlighted(valueText(node), range)}</span>`;
  }

  childrenHtml(rec, bulkDepth) {
    return `<ul class="jh-children" role="group">${this.childItemsHtml(rec, 0, bulkDepth)}</ul>`;
  }

  /** The <li>s for children [from, shown), then a "show more" row if needed. */
  childItemsHtml(rec, from, bulkDepth) {
    const node = rec.node;
    const isObject = node.kind === "object";
    const list = isObject ? node.entries : node.items;
    const kids = this.kidsOf(rec);
    const total = kids ? kids.length : list.length;
    const page = kids ? FILTER_PAGE_SIZE : PAGE_SIZE;
    const shown = Math.min(total, this.shown.get(node) ?? page);
    let html = "";
    for (let k = from; k < shown; k++) {
      const i = kids ? kids[k] : k;
      const child = isObject
        ? this.makeRec(list[i].value, rec, list[i].key, list[i].keyToken, rec.depth + 1)
        : this.makeRec(list[i], rec, i, null, rec.depth + 1);
      html += this.nodeHtml(child, bulkDepth);
    }
    if (shown < total) {
      const next = Math.min(page, total - shown);
      html +=
        `<li class="jh-more" role="none" data-parent="${rec.id}">` +
        `<button type="button" class="jh-btn" data-more="page">Show ${formatCount(next)} more</button>` +
        `<button type="button" class="jh-btn" data-more="all">Show all ${formatCount(total)}</button>` +
        `<span class="jh-count">showing ${formatCount(shown)} of ${formatCount(total)}</span></li>`;
    }
    return html;
  }

  elementOf(rec) {
    return this.$tree[0].querySelector(`[data-id="${rec.id}"]`);
  }

  recOf(el) {
    const li = el?.closest?.(".jh-node");
    return li ? this.recs[Number(li.dataset.id)] : undefined;
  }

  // ── Expand / collapse ────────────────────────────────────────────────────

  expand(rec) {
    if (!isContainer(rec.node) || childCount(rec.node) === 0) return;
    this.expanded.add(rec.node);
    const $li = $(this.elementOf(rec));
    if (!rec.rendered) {
      rec.rendered = true;
      $li.append(this.childrenHtml(rec, 0));
    }
    $li.removeClass("jh-node--collapsed").addClass("jh-node--expanded").attr("aria-expanded", "true");
  }

  collapse(rec) {
    if (!isContainer(rec.node)) return;
    this.expanded.delete(rec.node);
    $(this.elementOf(rec)).removeClass("jh-node--expanded").addClass("jh-node--collapsed").attr("aria-expanded", "false");
  }

  toggle(rec) {
    if (this.expanded.has(rec.node)) this.collapse(rec);
    else this.expand(rec);
  }

  /**
   * Render more of a container's children: 'page' for the next page, 'all',
   * or a number — at least that many (rounded up to a whole page).
   */
  showMore(rec, how) {
    const kids = this.kidsOf(rec);
    const total = kids ? kids.length : childCount(rec.node);
    const page = kids ? FILTER_PAGE_SIZE : PAGE_SIZE;
    const before = Math.min(total, this.shown.get(rec.node) ?? page);
    let after = how === "all" ? total : how === "page" ? before + page : Math.ceil(how / page) * page;
    after = Math.min(total, Math.max(after, before));
    if (after === before) return;
    this.shown.set(rec.node, after);
    const $more = $(this.elementOf(rec)).children(".jh-children").children(".jh-more");
    $more.replaceWith(this.childItemsHtml(rec, before, 0));
  }

  /** Where `child` sits among the children `rec` shows (-1 if it does not). */
  positionOf(rec, child) {
    const node = rec.node;
    const at = (i) => (node.kind === "object" ? node.entries[i].value : node.items[i]);
    const kids = this.kidsOf(rec);
    if (kids) return kids.findIndex((i) => at(i) === child);
    for (let i = 0, n = childCount(node); i < n; i++) if (at(i) === child) return i;
    return -1;
  }

  collapseAll() {
    this.expanded = new Set([this.ast]);
    this.render();
    this.$wrap.scrollTop(0);
  }

  /** Every container whose depth is below `level` (the root is depth 0). */
  containersAbove(level) {
    const out = new Set();
    let count = 1;
    const stack = [[this.ast, 0]];
    while (stack.length > 0) {
      const [node, depth] = stack.pop();
      if (!isContainer(node) || depth >= level) continue;
      out.add(node);
      const kids = node.kind === "object" ? node.entries.map((e) => e.value) : node.items;
      count += kids.length;
      for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
    }
    return { set: out, rows: count };
  }

  expandToLevel(level, confirmed = false) {
    const { set, rows } = this.containersAbove(level);
    if (!confirmed && rows > CONFIRM_NODES) {
      this.askConfirm(`Expanding to level ${level} shows ${plural(rows, "node")}. That can take a moment.`, () => this.expandToLevel(level, true));
      return;
    }
    this.expanded = set;
    this.render();
  }

  expandAll(confirmed = false) {
    const total = this.stats?.nodes ?? 0;
    if (!confirmed && total > CONFIRM_NODES) {
      this.askConfirm(`Expand all ${formatCount(total)} nodes? A tree this size can take a few seconds to draw.`, () => this.expandAll(true));
      return;
    }
    this.expanded = this.containersAbove(Infinity).set;
    this.render();
  }

  askConfirm(text, onYes) {
    this.pendingConfirm = onYes;
    this.$confirm.find(".jh-confirm-text").text(text);
    this.$confirm.prop("hidden", false);
    this.$confirm.find(".jh-btn--primary").trigger("focus");
  }

  hideConfirm() {
    this.pendingConfirm = null;
    this.$confirm.prop("hidden", true);
  }

  /**
   * Make sure `node` is rendered: open every container on the way down to it,
   * paging further into any container whose page does not reach it yet.
   */
  reveal(node) {
    if (this.recByNode.has(node) && this.elementOf(this.recByNode.get(node))) {
      // Rendered — but maybe inside a collapsed container.
      for (let r = this.recByNode.get(node).parent; r; r = r.parent) if (!this.expanded.has(r.node)) this.expand(r);
      return this.elementOf(this.recByNode.get(node));
    }
    // Only a filter knows the way up from an unrendered node.
    const parents = this.filter?.parents;
    if (!parents) return null;
    const chain = [];
    for (let n = node; n && n !== this.ast; n = parents.get(n)) chain.unshift(n);
    let rec = this.recByNode.get(this.ast);
    for (const child of chain) {
      if (!this.expanded.has(rec.node)) this.expand(rec);
      let childRec = this.recByNode.get(child);
      if (!childRec || childRec.parent !== rec) {
        this.showMore(rec, this.positionOf(rec, child) + 1);
        childRec = this.recByNode.get(child);
      }
      if (!childRec) return null;
      rec = childRec;
    }
    return this.elementOf(rec);
  }

  // ── Selection, focus and the detail bar ──────────────────────────────────

  select(rec) {
    this.$tree.find(".jh-node--selected").removeClass("jh-node--selected").attr("aria-selected", "false");
    this.selected = rec ? rec.node : null;
    if (rec) {
      const li = this.elementOf(rec);
      $(li).addClass("jh-node--selected").attr("aria-selected", "true");
      this.setTabStop(li);
    }
    this.updateDetail();
  }

  selectedRec() {
    return this.selected ? this.recByNode.get(this.selected) : undefined;
  }

  pathOf(rec) {
    const segments = [];
    for (let r = rec; r && r.parent; r = r.parent) segments.unshift(r.seg);
    return formatPath(segments);
  }

  updateDetail() {
    const rec = this.selectedRec();
    this.$detail.prop("hidden", !rec);
    if (rec) {
      this.$detail.find(".jh-detail-path").text(this.pathOf(rec)).attr("title", this.pathOf(rec));
      this.$detail.find(".jh-detail-kind").text(describeNode(rec.node));
      const warns = this.warningsOf(rec);
      const text = warns ? warns.map((w) => w.message).join("; ") : "";
      this.$detail
        .find(".jh-detail-warn")
        .html(warns ? `${WARN}<span>${escapeHtml(text)}</span>` : "")
        .attr("title", text)
        .prop("hidden", !warns);
    }
    this.onSelect(rec ? { node: rec.node, path: this.pathOf(rec) } : null);
  }

  setTabStop(li) {
    if (!li) return;
    this.$tree.find('[tabindex="0"]').attr("tabindex", "-1");
    li.setAttribute("tabindex", "0");
  }

  focusNode(li) {
    if (!li) return;
    this.setTabStop(li);
    li.focus({ preventScroll: true });
    this.scrollIntoView(li, "nearest");
  }

  scrollIntoView(li, block = "center") {
    const row = li.firstElementChild;
    const box = this.$wrap[0].getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) row.scrollIntoView({ block });
  }

  /** The next row down that is showing, in document order. */
  nextRow(li) {
    if (li.classList.contains("jh-node--expanded")) {
      const first = li.querySelector(":scope > .jh-children > .jh-node");
      if (first) return first;
    }
    for (let el = li; el && el.classList.contains("jh-node"); el = el.parentElement.closest(".jh-node")) {
      let sib = el.nextElementSibling;
      while (sib && !sib.classList.contains("jh-node")) sib = sib.nextElementSibling;
      if (sib) return sib;
    }
    return null;
  }

  /** The row above, descending into the last open child where there is one. */
  prevRow(li) {
    let sib = li.previousElementSibling;
    while (sib && !sib.classList.contains("jh-node")) sib = sib.previousElementSibling;
    if (!sib) return li.parentElement.closest(".jh-node");
    let el = sib;
    while (el.classList.contains("jh-node--expanded")) {
      const kids = el.querySelectorAll(":scope > .jh-children > .jh-node");
      if (kids.length === 0) break;
      el = kids[kids.length - 1];
    }
    return el;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  bindEvents() {
    this.$tree.on("click", ".jh-toggle", (e) => {
      e.stopPropagation();
      const rec = this.recOf(e.currentTarget);
      if (rec) {
        this.toggle(rec);
        this.focusNode(this.elementOf(rec));
      }
    });

    this.$tree.on("click", ".jh-row", (e) => {
      const rec = this.recOf(e.currentTarget);
      if (!rec) return;
      this.select(rec);
      this.focusNode(this.elementOf(rec));
    });

    this.$tree.on("dblclick", ".jh-row", (e) => {
      const rec = this.recOf(e.currentTarget);
      if (rec) this.toggle(rec);
    });

    this.$tree.on("click", "[data-more]", (e) => {
      const parent = this.recs[Number(e.currentTarget.closest(".jh-more").dataset.parent)];
      if (parent) this.showMore(parent, e.currentTarget.dataset.more);
    });

    this.$tree.on("keydown", (e) => this.onKey(e));

    this.$panel.on("click", "[data-tree]", (e) => {
      const action = e.currentTarget.dataset.tree;
      const rec = this.selectedRec();
      switch (action) {
        case "expand-all":
          if (this.ast) this.expandAll();
          break;
        case "collapse-all":
          if (this.ast) this.collapseAll();
          break;
        case "confirm-yes": {
          const run = this.pendingConfirm;
          this.hideConfirm();
          run?.();
          break;
        }
        case "confirm-no":
          this.hideConfirm();
          break;
        case "go-to-error":
          this.onGoToError();
          break;
        case "copy-path":
          if (rec) this.copy(e.currentTarget, this.pathOf(rec));
          break;
        case "copy-value":
          if (rec) this.copy(e.currentTarget, this.formatValue(rec.node));
          break;
        case "show-in-text":
          if (rec) this.onShowInText({ node: rec.node, keyToken: rec.keyToken });
          break;
      }
    });

    // A menu of levels rather than a number box and a button: one control.
    // It snaps back to "Level…" so the same level can be chosen again.
    this.$level.on("change", () => {
      const level = parseInt(String(this.$level.val()), 10);
      this.$level.val("");
      if (this.ast && level > 0) this.expandToLevel(level);
    });
  }

  async copy(button, text) {
    flashButton(button, (await copyText(text)) ? "Copied" : "Copy failed");
  }

  onKey(e) {
    const li = e.target.closest(".jh-node");
    const rec = this.recOf(li);
    if (!rec) return;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        this.focusNode(this.nextRow(li));
        break;
      case "ArrowUp":
        this.focusNode(this.prevRow(li));
        break;
      case "ArrowRight":
        if (isContainer(rec.node) && !this.expanded.has(rec.node)) this.expand(rec);
        else if (this.expanded.has(rec.node)) this.focusNode(li.querySelector(":scope > .jh-children > .jh-node"));
        break;
      case "ArrowLeft":
        if (this.expanded.has(rec.node)) this.collapse(rec);
        else this.focusNode(li.parentElement.closest(".jh-node"));
        break;
      case "Enter":
      case " ":
        this.select(rec);
        break;
      case "Home":
        this.focusNode(this.$tree[0].querySelector(".jh-node"));
        break;
      case "End": {
        let last = this.$tree[0].querySelector(".jh-node");
        for (let next = last && this.nextRow(last); next; next = this.nextRow(next)) last = next;
        this.focusNode(last);
        break;
      }
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }
}
