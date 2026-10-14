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
 * store.js — themes the user made: kept, checked, and shared as files.
 *
 * A custom theme is a palette like any other ({ id, name, light, dark });
 * custom ones have ids starting "custom-". Anything read back — from
 * storage or from a file someone sent — is cleaned with cleanVariant()
 * before use: only known tokens, only #rrggbb colours, so a theme can
 * colour the page but never inject anything into it.
 *
 * Theme files are JSON:
 *
 *   { "markhippo-theme": 1, "name": "…", "light": { "--bg": "#…", … }, "dark": { … } }
 *
 * Rest Hippo's theme files (one mode, its own token names) import too; the
 * one mode they have is used for both, ready to be adjusted.
 */

import { HIPPO } from "./palettes.js";
import { cleanVariant, validColours } from "./tokens.js";

export const CUSTOM = "custom-";
const MAX_NAME = 60;

export const isCustom = (palette) => typeof palette?.id === "string" && palette.id.startsWith(CUSTOM);

export function newId() {
  return CUSTOM + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// A palette from untrusted data, made whole and safe — or null.
export function cleanPalette(data, id = data?.id) {
  if (!data || typeof data !== "object") return null;
  const name = String(data.name ?? "").trim().slice(0, MAX_NAME) || "Untitled theme";
  return {
    id: typeof id === "string" && id.startsWith(CUSTOM) ? id : newId(),
    name,
    light: cleanVariant(data.light, HIPPO.light),
    dark: cleanVariant(data.dark, HIPPO.dark),
  };
}

// The custom themes saved in storage, as JSON text (or null).
export function loadCustom(json) {
  let list;
  try {
    list = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const palette = cleanPalette(entry);
    if (palette && !seen.has(palette.id)) {
      seen.add(palette.id);
      out.push(palette);
    }
  }
  return out;
}

// A theme as a file's text.
export function themeFile(palette) {
  return JSON.stringify({ "markhippo-theme": 1, name: palette.name, light: palette.light, dark: palette.dark }, null, 2) + "\n";
}

// A file name for a theme: its name, made safe.
export function themeFileName(palette) {
  const base = palette.name.replace(/[^A-Za-z0-9_\- ]+/g, "_").trim() || "theme";
  return `${base}.markhippo-theme.json`;
}

// A theme file's text → a new custom palette. Throws an Error saying what
// is wrong with a file that is not a theme.
export function parseThemeFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not JSON, so it can't be a theme.");
  }
  if (!data || typeof data !== "object") throw new Error("This file is not a theme.");
  const none = new Error("This file has no colours MarkHippo knows in it.");
  if (data.light || data.dark) {
    if (validColours(data.light) + validColours(data.dark) === 0) throw none;
    return cleanPalette({ name: data.name, light: data.light ?? data.dark, dark: data.dark ?? data.light }, null);
  }
  if (data.vars && typeof data.vars === "object") {
    const mode = data.colorScheme === "light" ? "light" : "dark";
    const known = Object.fromEntries(Object.entries(REST_HIPPO).map(([ours, theirs]) => [ours, data.vars[theirs]]));
    if (validColours(known) === 0) throw none;
    const vars = fromRestHippo(data.vars, mode);
    return cleanPalette({ name: data.name ?? "Rest Hippo theme", light: vars, dark: vars }, null);
  }
  throw none;
}

// Rest Hippo's tokens → MarkHippo's. Its syntax colours are its semantic
// ones (success, warning…), so they map the way its Prism styles do.
const REST_HIPPO = {
  "--bg": "--color-base",
  "--mantle": "--color-mantle",
  "--crust": "--color-crust",
  "--surface-0": "--color-surface-0",
  "--surface-1": "--color-surface-1",
  "--surface-2": "--color-surface-2",
  "--code-bg": "--color-mantle",
  "--text": "--color-text",
  "--subtext": "--color-subtext",
  "--muted": "--color-overlay-1",
  "--accent": "--color-accent",
  "--selection": "--color-surface-1",
  "--quote-bar": "--color-surface-2",
  "--error": "--color-error",
  "--md-code": "--color-info",
  "--tk-keyword": "--color-accent",
  "--tk-string": "--color-success",
  "--tk-number": "--color-warning",
  "--tk-comment": "--color-overlay-1",
  "--tk-function": "--color-info",
  "--tk-type": "--color-warning",
  "--tk-property": "--color-accent",
  "--tk-tag": "--color-error",
  "--tk-attr": "--color-accent-dim",
  "--tk-variable": "--color-warning",
  "--tk-meta": "--color-subtext",
};

function fromRestHippo(vars, mode) {
  const fallback = HIPPO[mode];
  const out = {};
  for (const [ours, theirs] of Object.entries(REST_HIPPO)) out[ours] = vars[theirs] ?? fallback[ours];
  return out;
}
