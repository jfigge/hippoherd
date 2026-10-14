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
 * theme-manager.js — which palette, which mode, and putting them on the
 * page.
 *
 * Two independent choices: the MODE (System, Light, Dark — the header
 * button) and the PALETTE (Hippo, the plugins' palettes, the user's own —
 * the Themes dialog). The page gets the chosen palette's colours for the
 * resolved mode as custom properties on <html>; they override the defaults
 * in the stylesheets. The colours are also cached for js/theme.js, which
 * puts them on the page before the first paint next time.
 *
 * Storage: markhippo.theme (the mode), markhippo.palette (the palette id),
 * markhippo.themes (the user's palettes), markhippo.theme.vars (the cache).
 */

import { HIPPO } from "./themes/palettes.js";
import { TOKEN_NAMES, cleanVariant } from "./themes/tokens.js";
import { isCustom, loadCustom } from "./themes/store.js";

export const MODES = ["system", "light", "dark"];
const KEYS = { mode: "markhippo.theme", palette: "markhippo.palette", custom: "markhippo.themes", cache: "markhippo.theme.vars" };

export class ThemeManager {
  // `storage`: { get(key), set(key, value) }; `registry`: () => the plugin
  // registry, whose `themes` the plugins registered.
  constructor({ storage, registry }) {
    this.storage = storage;
    this.registry = registry;
    this.root = document.documentElement;
    this.mode = MODES.includes(storage.get(KEYS.mode)) ? storage.get(KEYS.mode) : "system";
    this.paletteId = storage.get(KEYS.palette) || HIPPO.id;
    this.custom = loadCustom(storage.get(KEYS.custom));
    // While the theme editor shows one mode of a palette, whatever the
    // user's mode: { palette, mode }.
    this.preview = null;
    this.listeners = new Set();
    this.media = window.matchMedia("(prefers-color-scheme: dark)");
    this.media.addEventListener("change", () => {
      if (this.mode === "system") this.apply();
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  // Every palette there is: Hippo, the plugins', the user's.
  palettes() {
    const fromPlugins = [...(this.registry()?.themes?.values() ?? [])].map((p) => ({
      ...p,
      light: cleanVariant(p.light, HIPPO.light),
      dark: cleanVariant(p.dark, HIPPO.dark),
    }));
    return [HIPPO, ...fromPlugins, ...this.custom];
  }

  find(id) {
    return this.palettes().find((p) => p.id === id) ?? null;
  }

  // The palette in use: the chosen one, or Hippo if it is gone (its plugin
  // switched off, say — switch it back on and the choice returns).
  current() {
    return this.find(this.paletteId) ?? HIPPO;
  }

  resolvedMode() {
    if (this.mode !== "system") return this.mode;
    return this.media.matches ? "dark" : "light";
  }

  setMode(mode) {
    this.mode = MODES.includes(mode) ? mode : "system";
    this.storage.set(KEYS.mode, this.mode);
    this.apply();
  }

  choose(id) {
    if (!this.find(id)) return;
    this.paletteId = id;
    this.storage.set(KEYS.palette, id);
    this.apply();
  }

  // ── The user's palettes ──────────────────────────────────────────────────

  saveCustom() {
    this.storage.set(KEYS.custom, JSON.stringify(this.custom));
  }

  addCustom(palette) {
    this.custom.push(palette);
    this.saveCustom();
    this.choose(palette.id);
  }

  updateCustom(id, change) {
    const palette = this.custom.find((p) => p.id === id);
    if (!palette) return;
    change(palette);
    this.saveCustom();
    this.apply();
  }

  deleteCustom(id) {
    this.custom = this.custom.filter((p) => p.id !== id);
    this.saveCustom();
    if (this.paletteId === id) this.choose(HIPPO.id);
    else this.apply();
  }

  isCustom(id) {
    return isCustom({ id });
  }

  // ── Putting it on the page ───────────────────────────────────────────────

  setPreview(preview) {
    this.preview = preview;
    this.apply();
  }

  apply() {
    const palette = this.preview ? (this.find(this.preview.palette) ?? this.current()) : this.current();
    const mode = this.preview ? this.preview.mode : this.resolvedMode();
    const vars = palette[mode];
    for (const name of TOKEN_NAMES) this.root.style.setProperty(name, vars[name]);
    this.root.style.colorScheme = mode;
    // The stylesheets' own light/dark defaults follow too.
    this.root.dataset.theme = mode;
    // The chosen palette (not a preview) for the next first paint — written
    // during previews too, since edits happen then.
    const active = this.current();
    this.storage.set(KEYS.cache, JSON.stringify({ light: active.light, dark: active.dark }));
    for (const fn of this.listeners) fn();
  }
}
