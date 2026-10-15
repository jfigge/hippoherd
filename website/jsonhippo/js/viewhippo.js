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

/**
 * viewhippo.js — window.hippoViewer, the API ViewHippo drives JsonHippo through.
 *
 * ViewHippo is the herd's desktop app, built in the hippoherd repository (the
 * contract is its features/viewhippo-app-build-brief.md). It hosts this page
 * unchanged and calls these methods with executeJavaScript: there is no
 * Electron, IPC or Node here, and in a browser tab nothing calls them.
 *
 * The host's view of the document is the text, exactly as Save should write
 * it. load() takes the same path as the Text tab's file button (App.load),
 * not the paste path: a file is opened as it is, never unescaped.
 *
 * Every method returns plain data. Whatever the host gets back is cloned
 * across to it, so a parse result (the AST) must never leak out.
 */

import { parse } from "./parser/parser.js";
import { JsonHippoError } from "./parser/errors.js";

export const FORMATS = { reads: ["json"], writes: ["json"] };
export const THEMES = ["system", "light", "dark"];

/**
 * The API over an app with load(text, name) → Promise, a `text` getter and
 * setTheme(theme).
 */
export function createHippoViewer(app) {
  return {
    formats: { reads: [...FORMATS.reads], writes: [...FORMATS.writes] },

    /** Replace the document. Resolves once it is validated and shown. */
    async load(text, { name = null } = {}) {
      await app.load(String(text), name);
    },

    getText() {
      return app.text;
    },

    /**
     * JsonHippo writes JSON only, so this is the text as it stands, once it
     * is known to parse. Nothing is reformatted and nothing is lost.
     */
    exportAs(format) {
      if (!FORMATS.writes.includes(format)) {
        throw new Error(`JsonHippo can't export ${format}; it writes JSON only.`);
      }
      const text = app.text;
      try {
        parse(text);
      } catch (err) {
        if (!(err instanceof JsonHippoError)) throw err;
        throw new Error(err.toString(), { cause: err });
      }
      return { text, dropped: [] };
    },

    setTheme(mode) {
      if (!THEMES.includes(mode)) throw new Error(`Unknown theme "${mode}": use ${THEMES.join(", ")}.`);
      app.setTheme(mode);
    },
  };
}

/** Publish the API on `target` and tell the host it is ready. Call once the app has booted. */
export function installHippoViewer(app, target = window) {
  target.hippoViewer = createHippoViewer(app);
  target.dispatchEvent(new Event("hippoviewer-ready"));
}
