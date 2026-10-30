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

/**
 * viewhippo.js — window.hippoViewer, the API ViewHippo drives MarkHippo
 * through.
 *
 * ViewHippo is the herd's desktop app, built in the hippoherd repository (the
 * contract is its features/viewhippo-app-build-brief.md). It hosts this page
 * as it is, with ?host=viewhippo, and calls these methods with
 * executeJavaScript: there is no Electron, IPC or Node here, and in a browser
 * tab nothing calls them. MarkHippo's own desktop app is a different shell,
 * with its own bridge (desktop.js), and does not use this.
 *
 * The host's view of the document is the markdown, exactly as Save should
 * write it. ViewHippo converts nothing to or from Markdown, so exportAs
 * hands back the text as it is: HTML, PDF and the rest stay MarkHippo's own
 * Export menu.
 *
 * Every method returns plain data, which the host gets a copy of.
 */

export const FORMATS = { reads: ["markdown"], writes: ["markdown"] };
export const MODES = ["system", "light", "dark"];

/**
 * The API over an app with load(text, name), a `text` getter,
 * setTheme(mode) and showAbout().
 */
export function createHippoViewer(app) {
  return {
    formats: { reads: [...FORMATS.reads], writes: [...FORMATS.writes] },

    /** Replace the document. Resolves once it is shown. */
    async load(text, { name = null } = {}) {
      await app.load(String(text), name || "untitled.md");
    },

    getText() {
      return app.text;
    },

    /** Markdown is all MarkHippo writes here, and any text is markdown. */
    exportAs(format) {
      if (!FORMATS.writes.includes(format)) {
        throw new Error(`MarkHippo can't export ${format} here: use its Export menu for HTML, PDF and the rest.`);
      }
      return { text: app.text, dropped: [] };
    },

    /** The light/dark mode; the palette (Themes) is MarkHippo's own. */
    setTheme(mode) {
      if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}": use ${MODES.join(", ")}.`);
      app.setTheme(mode);
    },

    /**
     * Open the About dialog. Its way in, the brand hippo, is hidden while
     * ViewHippo's tab strip shows; the app offers Help → About instead.
     */
    showAbout() {
      app.showAbout();
    },
  };
}

/**
 * ViewHippo's bridge the other way (window.viewHippoHost, its
 * host-preload.js): what the app does for the page that a browser tab cannot.
 * MarkHippo takes the parts its own desktop app's bridge (desktop.js) also
 * gives: it says when the text changes, and the app saves exports where the
 * user chooses, prints, makes PDFs and loads the user's own plugins. Null in
 * a browser tab, in MarkHippo's own desktop app, and in a ViewHippo without
 * the bridge.
 */
export const host = globalThis.viewHippoHost ?? null;

/** Publish the API on `target` and tell the host it is ready. Call once the app has started. */
export function installHippoViewer(app, target = window) {
  target.hippoViewer = createHippoViewer(app);
  target.dispatchEvent(new Event("hippoviewer-ready"));
}
