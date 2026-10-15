/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of YamlHippo.
 *
 * YamlHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * YamlHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with YamlHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * viewhippo.js — window.hippoViewer, the API ViewHippo drives YamlHippo through.
 *
 * ViewHippo is the herd's desktop app, built in the hippoherd repository (the
 * contract is its features/viewhippo-app-build-brief.md). It hosts this page
 * unchanged and calls these methods with executeJavaScript: there is no
 * Electron, IPC or Node here, and in a browser tab nothing calls them.
 *
 * The host's view of the document is the text, exactly as Save should write
 * it. load() takes the same path as the Text tab's file button (App.load),
 * not the paste path: a file is opened as it is, never "fixed".
 *
 * YamlHippo reads YAML and JSON (JSON is YAML) and writes both, so it is
 * where ViewHippo's JSON ↔ YAML conversion happens:
 *
 *   exportAs("yaml")  the document as block-style YAML (yaml-emitter.js),
 *                     strings unquoted wherever they read the same without:
 *                     JSON loaded here comes out as YAML. Comments, tags,
 *                     anchors and aliases are kept, so nothing is dropped
 *   exportAs("json")  the first document as JSON (json-export.js), with every
 *                     kind of loss reported: anchors and aliases (expanded),
 *                     comments, the documents after the first, keys that are
 *                     not strings, custom tags, .inf and .nan
 *
 * Every method returns plain data. Whatever the host gets back is cloned
 * across to it, so a parse result (the tree) must never leak out.
 */

import { parse } from "./parser/parser.js";
import { YamlHippoError } from "./parser/errors.js";
import { emitYaml } from "./yaml-emitter.js";
import { describeDropped, toJson } from "./json-export.js";

export const FORMATS = { reads: ["yaml", "json"], writes: ["yaml", "json"] };
export const THEMES = ["system", "light", "dark"];

/** Parse, or throw an Error whose message the user can act on ("Line 12, col 4: …"). */
function parseOrThrow(text) {
  try {
    return parse(text);
  } catch (err) {
    if (!(err instanceof YamlHippoError)) throw err;
    throw new Error(err.toString(), { cause: err });
  }
}

/**
 * `text` written as `format`: { text, dropped: [{ what, where? }] }.
 * Pure: the API below calls it with the app's text and indent.
 */
export function exportText(text, format, { indent = 2 } = {}) {
  if (!FORMATS.writes.includes(format)) {
    throw new Error(`YamlHippo can't export ${format}; it writes ${FORMATS.writes.join(" and ")}.`);
  }
  const result = parseOrThrow(text);
  if (format === "yaml") {
    return { text: emitYaml(result, { indent, flow: false, plain: true }), dropped: [] };
  }

  const [first, second] = result.documents;
  const until = second?.start?.offset ?? Infinity;
  const comments = result.comments.filter((c) => c.offset < until);
  // Comments after the first document went with the documents that are not written.
  const { text: json, dropped } = toJson(first, {
    indent: " ".repeat(indent),
    comments,
    documents: result.documents.length,
    restAt: second?.start ?? null,
  });
  const lines = describeDropped(dropped, { documents: result.documents.length, current: 1 });
  const entries = dropped.map((d, i) => ({ d, what: lines[i].charAt(0).toUpperCase() + lines[i].slice(1) }));
  // In document order; the ones with no place last.
  entries.sort((x, y) => (x.d.at?.offset ?? Infinity) - (y.d.at?.offset ?? Infinity));
  return {
    text: `${json}\n`,
    dropped: entries.map(({ d, what }) => (d.at ? { what, where: `line ${d.at.line}` } : { what })),
  };
}

/**
 * The API over an app with load(text, name) → Promise, a `text` getter, an
 * `indent` getter and setTheme(theme).
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

    exportAs(format) {
      return exportText(app.text, format, { indent: app.indent });
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
