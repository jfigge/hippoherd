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

// policy.js — what a viewer's page may load and where it may go, decided
// without Electron.
//
// Each viewer is served from its own origin, viewhippo://<id>/, by the
// protocol handler in main.js. Its own origin and not file://, because every
// file:// page shares ONE origin: two viewers would share localStorage, and a
// viewer could fetch the other's files. resolveAppFile() maps a request to a
// file inside that viewer's directory, or refuses it.
//
// The viewers were written for a browser tab, where a link to GitHub replaces
// the page. In a desktop window that would strand the user on github.com with
// no address bar to come back by, so classifyNavigation() answers one of:
//
//   "app"       the viewer's own page (a reload, in effect): let it load
//   "external"  http(s) or mailto: hand it to the system browser / mail app
//   "deny"      anything else — another viewer, another file, data:, blob:,
//               javascript:, file:, a custom scheme — goes nowhere
//
// A viewer may also have plugins of the user's own, in a folder per viewer
// that the host's bridge offers it (host-preload.js). They are served on the
// viewer's own origin, under /@plugins/, so the page's `script-src 'self'`
// lets it import them. findPlugins() lists them.
//
// No Electron, so `node --test` covers it: test/desktop.test.mjs.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "viewhippo";
const EXTERNAL = new Set(["http:", "https:", "mailto:"]);

// Under /@plugins/: what a plugin is made of — its modules, and the styles,
// data, fonts and pictures they load — and nothing else from that folder.
const PLUGINS_PREFIX = "/@plugins/";
const PLUGIN_FILES = new Set([
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".woff",
  ".woff2",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

// hippoherd.com's page ABOUT a viewer lives inside its directory
// (website/<id>/about/). It is a page of the site, not part of the viewer:
// the stage leaves it out, and this keeps `make desktop` (which serves
// website/ in place) honest about that.
const NOT_SERVED = new Set(["about"]);

/**
 * The page a viewer's document loads. `desktop=<version>` is what JsonHippo's
 * and MarkHippo's own shells already pass (their About shows it);
 * `host=viewhippo` tells a viewer it is inside ViewHippo rather than its own
 * shell or a tab, for anything it wants to do differently there.
 *
 * `chrome` is how much of its own header the viewer should show
 * (features/viewhippo-app-build-brief.md, "Host chrome"): "tabs" when the
 * app's tab strip carries the viewer's logo, the Hippo Herd and GitHub links
 * and the theme, so the viewer hides them; "full" when there is no strip. The
 * viewer copies it to <html data-viewhippo-chrome> before first paint, and the
 * host changes that attribute when the setting changes.
 */
function viewerUrl(viewerId, version, chrome = "full") {
  const url = new URL(`${SCHEME}://${viewerId}/index.html`);
  if (version) url.searchParams.set("desktop", version);
  url.searchParams.set("host", "viewhippo");
  url.searchParams.set("chrome", chrome === "tabs" ? "tabs" : "full");
  return url.toString();
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Classify a URL a viewer's page wants to navigate to or open.
 *
 * @param {string} url       the URL Chromium is about to load
 * @param {string} viewerId  the viewer that window belongs to
 * @returns {"app"|"external"|"deny"}
 */
function classifyNavigation(url, viewerId) {
  const target = parse(url);
  if (!target) return "deny";
  if (EXTERNAL.has(target.protocol)) return "external";
  if (target.protocol !== `${SCHEME}:` || target.host !== viewerId) return "deny";
  return target.pathname === "/" || target.pathname === "/index.html" ? "app" : "deny";
}

// `rel` resolved inside `root`, or null if it would climb out.
function inside(root, rel) {
  const base = path.resolve(root);
  const file = path.resolve(base, `./${rel}`);
  return file.startsWith(base + path.sep) ? file : null;
}

/**
 * The file a viewhippo:// request names, or null when it names nothing the
 * app serves: an unknown viewer, a path that climbs out of the viewer's
 * directory, or the site's about/ page. /@plugins/… is the viewer's folder
 * in `pluginsDir` instead, and only a plugin's kinds of file.
 *
 * @param {string}   url          the request URL
 * @param {string}   webDir       absolute path of the directory holding <id>/ dirs
 * @param {string[]} viewerIds    the viewers in this build
 * @param {string}   [pluginsDir] absolute path of the directory holding each
 *                                viewer's plugins folder, <id>/; none, no plugins
 * @returns {string|null}         an absolute path (not checked for existence)
 */
function resolveAppFile(url, webDir, viewerIds, pluginsDir = null) {
  const target = parse(url);
  if (!target || target.protocol !== `${SCHEME}:` || !viewerIds.includes(target.host)) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(target.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;

  if (pathname.startsWith(PLUGINS_PREFIX)) {
    if (!pluginsDir) return null;
    const file = inside(path.join(pluginsDir, target.host), pathname.slice(PLUGINS_PREFIX.length));
    return file && PLUGIN_FILES.has(path.extname(file).toLowerCase()) ? file : null;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const root = path.resolve(webDir, target.host);
  const file = inside(root, pathname);
  if (!file) return null;

  const first = path.relative(root, file).split(path.sep)[0];
  if (NOT_SERVED.has(first)) return null;
  return file;
}

/**
 * The plugins in one viewer's folder, as the page imports them: each .js or
 * .mjs file in it, and each folder holding an index.js or index.mjs, by name.
 * Hidden entries are skipped; a folder that does not exist yet has none.
 *
 * @param {string} dir       the viewer's plugins folder
 * @param {string} viewerId  the viewer, whose origin serves them
 * @returns {Promise<{name: string, url: string}[]>}
 */
async function findPlugins(dir, viewerId) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const url = (rel) => `${SCHEME}://${viewerId}${PLUGINS_PREFIX}${rel.split("/").map(encodeURIComponent).join("/")}`;
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile() && /\.m?js$/i.test(entry.name)) {
      found.push({ name: entry.name, url: url(entry.name) });
    } else if (entry.isDirectory()) {
      const index = ["index.js", "index.mjs"].find((f) => fs.existsSync(path.join(dir, entry.name, f)));
      if (index) found.push({ name: entry.name, url: url(`${entry.name}/${index}`) });
    }
  }
  return found;
}

module.exports = { SCHEME, viewerUrl, classifyNavigation, resolveAppFile, findPlugins };
