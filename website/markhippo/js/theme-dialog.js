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
 * theme-dialog.js — the Themes dialog: pick a palette, pick the mode, and
 * make palettes of your own.
 *
 * The list on the left is every palette (Hippo, the plugins', yours);
 * choosing one applies it. On the right is the chosen palette's colours for
 * one mode at a time (Light / Dark tabs). The page behind shows that mode
 * while the dialog is open, so an edit is seen as it is made. Built-in
 * palettes are read-only — Duplicate makes an editable copy — and your own
 * are saved as you edit them. Text colours show their contrast against
 * what they are read on, marked against WCAG AA (4.5:1).
 */

import { HIPPO } from "./themes/palettes.js";
import { CONTRAST_PAIRS, TOKENS, contrast, normalizeHex } from "./themes/tokens.js";
import { cleanPalette, newId, parseThemeFile, themeFile, themeFileName } from "./themes/store.js";

const SWATCHES = ["--bg", "--text", "--accent", "--tk-keyword", "--tk-string"];
// Each text token → the backgrounds it is read on.
const AGAINST = new Map();
for (const [fg, bg] of CONTRAST_PAIRS) AGAINST.set(fg, [...(AGAINST.get(fg) ?? []), bg]);
const LABELS = new Map(TOKENS.flatMap((g) => g.tokens));

export class ThemeDialog {
  constructor(dialog, { themes, download }) {
    this.dialog = dialog;
    this.themes = themes;
    this.download = download;
    this.variant = themes.resolvedMode();
    const $ = (id) => dialog.querySelector(`#${id}`);
    this.list = $("mh-palette-list");
    this.grid = $("mh-theme-grid");
    this.name = $("mh-theme-name");
    this.note = $("mh-theme-note");
    this.status = $("mh-theme-status");
    this.file = $("mh-theme-file");
    this.tabs = [...dialog.querySelectorAll("[role=tab]")];
    this.deleteButton = dialog.querySelector("[data-theme-action=delete]");

    this.list.addEventListener("click", (e) => {
      const button = e.target.closest("[data-palette]");
      if (button) this.choose(button.dataset.palette);
    });
    for (const tab of this.tabs) tab.addEventListener("click", () => this.showVariant(tab.dataset.variant));
    // The ARIA tabs pattern: arrows (and Home/End) move between the tabs.
    dialog.querySelector("[role=tablist]").addEventListener("keydown", (e) => {
      const i = this.tabs.indexOf(e.target);
      if (i === -1) return;
      const n = this.tabs.length;
      const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      this.showVariant(this.tabs[to].dataset.variant);
      this.tabs[to].focus();
    });
    dialog.querySelector("#mh-mode").addEventListener("change", (e) => {
      themes.setMode(e.target.value);
      this.showVariant(themes.resolvedMode());
    });
    const actions = { new: () => this.create(), duplicate: () => this.duplicate(), delete: () => this.remove(), export: () => this.exportTheme(), import: () => this.file.click() };
    dialog.addEventListener("click", (e) => {
      const action = e.target.closest("[data-theme-action]")?.dataset.themeAction;
      if (action && actions[action]) actions[action]();
    });
    this.name.addEventListener("input", () => {
      const name = this.name.value.trim();
      if (!name) return;
      themes.updateCustom(this.palette().id, (p) => (p.name = name));
      this.renderList();
    });
    // Left empty, the name goes back to what it is.
    this.name.addEventListener("change", () => {
      if (!this.name.value.trim()) this.name.value = this.palette().name;
    });
    this.grid.addEventListener("input", (e) => this.edit(e.target));
    this.grid.addEventListener("change", (e) => {
      // A hex field left half-typed (or as #abc) shows the colour as it is.
      const input = e.target;
      if (!input.classList.contains("mh-color-hex")) return;
      const value = this.palette()[this.variant][input.dataset.token];
      if (input.value !== value) input.value = value;
    });
    this.file.addEventListener("change", () => this.importFile());
    // Closing puts the user's own mode back. The close event comes a task
    // later (and later still in a background tab), so Escape and Done
    // restore it at once as well.
    const finish = () => {
      themes.setPreview(null);
      this.resetDelete();
    };
    dialog.addEventListener("cancel", finish);
    dialog.querySelector(".mh-themes-done").addEventListener("submit", finish);
    dialog.addEventListener("close", finish);
  }

  open() {
    this.say("");
    this.variant = this.themes.resolvedMode();
    for (const radio of this.dialog.querySelectorAll("[name=mh-mode]")) radio.checked = radio.value === this.themes.mode;
    this.render();
    this.dialog.showModal();
    this.list.querySelector("[aria-pressed=true]")?.focus();
  }

  palette() {
    return this.themes.current();
  }

  editable() {
    return this.themes.isCustom(this.palette().id);
  }

  choose(id) {
    this.themes.choose(id);
    this.resetDelete();
    this.render();
    this.focusPalette();
  }

  // The list is rebuilt on every change; keep the focus on the chosen one
  // (and so let a screen reader hear that it is now pressed).
  focusPalette() {
    this.list.querySelector(`[data-palette="${CSS.escape(this.palette().id)}"]`)?.focus();
  }

  showVariant(variant) {
    this.variant = variant === "dark" ? "dark" : "light";
    this.render();
  }

  render() {
    this.themes.setPreview({ palette: this.palette().id, mode: this.variant });
    this.renderList();
    this.renderEditor();
  }

  renderList() {
    const currentId = this.palette().id;
    this.list.replaceChildren(
      ...this.themes.palettes().map((p) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mh-palette";
        button.dataset.palette = p.id;
        button.setAttribute("aria-pressed", String(p.id === currentId));
        const swatches = document.createElement("span");
        swatches.className = "mh-palette-swatches";
        for (const mode of ["light", "dark"]) {
          const half = document.createElement("span");
          half.className = "mh-palette-half";
          half.style.background = p[mode]["--bg"];
          for (const token of SWATCHES.slice(1)) {
            const dot = document.createElement("span");
            dot.className = "mh-palette-dot";
            dot.style.background = p[mode][token];
            half.append(dot);
          }
          swatches.append(half);
        }
        const name = document.createElement("span");
        name.className = "mh-palette-name";
        name.textContent = p.name;
        const badge = document.createElement("span");
        badge.className = "mh-palette-badge";
        badge.textContent = this.themes.isCustom(p.id) ? "Yours" : "Built in";
        button.append(swatches, name, badge);
        li.append(button);
        return li;
      }),
    );
  }

  renderEditor() {
    const palette = this.palette();
    const editable = this.editable();
    this.name.value = palette.name;
    this.name.readOnly = !editable;
    this.deleteButton.disabled = !editable;
    this.note.textContent = editable
      ? "Your theme: changes are saved as you make them."
      : `${palette.name} is built in. Duplicate it to make a version of your own.`;
    for (const tab of this.tabs) {
      const on = tab.dataset.variant === this.variant;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    this.grid.setAttribute("aria-labelledby", `mh-theme-tab-${this.variant}`);
    this.renderGrid();
  }

  renderGrid() {
    const vars = this.palette()[this.variant];
    const editable = this.editable();
    const groups = TOKENS.map(({ group, tokens }) => {
      const section = document.createElement("section");
      section.className = "mh-color-group";
      const h = document.createElement("h3");
      h.textContent = group;
      section.append(h);
      for (const [token, label] of tokens) {
        const row = document.createElement("div");
        row.className = "mh-color-row";
        const id = `mh-color-${token.slice(2)}`;
        const name = document.createElement("label");
        name.className = "mh-color-name";
        name.htmlFor = id;
        name.textContent = label;
        name.title = token;
        const picker = document.createElement("input");
        picker.type = "color";
        picker.id = id;
        picker.className = "mh-color-picker";
        picker.value = vars[token];
        picker.dataset.token = token;
        picker.disabled = !editable;
        const hex = document.createElement("input");
        hex.type = "text";
        hex.className = "mh-color-hex";
        hex.value = vars[token];
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.dataset.token = token;
        hex.readOnly = !editable;
        hex.setAttribute("aria-label", `${label}, hex`);
        row.append(name, picker, hex, this.contrastBadge(token, vars));
        section.append(row);
      }
      return section;
    });
    this.grid.replaceChildren(...groups);
  }

  contrastBadge(token, vars) {
    const badge = document.createElement("span");
    badge.className = "mh-contrast";
    badge.dataset.contrast = token;
    const backgrounds = AGAINST.get(token);
    if (!backgrounds) return badge;
    // The worst of the backgrounds it is read on.
    let against = backgrounds[0];
    for (const bg of backgrounds) if (contrast(vars[token], vars[bg]) < contrast(vars[token], vars[against])) against = bg;
    const ratio = contrast(vars[token], vars[against]);
    badge.textContent = `${ratio.toFixed(1)}:1`;
    badge.classList.add(ratio >= 4.5 ? "mh-contrast--good" : ratio >= 3 ? "mh-contrast--fair" : "mh-contrast--poor");
    badge.title = `Contrast with ${LABELS.get(against).toLowerCase()}: ${ratio.toFixed(2)}:1 (WCAG AA needs 4.5:1)`;
    return badge;
  }

  // A colour was changed, in the picker or as hex.
  edit(input) {
    const token = input.dataset.token;
    if (!token || !this.editable()) return;
    const value = normalizeHex(input.value);
    if (!value) return;
    const variant = this.variant;
    this.themes.updateCustom(this.palette().id, (p) => (p[variant][token] = value));
    // Bring the row's other input and every affected badge up to date,
    // without rebuilding the grid under the user's pointer.
    const vars = this.palette()[variant];
    for (const other of this.grid.querySelectorAll(`[data-token="${token}"]`)) {
      if (other !== input) other.value = value;
    }
    for (const badge of this.grid.querySelectorAll("[data-contrast]")) {
      badge.replaceWith(this.contrastBadge(badge.dataset.contrast, vars));
    }
    this.renderList();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  create() {
    this.add(cleanPalette({ ...HIPPO, name: "My theme" }, newId()));
  }

  duplicate() {
    const p = this.palette();
    this.add(cleanPalette({ ...p, name: `${p.name} copy` }, newId()));
  }

  add(palette) {
    this.resetDelete();
    this.themes.addCustom(palette);
    this.render();
    this.name.focus();
    this.name.select();
  }

  // Delete asks twice: the first press arms it.
  remove() {
    if (!this.editable()) return;
    if (!this.armed) {
      this.armed = true;
      this.deleteButton.textContent = "Delete — sure?";
      this.disarm = setTimeout(() => this.resetDelete(), 4000);
      return;
    }
    const name = this.palette().name;
    this.resetDelete();
    this.themes.deleteCustom(this.palette().id);
    this.render();
    this.focusPalette();
    this.say(`Deleted “${name}”.`);
  }

  resetDelete() {
    clearTimeout(this.disarm);
    this.armed = false;
    this.deleteButton.textContent = "Delete";
  }

  exportTheme() {
    const p = this.palette();
    this.download(themeFile(p), themeFileName(p), "application/json");
    this.say(`Saved “${p.name}” as a theme file.`);
  }

  async importFile() {
    const file = this.file.files[0];
    this.file.value = "";
    if (!file) return;
    try {
      const palette = parseThemeFile(await file.text());
      this.resetDelete();
      this.themes.addCustom(palette);
      this.render();
      this.focusPalette();
      this.say(`Imported “${palette.name}”.`);
    } catch (err) {
      this.say(err.message);
    }
  }

  say(message) {
    this.status.textContent = message;
  }
}
