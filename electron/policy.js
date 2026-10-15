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
// Pure (no Electron), so `node --test` covers it: test/desktop.test.mjs.
"use strict";

const path = require("node:path");

const SCHEME = "viewhippo";
const EXTERNAL = new Set(["http:", "https:", "mailto:"]);

// hippoherd.com's page ABOUT a viewer lives inside its directory
// (website/<id>/about/). It is a page of the site, not part of the viewer:
// the stage leaves it out, and this keeps `make desktop` (which serves
// website/ in place) honest about that.
const NOT_SERVED = new Set(["about"]);

/**
 * The page a viewer's window loads. `desktop=<version>` is what JsonHippo's
 * and MarkHippo's own shells already pass (their About shows it);
 * `host=viewhippo` tells a viewer it is inside ViewHippo rather than its own
 * shell or a tab, for anything it wants to do differently there.
 */
function viewerUrl(viewerId, version) {
  const url = new URL(`${SCHEME}://${viewerId}/index.html`);
  if (version) url.searchParams.set("desktop", version);
  url.searchParams.set("host", "viewhippo");
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

/**
 * The file a viewhippo:// request names, or null when it names nothing the
 * app serves: an unknown viewer, a path that climbs out of the viewer's
 * directory, or the site's about/ page.
 *
 * @param {string}   url        the request URL
 * @param {string}   webDir     absolute path of the directory holding <id>/ dirs
 * @param {string[]} viewerIds  the viewers in this build
 * @returns {string|null}       an absolute path (not checked for existence)
 */
function resolveAppFile(url, webDir, viewerIds) {
  const target = parse(url);
  if (!target || target.protocol !== `${SCHEME}:` || !viewerIds.includes(target.host)) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(target.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  if (pathname.endsWith("/")) pathname += "index.html";

  const root = path.resolve(webDir, target.host);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) return null;

  const first = path.relative(root, file).split(path.sep)[0];
  if (NOT_SERVED.has(first)) return null;
  return file;
}

module.exports = { SCHEME, viewerUrl, classifyNavigation, resolveAppFile };
