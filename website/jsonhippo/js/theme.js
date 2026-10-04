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
