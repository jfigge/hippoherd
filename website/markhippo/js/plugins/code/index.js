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
 * The code plugin: syntax colouring for fenced code, in the preview and the
 * edit pane, for the languages in languages.js. It also suggests those
 * languages for a fence's info string.
 *
 * It only registers languages; the CommonMark plugin's code block renderer
 * and highlighter look a block's language up and use whatever is there. So
 * a third-party plugin adds a language the same way:
 *
 *   api.language({ id: "lua", name: "Lua", aliases: [], tokenize(code) { … } })
 */

import { LANGUAGES } from "./languages.js";

// Each language once, found by any of its names.
const SUGGESTIONS = LANGUAGES.map((lang) => ({
  label: lang.id,
  detail: lang.name,
  keywords: [lang.name, ...lang.aliases],
  insert: lang.id,
}));

export default {
  id: "code",
  name: "Code highlighting",
  version: "1.0.0",
  description: "Colours fenced code in the preview and the editor: JavaScript, TypeScript, JSON, YAML, Python, HTML, CSS, shell, SQL, C, C++, C#, Java, Kotlin, Go, Rust, Swift, INI/TOML, Dockerfile and diffs.",
  setup(api) {
    for (const lang of LANGUAGES) api.language(lang);
    api.completions({
      context: "fence-info",
      provide: () => SUGGESTIONS,
    });
  },
};
