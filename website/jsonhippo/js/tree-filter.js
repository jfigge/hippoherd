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
 * tree-filter.js — the live filter over the tree (jQuery).
 *
 * The search itself runs against the AST (tree-search.js, pure JS), because
 * the tree renders lazily and most nodes are not in the DOM to be found. This
 * class is the UI around it: the box, its options, the match count and
 * Previous/Next, the keyboard shortcuts, and telling the TreeView what to show.
 */

import { searchAst, SearchError } from "./tree-search.js";
import { debounce, formatCount, plural } from "./util.js";

const DEBOUNCE_MS = 250;

export class TreeFilter {
  /**
   * @param $panel    the Tree tab's <section>, as a jQuery object
   * @param treeView  the TreeView to drive
   * @param options   { getAst() → the current AST or null, isActive() → Tree tab showing }
   */
  constructor($panel, treeView, { getAst, isActive }) {
    this.$panel = $panel;
    this.tree = treeView;
    this.getAst = getAst;
    this.isActive = isActive;

    this.$input = $panel.find("#jh-filter");
    this.$scope = $panel.find("#jh-filter-scope");
    this.$case = $panel.find("#jh-filter-case");
    this.$regex = $panel.find("#jh-filter-regex");
    this.$count = $panel.find("#jh-filter-count");
    this.$error = $panel.find("#jh-filter-error");
    this.$prev = $panel.find("#jh-filter-prev");
    this.$next = $panel.find("#jh-filter-next");

    this.matches = [];
    this.index = -1;
    this.mode = null;
    this.searchedAst = null;
    this.debouncedRun = debounce(() => this.run(), DEBOUNCE_MS);

    this.bindEvents();
  }

  get query() {
    return String(this.$input.val() ?? "");
  }

  get options() {
    return {
      scope: String(this.$scope.val() ?? "both"),
      caseSensitive: this.$case.attr("aria-pressed") === "true",
      regex: this.$regex.attr("aria-pressed") === "true",
    };
  }

  get active() {
    return this.query.trim() !== "";
  }

  /** The document changed: search it again with the same query. */
  refresh() {
    this.debouncedRun.cancel();
    this.matches = [];
    this.index = -1;
    if (this.active) this.run();
    else this.showCount();
  }

  focus() {
    this.$input.trigger("focus").trigger("select");
  }

  /** Esc: empty the box and put the tree back as it was. */
  clear() {
    this.$input.val("");
    this.run();
  }

  run() {
    this.debouncedRun.cancel();
    const ast = this.getAst();
    const query = this.query;
    this.setError("");

    if (query.trim() === "" || !ast) {
      this.matches = [];
      this.index = -1;
      this.mode = null;
      this.tree.clearFilter();
      this.showCount();
      return;
    }

    let result;
    try {
      result = searchAst(ast, query, this.options);
    } catch (err) {
      if (!(err instanceof SearchError)) throw err;
      // An unfinished regex is normal while typing: say so, change nothing.
      this.setError(err.message);
      return;
    }

    this.matches = result.matches;
    this.mode = result.mode;
    this.index = -1;
    this.searchedAst = ast;
    this.tree.applyFilter(result);
    this.showCount();
  }

  /** Step through the matches; wraps around at either end. */
  step(delta) {
    this.debouncedRun.flush();
    const n = this.matches.length;
    if (n === 0) return;
    this.index = this.index < 0 ? (delta > 0 ? 0 : n - 1) : (this.index + delta + n) % n;
    this.tree.showMatch(this.matches[this.index].node);
    this.showCount();
  }

  showCount() {
    const n = this.matches.length;
    let text = "";
    if (this.active && this.$error.text() === "") {
      if (n === 0) text = "No matches";
      else if (this.index >= 0) text = `${formatCount(this.index + 1)} of ${plural(n, "match", "matches")}`;
      else text = plural(n, "match", "matches");
      if (this.mode === "path" && n > 0) text += " (path)";
    }
    this.$count.text(text);
    this.$prev.prop("disabled", n === 0);
    this.$next.prop("disabled", n === 0);
  }

  setError(message) {
    this.$error.text(message);
    this.$input.toggleClass("jh-filter--invalid", message !== "");
    this.$input.attr("aria-invalid", message !== "" ? "true" : "false");
    if (message !== "") this.$count.text("");
  }

  bindEvents() {
    this.$input.on("input", () => this.debouncedRun());

    this.$input.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (this.active) this.clear();
        else this.$input.trigger("blur");
      }
    });

    this.$scope.on("change", () => this.run());

    for (const $btn of [this.$case, this.$regex]) {
      $btn.on("click", () => {
        $btn.attr("aria-pressed", $btn.attr("aria-pressed") === "true" ? "false" : "true");
        this.run();
      });
    }

    this.$prev.on("click", () => this.step(-1));
    this.$next.on("click", () => this.step(1));

    // Esc in the tree clears an active filter too.
    this.$panel.find(".jh-tree").on("keydown", (e) => {
      if (e.key === "Escape" && this.active) {
        e.preventDefault();
        this.clear();
      }
    });

    // "/" anywhere on the Tree tab (outside a text field) jumps to the filter.
    $(document).on("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || !this.isActive()) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      this.focus();
    });
  }
}
