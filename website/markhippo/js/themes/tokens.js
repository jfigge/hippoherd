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
 * tokens.js — what a theme is made of, and the colour arithmetic the theme
 * editor needs.
 *
 * A theme (a "palette") is
 *
 *   { id, name, light: { "--bg": "#ffffff", … }, dark: { … } }
 *
 * — one set of colours for each mode, so every palette can be used light
 * or dark and Light / Dark / System picks between them. Each set gives a
 * value for every token below, as #rrggbb.
 */

export const TOKENS = [
  {
    group: "Surfaces",
    tokens: [
      ["--bg", "Background"],
      ["--mantle", "Header and bars"],
      ["--crust", "Deepest background: minimap"],
      ["--surface-0", "Lines and hover"],
      ["--surface-1", "Borders"],
      ["--surface-2", "Strong borders: hover"],
      ["--code-bg", "Code background"],
    ],
  },
  {
    group: "Text",
    tokens: [
      ["--text", "Text"],
      ["--subtext", "Secondary text"],
      ["--muted", "Muted text and markup"],
    ],
  },
  {
    group: "Accents",
    tokens: [
      ["--accent", "Accent: headings, links"],
      ["--selection", "Selection and highlight"],
      ["--quote-bar", "Quote bar"],
      ["--error", "Errors"],
    ],
  },
  {
    group: "Syntax",
    tokens: [
      ["--md-code", "Markdown code"],
      ["--tk-keyword", "Keywords"],
      ["--tk-string", "Strings"],
      ["--tk-number", "Numbers and literals"],
      ["--tk-comment", "Comments"],
      ["--tk-function", "Functions and links"],
      ["--tk-type", "Types"],
      ["--tk-property", "Properties"],
      ["--tk-tag", "Tags and HTML"],
      ["--tk-attr", "Attributes"],
      ["--tk-variable", "Variables"],
      ["--tk-meta", "Meta and decorators"],
    ],
  },
];

export const TOKEN_NAMES = TOKENS.flatMap((g) => g.tokens.map(([name]) => name));
const KNOWN = new Set(TOKEN_NAMES);

// Text tokens and what they are read against: the theme editor shows the
// worst contrast of each, and every built-in palette keeps them all at
// WCAG AA. Code colours are read on the preview's code background and, in
// the edit pane, on the page background.
const CODE_TOKENS = TOKEN_NAMES.filter((t) => t.startsWith("--tk-"));
export const CONTRAST_PAIRS = [
  ["--text", "--bg"],
  ["--subtext", "--bg"],
  ["--muted", "--bg"],
  ["--accent", "--bg"],
  ["--error", "--bg"],
  ["--md-code", "--bg"],
  ["--md-code", "--code-bg"],
  ...CODE_TOKENS.flatMap((t) => [
    [t, "--code-bg"],
    [t, "--bg"],
  ]),
];

const reHex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// "#ABC", "abc", "#aabbcc" → "#aabbcc"; anything else → null.
export function normalizeHex(value) {
  const m = typeof value === "string" ? value.trim().match(reHex) : null;
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return "#" + hex.toLowerCase();
}

// WCAG relative luminance of a #rrggbb colour.
export function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// WCAG contrast ratio of two #rrggbb colours, 1–21.
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// How many of `vars`' values are known tokens with valid colours.
export function validColours(vars) {
  if (!vars || typeof vars !== "object") return 0;
  return TOKEN_NAMES.filter((name) => normalizeHex(vars[name]) !== null).length;
}

// One mode's colours made whole and safe: only known tokens, only valid
// colours, anything missing taken from `fallback`.
export function cleanVariant(vars, fallback) {
  const out = {};
  for (const name of TOKEN_NAMES) {
    const value = vars && KNOWN.has(name) ? normalizeHex(vars[name]) : null;
    out[name] = value ?? fallback[name];
  }
  return out;
}
