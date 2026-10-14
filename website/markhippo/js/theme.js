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
 * theme.js — a classic script, loaded in <head> before the stylesheets
 * paint, so the saved theme is on the page from the first frame instead of
 * flashing from the default to it. It reads two things app.js saves:
 *
 *   markhippo.theme       the mode: "light", "dark" or "system" (or unset)
 *   markhippo.theme.vars  the chosen palette's colours, { light, dark }
 *
 * and puts the colours for the resolved mode on <html>, as
 * js/theme-manager.js does once the app is running. Only custom properties
 * with #rrggbb values are applied, whatever is in storage.
 */
(function applySavedTheme() {
  "use strict";
  var root = document.documentElement;
  try {
    var mode = window.localStorage.getItem("markhippo.theme");
    if (mode !== "light" && mode !== "dark") {
      mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    root.dataset.theme = mode;
    var cached = JSON.parse(window.localStorage.getItem("markhippo.theme.vars") || "null");
    var vars = cached && cached[mode];
    if (!vars || typeof vars !== "object") return;
    for (var name in vars) {
      if (/^--[a-z0-9-]+$/.test(name) && /^#[0-9a-f]{6}$/i.test(vars[name])) root.style.setProperty(name, vars[name]);
    }
    root.style.colorScheme = mode;
  } catch {
    // Storage blocked (privacy mode, file://) or unreadable: the defaults
    // in the stylesheets follow the system.
  }
})();
