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
 * schema-view.js — the Schema tab: a JSON Schema inferred from the YAML in
 * the Text tab (schema/infer.js), in a read-only editor with a line-number
 * gutter, and the options it is inferred and written with. The schema
 * describes the document's JSON form (aliases expanded, tags left out) and
 * is written as JSON, or — it is YAML's tool — as YAML.
 *
 * The YAML itself is never touched. app.js hands over the current document
 * each time the tab is shown, and the schema is inferred again only when it
 * or an option has changed since. Without valid YAML to work from, the tab
 * says why instead, and offers to go to the error.
 *
 * The gutter holds only the line numbers that are on screen, as the Text
 * tab's does: the schema of a document with many distinct keys runs long.
 */

import { inferSchema, MAX_SCHEMA_DEPTH } from "./schema/infer.js";
import { format } from "./formatter.js";
import { emitYaml } from "./yaml-emitter.js";
import { copyText, flashButton, formatCount } from "./util.js";

export class SchemaView {
  /**
   * @param panel     the Schema tab's <section>
   * @param options   {
   *   settings: Settings  — the draft, required keys, format and indent to write it with
   *   onGoToError()       — show the YAML's parse error in the Text tab
   * }
   */
  constructor(panel, { settings, onGoToError }) {
    this.panel = panel;
    this.settings = settings;
    this.onGoToError = onGoToError;

    this.editor = panel.querySelector(".yh-editor");
    this.output = panel.querySelector(".yh-input");
    this.gutter = panel.querySelector(".yh-gutter");
    this.gutterLines = panel.querySelector(".yh-gutter-lines");
    this.notice = panel.querySelector(".yh-notice");
    this.message = panel.querySelector(".yh-schema-message");
    this.copyButton = panel.querySelector('[data-schema="copy"]');
    this.draft = panel.querySelector("#yh-schema-draft");
    this.required = panel.querySelector("#yh-schema-required");
    this.formatSelect = panel.querySelector("#yh-schema-format");

    this.source = null; // { ast, draft, required, indent, as } the shown schema was inferred from
    this.lineCount = 1;
    this.renderQueued = false;

    const style = getComputedStyle(this.output);
    this.lineHeight = parseFloat(style.lineHeight) || 20;
    this.padTop = parseFloat(style.paddingTop) || 0;

    this.bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Show the schema of `ast`, the current document. */
  show(ast) {
    const draft = this.settings.schemaDraft;
    const required = this.settings.schemaRequired;
    const indent = this.settings.indent;
    const as = this.settings.schemaFormat;
    const s = this.source;
    if (s && s.ast === ast && s.draft === draft && s.required === required && s.indent === indent && s.as === as) return;

    const { schema, depthLimited } = inferSchema(ast, { draft, required });
    this.output.value = as === "yaml" ? emitYaml(schema, { indent: Number(indent) }) : format(schema, { indent: " ".repeat(Number(indent)) });
    // A different document starts at the top; a changed option keeps the place.
    if (s?.ast !== ast) {
      this.output.scrollTop = 0;
      this.output.scrollLeft = 0;
    }
    this.source = { ast, draft, required, indent, as };

    this.notice.textContent = depthLimited ? `Below depth ${formatCount(MAX_SCHEMA_DEPTH)} the schema gives types only.` : "";
    this.notice.hidden = !depthLimited;
    this.showEditor(true);
    this.recountLines();
  }

  /** The YAML does not parse: there is no schema to show. */
  showError(err) {
    this.showMessage(err.toString(), "Fix the YAML in the Text tab, and its schema will show here.", { error: true });
  }

  showEmpty() {
    this.showMessage("Nothing to show yet. Paste YAML in the Text tab, and its schema will show here.");
  }

  // ── Internals ────────────────────────────────────────────────────────────

  showMessage(title, hint = "", { error = false } = {}) {
    this.source = null;
    this.output.value = "";
    this.notice.hidden = true;
    this.showEditor(false);
    this.message.classList.toggle("yh-schema-message--error", error);
    this.message.querySelector(".yh-schema-message-title").textContent = title;
    const hintEl = this.message.querySelector(".yh-schema-message-hint");
    hintEl.textContent = hint;
    hintEl.hidden = hint === "";
    this.message.querySelector('[data-schema="go-to-error"]').hidden = !error;
  }

  showEditor(on) {
    this.editor.hidden = !on;
    this.message.hidden = on;
    this.copyButton.disabled = !on;
  }

  /** An option changed: infer the shown schema again with it. */
  refresh() {
    if (this.source) this.show(this.source.ast);
  }

  bindEvents() {
    this.draft.value = this.settings.schemaDraft;
    this.draft.addEventListener("change", () => {
      this.settings.schemaDraft = this.draft.value;
      this.refresh();
    });

    this.formatSelect.value = this.settings.schemaFormat;
    this.formatSelect.addEventListener("change", () => {
      this.settings.schemaFormat = this.formatSelect.value;
      this.refresh();
    });

    this.required.checked = this.settings.schemaRequired;
    this.required.addEventListener("change", () => {
      this.settings.schemaRequired = this.required.checked;
      this.refresh();
    });

    this.panel.addEventListener("click", (e) => {
      const button = e.target.closest("[data-schema]");
      if (!button) return;
      if (button.dataset.schema === "copy") this.copy(button);
      else if (button.dataset.schema === "go-to-error") this.onGoToError();
    });

    this.output.addEventListener("scroll", () => this.scheduleRender());
    new ResizeObserver(() => this.scheduleRender()).observe(this.output);
  }

  async copy(button) {
    if (await copyText(this.output.value)) flashButton(button);
    else flashButton(button, "Copy failed");
  }

  // ── Gutter ───────────────────────────────────────────────────────────────

  recountLines() {
    const text = this.output.value;
    let count = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++;
    this.lineCount = count;
    this.gutter.style.width = `calc(${String(count).length}ch + 26px)`;
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  renderNow() {
    const out = this.output;
    const lh = this.lineHeight;
    const first = Math.max(0, Math.floor((out.scrollTop - this.padTop) / lh));
    const last = Math.min(this.lineCount, first + Math.ceil(out.clientHeight / lh) + 2);
    let html = "";
    for (let n = first + 1; n <= last; n++) html += `<div class="yh-gutter-line">${n}</div>`;
    this.gutterLines.innerHTML = html;
    this.gutterLines.style.transform = `translateY(${this.padTop + first * lh - out.scrollTop}px)`;
  }
}
