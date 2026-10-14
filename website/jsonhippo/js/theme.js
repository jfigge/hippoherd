/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of JsonHippo.
 *
 * JsonHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * JsonHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with JsonHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * theme.js — a classic script, loaded in <head> before the stylesheet paints,
 * so a pinned theme is applied before the first frame instead of flashing
 * from the system theme to the saved one. The toggle itself lives in app.js.
 */
(function applySavedTheme() {
  "use strict";
  try {
    var theme = window.localStorage.getItem("jsonhippo.theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch {
    // Storage blocked (privacy mode, file://): follow the system theme.
  }
})();
