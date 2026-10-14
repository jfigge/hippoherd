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
 * palettes.js — the Hippo palette: MarkHippo's own colours, the default.
 *
 * Its dark mode is the Hippo family's palette (the one hippoherd.com uses)
 * and its light mode the daylight counterpart, with the brand orange as the
 * accent. These are the same values app.css and syntax.css carry as their
 * defaults, for the first paint before any script has run; keep them in
 * step. Other palettes come from plugins (`api.theme`), the bundled ones
 * from plugins/themes/.
 */

export const HIPPO = {
  id: "hippo",
  name: "Hippo",
  light: {
    "--bg": "#ffffff",
    "--mantle": "#f6f6f8",
    "--crust": "#ececf0",
    "--surface-0": "#ececf0",
    "--surface-1": "#dcdce2",
    "--surface-2": "#c8c8d0",
    "--code-bg": "#f3f3f5",
    "--text": "#1f1f24",
    "--subtext": "#57575f",
    "--muted": "#6e6e76",
    "--accent": "#a84800",
    "--selection": "#fde4d0",
    "--quote-bar": "#eeb183",
    "--error": "#c4271d",
    "--md-code": "#0f7a80",
    "--tk-keyword": "#8839ef",
    "--tk-string": "#2f7d1f",
    "--tk-number": "#c2410c",
    "--tk-comment": "#62657a",
    "--tk-function": "#1b5ee6",
    "--tk-type": "#9a5800",
    "--tk-property": "#0f7a80",
    "--tk-tag": "#c4122f",
    "--tk-attr": "#8f5600",
    "--tk-variable": "#b4237a",
    "--tk-meta": "#5b50c8",
  },
  dark: {
    "--bg": "#1c1c1c",
    "--mantle": "#161616",
    "--crust": "#101010",
    "--surface-0": "#2a2a2a",
    "--surface-1": "#383838",
    "--surface-2": "#484848",
    "--code-bg": "#242424",
    "--text": "#e8e8e8",
    "--subtext": "#b0b0b0",
    "--muted": "#8a8a8a",
    "--accent": "#ff9a52",
    "--selection": "#4a2a12",
    "--quote-bar": "#80410f",
    "--error": "#ff7b72",
    "--md-code": "#94e2d5",
    "--tk-keyword": "#cba6f7",
    "--tk-string": "#a6e3a1",
    "--tk-number": "#fab387",
    "--tk-comment": "#8b8fa6",
    "--tk-function": "#89b4fa",
    "--tk-type": "#f9e2af",
    "--tk-property": "#94e2d5",
    "--tk-tag": "#f38ba8",
    "--tk-attr": "#eba0ac",
    "--tk-variable": "#f5c2e7",
    "--tk-meta": "#b4befe",
  },
};
