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
 * schema-view.js — the Schema tab: a JSON Schema inferred from the JSON in
 * the Text tab (schema/infer.js), in a read-only editor with a line-number
 * gutter, and the two options it is inferred with.
 *
 * The JSON itself is never touched. app.js hands over the current parse each
 * time the tab is shown, and the schema is inferred again only when that
 * parse or an option has changed since. Without valid JSON to work from, the
 * tab says why instead, and offers to go to the error.
 *
 * The gutter holds only the line numbers that are on screen, as the Text
 * tab's does: the schema of a document with many distinct keys runs long.
 */

import { inferSchema, MAX_SCHEMA_DEPTH } from "./schema/infer.js";
import { format, INDENTS } from "./formatter.js";
import { copyText, flashButton, formatCount } from "./util.js";

export class SchemaView {
  /**
   * @param panel     the Schema tab's <section>
   * @param options   {
   *   settings: Settings  — the draft, required keys and indent to write it with
   *   onGoToError()       — show the JSON's parse error in the Text tab
   * }
   */
  constructor(panel, { settings, onGoToError }) {
    this.panel = panel;
    this.settings = settings;
    this.onGoToError = onGoToError;

    this.editor = panel.querySelector(".jh-editor");
    this.output = panel.querySelector(".jh-input");
    this.gutter = panel.querySelector(".jh-gutter");
    this.gutterLines = panel.querySelector(".jh-gutter-lines");
    this.notice = panel.querySelector(".jh-notice");
    this.message = panel.querySelector(".jh-schema-message");
    this.copyButton = panel.querySelector('[data-schema="copy"]');
    this.draft = panel.querySelector("#jh-schema-draft");
    this.required = panel.querySelector("#jh-schema-required");

    this.source = null; // { ast, draft, required, indent } the shown schema was inferred from
    this.lineCount = 1;
    this.renderQueued = false;

    const style = getComputedStyle(this.output);
    this.lineHeight = parseFloat(style.lineHeight) || 20;
    this.padTop = parseFloat(style.paddingTop) || 0;

    this.bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Show the schema of `ast`, the parse of the current JSON. */
  show(ast) {
    const draft = this.settings.schemaDraft;
    const required = this.settings.schemaRequired;
    const indent = this.settings.indent;
    const s = this.source;
    if (s && s.ast === ast && s.draft === draft && s.required === required && s.indent === indent) return;

    const { schema, depthLimited } = inferSchema(ast, { draft, required });
    this.output.value = format(schema, { indent: INDENTS[indent] });
    // A different document starts at the top; a changed option keeps the place.
    if (s?.ast !== ast) {
      this.output.scrollTop = 0;
      this.output.scrollLeft = 0;
    }
    this.source = { ast, draft, required, indent };

    this.notice.textContent = depthLimited ? `Below depth ${formatCount(MAX_SCHEMA_DEPTH)} the schema gives types only.` : "";
    this.notice.hidden = !depthLimited;
    this.showEditor(true);
    this.recountLines();
  }

  /** The JSON does not parse: there is no schema to show. */
  showError(err) {
    this.showMessage(err.toString(), "Fix the JSON in the Text tab, and its schema will show here.", { error: true });
  }

  showEmpty() {
    this.showMessage("Nothing to show yet. Paste JSON in the Text tab, and its schema will show here.");
  }

  // ── Internals ────────────────────────────────────────────────────────────

  showMessage(title, hint = "", { error = false } = {}) {
    this.source = null;
    this.output.value = "";
    this.notice.hidden = true;
    this.showEditor(false);
    this.message.classList.toggle("jh-schema-message--error", error);
    this.message.querySelector(".jh-schema-message-title").textContent = title;
    const hintEl = this.message.querySelector(".jh-schema-message-hint");
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
    for (let n = first + 1; n <= last; n++) html += `<div class="jh-gutter-line">${n}</div>`;
    this.gutterLines.innerHTML = html;
    this.gutterLines.style.transform = `translateY(${this.padTop + first * lh - out.scrollTop}px)`;
  }
}
