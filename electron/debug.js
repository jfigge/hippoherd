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

// debug.js — `make debug`: ViewHippo with DevTools open and hot reload.
//
// Development only. main.js loads it when VIEWHIPPO_DEBUG=1 in an unpackaged
// run, and never in a packaged build. It adds:
//
//   * DevTools in every window (VIEWHIPPO_DEVTOOLS: right, bottom, undocked,
//     detach or none), and each viewer's console echoed to the terminal,
//     prefixed with the viewer's id.
//   * Viewer hot reload. A change under website/<id>/ (a viewer's `make site`,
//     or a hand edit while chasing a bug) reloads that viewer's windows, each
//     handed back the document it held. A viewer published for the first time
//     restarts the host, which only looks for viewers at startup.
//   * Host hot restart. An edit to electron/*.js restarts the host. The open
//     documents are written to a session file first, and the new process
//     reopens them, unsaved edits included. The restart itself is the
//     Makefile's: this process exits with RESTART_EXIT_CODE and `make debug`
//     runs Electron again. An edit that doesn't parse is reported, and the
//     running host is kept.
//
// No Electron require here: main.js passes in what this needs, so the pure
// parts run under `node --test`.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wrap } = require("node:module");

// `make debug` runs Electron again on this code, and stops on any other.
const RESTART_EXIT_CODE = 75;

// rsync --delete and editors' atomic saves fire bursts of events; act once
// the burst has settled.
const SETTLE_MS = 300;

// A restart takes seconds. A session file older than this is left over from a
// host that never came back, and isn't restored into a later, fresh run.
const SESSION_FILE = "debug-session.json";
const SESSION_MAX_AGE_MS = 60_000;

// How long a restart waits for each window's text before saving the session.
const SNAPSHOT_TIMEOUT_MS = 1000;

const DEVTOOLS_MODES = ["right", "bottom", "undocked", "detach"];

/**
 * The viewer a change under website/ belongs to, or null. `filename` is
 * relative to website/; `about/` is the site's page about the viewer, which
 * the app never serves.
 */
function viewerOfChange(filename, ids) {
  if (!filename) return null;
  const [id, sub] = String(filename).split(/[\\/]/);
  return ids.includes(id) && sub !== "about" ? id : null;
}

/** The host's .js files in `dir` that don't parse, one message each. */
function syntaxErrors(dir) {
  const errors = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const filename = path.join(dir, name);
    try {
      // Wrapped as Node wraps a CommonJS module, on the same first line, so
      // the line numbers are the file's.
      new vm.Script(wrap(fs.readFileSync(filename, "utf8")), { filename });
    } catch (err) {
      errors.push(`${String(err.stack).split("\n")[0]} — ${err.message}`);
    }
  }
  return errors;
}

/** `fn`, called once events stop arriving for SETTLE_MS, with the last call's arguments. */
function settle(fn) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), SETTLE_MS);
  };
}

const log = (...args) => console.log("[debug]", ...args);

/** DevTools, and the page's console in the terminal. Called for every new window. */
function instrument(win, viewerId) {
  const mode = process.env.VIEWHIPPO_DEVTOOLS || "right";
  if (DEVTOOLS_MODES.includes(mode)) win.webContents.openDevTools({ mode, activate: false });

  win.webContents.on("console-message", (event) => {
    const where = event.sourceId ? ` (${event.sourceId.replace(/^viewhippo:\/\/[^/]+\//, "")}:${event.lineNumber})` : "";
    const line = `[${viewerId}] ${event.message}${where}`;
    if (event.level === "error") console.error(line);
    else if (event.level === "warning") console.warn(line);
    else console.log(line);
  });
}

// ── The session a restart hands to the next host ─────────────────────────────

async function snapshot(host) {
  return Promise.all(
    [...host.docs].map(async ([win, doc]) => {
      const formats = await host.withTimeout(doc.ready, SNAPSHOT_TIMEOUT_MS, null);
      const text = formats
        ? await host.withTimeout(host.callViewer(win, "getText").catch(() => ({})), SNAPSHOT_TIMEOUT_MS, {})
        : {};
      return {
        viewer: doc.viewer,
        filePath: doc.filePath,
        suggestedName: doc.suggestedName,
        savedText: doc.savedText,
        delivered: doc.delivered,
        text: typeof text.value === "string" ? text.value : null,
        bounds: win.isDestroyed() ? null : win.getBounds(),
      };
    }),
  );
}

/** Reopen the documents a restart saved. Resolves once each has its text back. */
async function restoreSession(host) {
  const file = path.join(host.app.getPath("userData"), SESSION_FILE);
  let session;
  try {
    const fresh = Date.now() - fs.statSync(file).mtimeMs < SESSION_MAX_AGE_MS;
    session = fresh ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    fs.rmSync(file, { force: true });
  } catch {
    return; // No restart to resume.
  }
  if (!Array.isArray(session)) return;

  const reopened = session.filter((d) => d && host.available.includes(d.viewer));
  log(`reopening ${reopened.length} document(s) from the last host`);
  await Promise.all(
    reopened.map(async (d) => {
      const win = host.createWindow(d.viewer, { suggestedName: d.suggestedName });
      if (d.bounds) win.setBounds(d.bounds);
      const doc = host.docs.get(win);
      doc.filePath = d.filePath || null;
      host.updateTitle(win);
      // An untouched new window starts over as one; anything else gets its
      // text back, and keeps the saved state it had, so unsaved stays unsaved.
      if (typeof d.text !== "string" || (!d.delivered && d.text === d.savedText)) return;
      await host.deliver(win, d.text, path.basename(d.filePath || d.suggestedName), { saved: false });
      doc.savedText = d.savedText;
    }),
  );
}

// ── Watching ─────────────────────────────────────────────────────────────────

/**
 * Start hot reload. `host` is main.js's: app, webDir, appDir, ids (every
 * viewer the router knows), available (those in this run), docs, createWindow,
 * deliver, callViewer, reloadViewer, updateTitle, withTimeout.
 */
function watch(host) {
  const { app, webDir, appDir } = host;
  const sessionFile = path.join(app.getPath("userData"), SESSION_FILE);
  let restarting = false;

  async function restart(reason) {
    if (restarting) return;
    const errors = syntaxErrors(appDir);
    if (errors.length) {
      console.error(`[debug] ${reason}, but the host doesn't parse; keeping the one running:\n  ${errors.join("\n  ")}`);
      return;
    }
    restarting = true;
    log(`${reason}: restarting the host`);
    try {
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify(await snapshot(host)));
    } catch (err) {
      // Exiting now would lose unsaved edits. Keep running instead.
      console.error("[debug] couldn't save the open documents, so not restarting:", err);
      restarting = false;
      return;
    }
    app.exit(RESTART_EXIT_CODE);
  }
  const restartSoon = settle(restart);

  const reloads = new Map();
  function reloadSoon(id) {
    if (!reloads.has(id)) {
      reloads.set(
        id,
        settle(() => {
          const wins = [...host.docs].filter(([, doc]) => doc.viewer === id).map(([win]) => win);
          if (!wins.length) return;
          log(`website/${id}/ changed: reloading ${wins.length} window(s)`);
          for (const win of wins) host.reloadViewer(win).catch((err) => console.error("[debug] reload failed:", err));
        }),
      );
    }
    reloads.get(id)();
  }

  const onError = (dir) => (err) => console.error(`[debug] stopped watching ${dir}:`, err.message);

  fs.watch(webDir, { recursive: true }, (_event, filename) => {
    const id = viewerOfChange(filename, host.ids);
    if (!id) return;
    if (host.available.includes(id)) reloadSoon(id);
    else if (fs.existsSync(path.join(webDir, id, "index.html"))) restartSoon(`website/${id}/ was published`);
  }).on("error", onError(webDir));

  fs.watch(appDir, (_event, filename) => {
    if (filename && String(filename).endsWith(".js")) restartSoon(`electron/${filename} changed`);
  }).on("error", onError(appDir));

  log(`watching ${webDir} (viewers) and ${appDir} (host)`);
}

module.exports = { RESTART_EXIT_CODE, viewerOfChange, syntaxErrors, instrument, restoreSession, watch };
