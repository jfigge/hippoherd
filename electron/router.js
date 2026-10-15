/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Hippo Herd.
 *
 * Hippo Herd is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Hippo Herd is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Hippo Herd. If not, see <https://www.gnu.org/licenses/>.
 */

// router.js — which viewer opens which file, decided without Electron.
//
// The app is a host for the herd's viewers and nothing more: each viewer is
// its own static page, built in its own repository and copied to
// website/<id>/ by that repository's `make site`. This table is the only
// thing the host knows about them — a name, the format the viewer owns, the
// extensions that route to it, and its data `model`. A viewer listed here but
// missing from the bundle (website/<id>/index.html absent) is simply switched
// off: main.js passes the ids that ARE present as `available`.
//
// Conversion is offered only between viewers of the same model: JSON and
// YAML share a tree, so each converts to the other; Markdown is a document of
// its own and converts to nothing. See features/viewhippo-app-build-brief.md.
//
// Pure (no Electron), so `node --test` covers it: test/desktop.test.mjs.
"use strict";

const path = require("node:path");

const viewer = (v) => Object.freeze({ ...v, extensions: Object.freeze(v.extensions) });

const VIEWERS = Object.freeze([
  viewer({ id: "jsonhippo", name: "JsonHippo", format: "json", formatName: "JSON", model: "tree", extensions: ["json"] }),
  viewer({ id: "yamlhippo", name: "YamlHippo", format: "yaml", formatName: "YAML", model: "tree", extensions: ["yaml", "yml"] }),
  viewer({
    id: "markhippo",
    name: "MarkHippo",
    format: "markdown",
    formatName: "Markdown",
    model: "document",
    // MarkHippo's own desktop build registers the same five.
    extensions: ["md", "markdown", "mdown", "mkd", "mkdn"],
  }),
]);

const byId = (id) => VIEWERS.find((v) => v.id === id) || null;

/** The extension of a path, lower-cased and without the dot ("" for none). */
function extensionOf(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

/**
 * The viewer registered for a file, whether or not it is in this build.
 * Callers tell "nobody opens .txt" (null) from "YamlHippo is not in this
 * build" (a viewer whose id is not in `available`).
 */
function viewerForFile(filePath) {
  const ext = extensionOf(filePath);
  return VIEWERS.find((v) => v.extensions.includes(ext)) || null;
}

/** The viewer that owns a format ("json", "yaml"), or null. */
function viewerForFormat(format) {
  return VIEWERS.find((v) => v.format === format) || null;
}

/** The registered viewers that are in this build, in table order. */
function availableViewers(available) {
  return VIEWERS.filter((v) => available.includes(v.id));
}

/** The viewers a document in `viewerId` can be converted for, in this build. */
function conversionTargets(viewerId, available) {
  const from = byId(viewerId);
  if (!from) return [];
  return availableViewers(available).filter((v) => v.id !== viewerId && v.model === from.model);
}

/** The viewers in this build that can be converted to: those sharing a model with another. */
function convertibleViewers(available) {
  const viewers = availableViewers(available);
  return viewers.filter((v) => viewers.some((o) => o.id !== v.id && o.model === v.model));
}

/**
 * How to convert a document into `to`, given what its own viewer can write
 * (its hippoViewer.formats.writes). The viewer that owns a format owns its
 * serialiser, so a viewer that cannot write `to` hands its TEXT to the
 * target's viewer, which reads it and writes it back out — JSON is valid
 * YAML, which is what makes the second route work.
 *
 * @returns {"export"|"import"}
 *   "export"  sourceViewer.exportAs(to)
 *   "import"  targetViewer.load(sourceViewer.getText()), then targetViewer.exportAs(to)
 */
function conversionRoute(sourceWrites, to) {
  return Array.isArray(sourceWrites) && sourceWrites.includes(to) ? "export" : "import";
}

/** Open-dialog filters: one for everything this build opens, then one per viewer. */
function openFilters(available) {
  const viewers = availableViewers(available);
  const all = viewers.flatMap((v) => v.extensions);
  return [
    ...(viewers.length > 1 ? [{ name: "All Supported Documents", extensions: all }] : []),
    ...viewers.map((v) => ({ name: `${v.formatName} Documents`, extensions: [...v.extensions] })),
  ];
}

/** A document's file name with its extension replaced by `viewer`'s first. */
function renameFor(fileName, viewer) {
  const base = fileName ? path.basename(fileName, path.extname(fileName)) : "Untitled";
  return `${base}.${viewer.extensions[0]}`;
}

/**
 * electron-builder's fileAssociations for the viewers in this build, so the
 * OS offers the app for exactly the files it can open — never .yaml before
 * YamlHippo ships. scripts/stage-desktop.mjs writes these into the staged
 * package.json.
 */
function fileAssociations(available) {
  return availableViewers(available).map((v) => ({
    ext: [...v.extensions],
    name: `${v.formatName} Document`,
    description: `${v.formatName} Document`,
    role: "Editor",
  }));
}

module.exports = {
  VIEWERS,
  byId,
  extensionOf,
  viewerForFile,
  viewerForFormat,
  availableViewers,
  conversionTargets,
  convertibleViewers,
  conversionRoute,
  openFilters,
  renameFor,
  fileAssociations,
};
