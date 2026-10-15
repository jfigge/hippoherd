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

// main.js — ViewHippo: the desktop app that hosts the herd's viewers.
//
// It owns NO viewer logic. Each viewer (JsonHippo, YamlHippo, MarkHippo) is the same
// static page hippoherd.com serves, copied into web/<id>/ from this repo's
// website/<id>/ by `make desktop-setup`, and loaded unchanged. What the host
// adds is only what a browser tab cannot do:
//
//   * one window per document, routed to the viewer that owns its file type
//     (router.js), with Open, Save, Save As and Open Recent;
//   * Convert to JSON / YAML, done by the viewers themselves — the host only
//     moves text between them (router.js conversionRoute);
//   * an app-wide Appearance, which viewers may honour.
//
// It talks to a viewer through the small API the viewer publishes as
// window.hippoViewer (features/viewhippo-app-build-brief.md, "Artifact &
// viewer contract"), called with executeJavaScript. So, like JsonHippo's old
// standalone shell:
//
//   * The renderer is sandboxed with no preload and no Node.
//   * No request leaves the machine. Every http(s)/ws request is cancelled;
//     a viewer that asks a CDN first falls back to its bundled copy.
//   * Links leave through the system browser, never in the app's windows
//     (policy.js).
//
// CommonJS, like the sibling apps' main processes.
"use strict";

const { app, BrowserWindow, Menu, dialog, nativeTheme, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { SCHEME, viewerUrl, classifyNavigation, resolveAppFile } = require("./policy");
const {
  VIEWERS,
  byId,
  viewerForFile,
  viewerForFormat,
  availableViewers,
  conversionTargets,
  convertibleViewers,
  conversionRoute,
  openFilters,
  renameFor,
} = require("./router");

// `make desktop` runs this file straight from electron/ against the repo's
// website/, so a viewer's `make site` shows up on reload without a package
// step. A packaged build ignores the override and only loads its own copy.
const WEB_DIR =
  !app.isPackaged && process.env.VIEWHIPPO_WEB_DIR
    ? path.resolve(process.env.VIEWHIPPO_WEB_DIR)
    : path.join(__dirname, "web");

// `make debug`: DevTools in every window, and hot reload of the viewers and
// of this host (debug.js). Never in a packaged build.
const debug = !app.isPackaged && process.env.VIEWHIPPO_DEBUG === "1" ? require("./debug") : null;

const HOME_PAGE = "https://hippoherd.com/";
const SOURCE = "https://github.com/jfigge/hippoherd";

// A neutral first-paint colour per theme, so a window does not flash white
// before a dark viewer paints. The viewer's own background replaces it.
const BACKGROUND = { light: "#ffffff", dark: "#1c1c1c" };

// How long to wait for the first paint before showing a window anyway, and
// for a viewer to publish window.hippoViewer before treating it as an old
// build without one.
const SHOW_TIMEOUT_MS = 3000;
const READY_TIMEOUT_MS = 5000;

// How long the unsaved-changes check waits for a viewer's text. A viewer that
// has hung must not make its window impossible to close.
const CLOSE_CHECK_TIMEOUT_MS = 3000;

const THEMES = ["system", "light", "dark"];

// Registered before `ready`, as Electron requires. `standard` gives each
// viewer a real origin (viewhippo://jsonhippo), so relative URLs, ES modules
// and per-viewer localStorage behave as they do on hippoherd.com.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

/** The viewers whose bundle is in this build, decided once at startup. */
const available = VIEWERS.filter((v) => fs.existsSync(path.join(WEB_DIR, v.id, "index.html"))).map((v) => v.id);

/**
 * Every open window's document.
 *   viewer         the id of the viewer showing it
 *   filePath       where it was opened from / last saved to; null if untitled
 *   suggestedName  the name Save offers for an untitled document
 *   savedText      the text as last opened or saved, for the unsaved check;
 *                  for a new document, whatever the viewer starts with (an
 *                  empty box, or MarkHippo's sample), so that is not "unsaved"
 *   delivered      set once the host has handed the viewer a document
 *   ready          resolves to the viewer's `formats` once window.hippoViewer
 *                  exists, or to null for a viewer that never publishes one
 *   closeConfirmed set once the unsaved-changes check has passed
 */
const docs = new Map();

let settings = { theme: "system" };
let quitting = false;

function openExternal(url) {
  shell.openExternal(url).catch((err) => console.error(`[main] could not open ${url}:`, err));
}

// ── Settings: the app's own, which is only the Appearance ────────────────────
// Viewers keep their settings themselves, in their own origin's storage.

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (THEMES.includes(stored.theme)) settings.theme = stored.theme;
  } catch {
    // First launch, or a file we did not write: the defaults stand.
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("[main] could not save settings:", err);
  }
}

// ── The session: offline, and asking for nothing ─────────────────────────────

function lockDownSession() {
  const ses = session.defaultSession;

  // Every network request is cancelled — see the note at the top of the file.
  // viewhippo:// is not matched, so the viewers' own files load as normal.
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );

  // Clipboard writes (the viewers' Copy buttons) are the one permission a
  // viewer asks for. Camera, geolocation, notifications and the rest are
  // refused without a prompt.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });

  // viewhippo://<id>/… → web/<id>/…, and nothing outside it (policy.js).
  protocol.handle(SCHEME, async (request) => {
    const file = resolveAppFile(request.url, WEB_DIR, available);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

// ── Talking to a viewer ──────────────────────────────────────────────────────
// Everything goes through window.hippoViewer, called in the page's own world.
// The call never throws for the viewer's sake: a missing API comes back as
// { missing: true } and a thrown error as { error: "…" }, so every caller
// handles both the same way.

async function callViewer(win, method, ...args) {
  if (win.isDestroyed()) return { error: "The window has closed." };
  const name = JSON.stringify(method);
  return win.webContents.executeJavaScript(
    `(async () => {
      const v = window.hippoViewer;
      if (!v || typeof v[${name}] !== "function") return { missing: true };
      try {
        return { value: await v[${name}](...${JSON.stringify(args)}) };
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    })()`,
    true,
  );
}

// Resolves to the viewer's `formats` (or {} when it gives none) once
// window.hippoViewer exists, or to null if it does not appear in time.
function waitForViewer(win) {
  return win.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const done = () => {
        const v = window.hippoViewer;
        resolve(v ? JSON.parse(JSON.stringify(v.formats || {})) : null);
      };
      if (window.hippoViewer) return done();
      const timer = setTimeout(done, ${READY_TIMEOUT_MS});
      window.addEventListener("hippoviewer-ready", () => { clearTimeout(timer); done(); }, { once: true });
    })`,
    true,
  );
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function showError(win, message, detail) {
  const options = { type: "error", message, detail, buttons: ["OK"] };
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

// A viewer built before the hippoViewer API still opens and works; it just
// cannot be handed a file, saved from, or converted. Said once per window.
function explainMissingApi(win) {
  const doc = docs.get(win);
  if (!doc || doc.warned) return;
  doc.warned = true;
  const viewer = byId(doc.viewer);
  showError(
    win,
    `This build of ${viewer.name} can't exchange documents with ViewHippo yet.`,
    `It predates the viewer API the app uses to open, save and convert files. ` +
      `You can still paste into it, or use its own Load from file button.`,
  );
}

// ── Windows ──────────────────────────────────────────────────────────────────

function displayName(doc) {
  return doc.filePath ? path.basename(doc.filePath) : doc.suggestedName;
}

function updateTitle(win) {
  const doc = docs.get(win);
  if (!doc || win.isDestroyed()) return;
  win.setTitle(`${displayName(doc)} — ${byId(doc.viewer).name}`);
  if (process.platform === "darwin") win.setRepresentedFilename(doc.filePath || "");
}

function focusedDoc() {
  const win = BrowserWindow.getFocusedWindow();
  return win && docs.has(win) ? { win, doc: docs.get(win) } : null;
}

// Sets doc.ready for the page load that is about to happen: the first one, or
// a development reload. Once the viewer is up, it gets the Appearance, and an
// undelivered document takes the viewer's starting text as its saved state.
function trackReady(win, doc) {
  const contents = win.webContents;
  doc.ready = new Promise((resolve) => {
    const stop = () => {
      contents.off("did-finish-load", finished);
      contents.off("did-fail-load", failed);
    };
    const finished = () => {
      stop();
      waitForViewer(win).then(resolve, () => resolve(null));
    };
    // -3 is ERR_ABORTED: a load replaced by a newer one, which fires its own.
    const failed = (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      stop();
      resolve(null);
    };
    contents.on("did-finish-load", finished);
    contents.on("did-fail-load", failed);
  });
  doc.ready.then(async (formats) => {
    if (!formats) return;
    if (settings.theme !== "system") callViewer(win, "setTheme", settings.theme).catch(() => {});
    const start = await callViewer(win, "getText").catch(() => ({}));
    if (!doc.delivered && typeof start.value === "string") doc.savedText = start.value;
  });
  return doc.ready;
}

function createWindow(viewerId, { suggestedName } = {}) {
  const viewer = byId(viewerId);
  const anchor = BrowserWindow.getFocusedWindow();
  const cascade = anchor && !anchor.isDestroyed() ? anchor.getPosition().map((n) => n + 24) : null;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    ...(cascade ? { x: cascade[0], y: cascade[1] } : {}),
    title: viewer.name,
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    // Windows and Linux take the window icon from here; macOS uses the bundle's.
    icon: path.join(__dirname, "icons", "linux", "512x512.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const doc = {
    viewer: viewerId,
    filePath: null,
    suggestedName: suggestedName || renameFor(null, viewer),
    savedText: "",
    delivered: false,
    ready: null,
    warned: false,
    closeConfirmed: false,
  };
  docs.set(win, doc);
  trackReady(win, doc);
  if (debug) debug.instrument(win, viewerId);

  // Show on the first paint, or on whichever fallback arrives first: a failed
  // load or a renderer that dies never fires ready-to-show.
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    clearTimeout(timer);
    win.show();
  };
  const timer = setTimeout(show, SHOW_TIMEOUT_MS);
  win.once("ready-to-show", show);
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[main] load failed: ${url} — ${desc} (${code})`);
    show();
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] renderer gone: ${details.reason}`);
    show();
  });

  // The title is the document's, not the page's.
  win.on("page-title-updated", (event) => event.preventDefault());

  // A link click or a script navigation. Only the viewer's own page loads here.
  win.webContents.on("will-navigate", (event, url) => {
    const verdict = classifyNavigation(url, viewerId);
    if (verdict === "app") return;
    event.preventDefault();
    if (verdict === "external") openExternal(url);
  });

  // window.open and target=_blank: never a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, viewerId) === "external") openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (event) => {
    if (doc.closeConfirmed) return;
    event.preventDefault();
    confirmClose(win).then((ok) => {
      if (!ok) {
        quitting = false;
        return;
      }
      doc.closeConfirmed = true;
      if (!win.isDestroyed()) win.close();
    });
  });

  win.on("focus", refreshMenu);
  win.on("closed", () => {
    docs.delete(win);
    refreshMenu();
  });

  win.loadURL(viewerUrl(viewerId, app.getVersion())).catch((err) => console.error("[main] viewer failed to load:", err));
  updateTitle(win);
  refreshMenu();
  return win;
}

function showWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Development only (View → Reload, and `make debug`'s hot reload): load the
// viewer's page again, to pick up a new `make site`, and hand it back the
// document it held. Unsaved stays unsaved: the saved state is kept as it was.
async function reloadViewer(win) {
  const doc = docs.get(win);
  if (!doc || win.isDestroyed()) return;
  const formats = await withTimeout(doc.ready, CLOSE_CHECK_TIMEOUT_MS, null);
  const held = formats ? await callViewer(win, "getText").catch(() => ({})) : {};
  const keep = typeof held.value === "string" && (doc.delivered || held.value !== doc.savedText);
  const ready = trackReady(win, doc);
  win.webContents.reloadIgnoringCache();
  if (keep && (await ready)) await deliver(win, held.value, displayName(doc), { saved: false });
}

/** A new, untitled document in `viewerId` (default: the first in this build). */
function newDocument(viewerId = available[0]) {
  return createWindow(viewerId);
}

/** Hand `text` to the viewer in `win` as its document. */
async function deliver(win, text, name, { saved }) {
  const doc = docs.get(win);
  if (!doc) return false;
  doc.delivered = true;
  if (!(await doc.ready)) {
    explainMissingApi(win);
    return false;
  }
  const loaded = await callViewer(win, "load", text, { name });
  if (loaded.missing) {
    explainMissingApi(win);
    return false;
  }
  if (loaded.error) {
    showError(win, `${byId(doc.viewer).name} could not load “${name}”.`, loaded.error);
    return false;
  }
  // The viewer may tidy what it was given (a smart paste, say), so the text
  // that counts as saved is the text it holds now, not the bytes on disk.
  if (saved) {
    const now = await callViewer(win, "getText");
    doc.savedText = typeof now.value === "string" ? now.value : text;
  }
  return true;
}

// An untitled window nobody has typed into — the one a bare launch opens —
// is reused by the first file opened, rather than left behind empty.
async function reusableWindow(viewerId) {
  const found = focusedDoc();
  if (!found || found.doc.viewer !== viewerId || found.doc.filePath || found.doc.delivered) return null;
  if (!(await found.doc.ready)) return null;
  const text = await callViewer(found.win, "getText");
  return typeof text.value === "string" && text.value === found.doc.savedText ? found.win : null;
}

async function openPath(filePath) {
  const resolved = path.resolve(filePath);
  const name = path.basename(resolved);

  for (const [win, doc] of docs) {
    if (doc.filePath === resolved) {
      showWindow(win);
      return;
    }
  }

  const viewer = viewerForFile(resolved);
  if (!viewer) {
    const kinds = availableViewers(available).map((v) => v.formatName).join(" and ");
    showError(BrowserWindow.getFocusedWindow(), `ViewHippo can't open “${name}”.`, `It opens ${kinds} documents.`);
    return;
  }
  if (!available.includes(viewer.id)) {
    showError(
      BrowserWindow.getFocusedWindow(),
      `${viewer.name} isn't in this version of ViewHippo yet.`,
      `“${name}” is a ${viewer.formatName} document. ${viewer.name} will open it once it joins the app.`,
    );
    return;
  }

  let text;
  try {
    text = await fs.promises.readFile(resolved, "utf8");
  } catch (err) {
    showError(BrowserWindow.getFocusedWindow(), `Couldn't read “${name}”.`, err.message);
    return;
  }

  const win = (await reusableWindow(viewer.id)) || createWindow(viewer.id);
  const doc = docs.get(win);
  doc.filePath = resolved;
  updateTitle(win);
  app.addRecentDocument(resolved);
  await deliver(win, text, name, { saved: true });
  refreshMenu();
}

async function openDialog() {
  const parent = BrowserWindow.getFocusedWindow();
  const options = { properties: ["openFile", "multiSelections"], filters: openFilters(available) };
  const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (canceled) return;
  for (const filePath of filePaths) await openPath(filePath);
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function save(win, { as = false } = {}) {
  const doc = docs.get(win);
  if (!doc) return false;
  const viewer = byId(doc.viewer);

  const current = await callViewer(win, "getText");
  if (current.missing) {
    explainMissingApi(win);
    return false;
  }
  if (current.error) {
    showError(win, `${viewer.name} could not hand over the document.`, current.error);
    return false;
  }

  let target = doc.filePath;
  if (as || !target) {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: doc.filePath || doc.suggestedName,
      filters: [{ name: `${viewer.formatName} Documents`, extensions: [...viewer.extensions] }],
    });
    if (canceled || !filePath) return false;
    target = filePath;
  }

  try {
    await fs.promises.writeFile(target, current.value, "utf8");
  } catch (err) {
    showError(win, `Couldn't save “${path.basename(target)}”.`, err.message);
    return false;
  }
  doc.filePath = target;
  doc.savedText = current.value;
  updateTitle(win);
  app.addRecentDocument(target);
  return true;
}

// Resolves true when the window may close: nothing unsaved, the user saved
// it, or the user chose to discard it.
async function confirmClose(win) {
  const doc = docs.get(win);
  if (!doc || win.isDestroyed()) return true;
  if (!(await withTimeout(doc.ready, CLOSE_CHECK_TIMEOUT_MS, null))) return true;

  const current = await withTimeout(
    callViewer(win, "getText").catch(() => ({ error: "unreachable" })),
    CLOSE_CHECK_TIMEOUT_MS,
    { error: "timeout" },
  );
  if (typeof current.value !== "string" || current.value === doc.savedText) return true;

  showWindow(win);
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    message: `Do you want to save the changes you made to “${displayName(doc)}”?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ["Save", "Cancel", "Don't Save"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) return save(win);
  return response === 2;
}

// ── Convert ──────────────────────────────────────────────────────────────────
// The viewers do the converting; the host moves text between them. See
// router.js conversionRoute and the brief's "Conversion" section.

function conversionFailed(win, target, reason) {
  showError(win, `Couldn't convert this document to ${target.formatName}.`, reason);
}

function reportDropped(win, target, dropped) {
  if (!dropped.length) return;
  const lines = dropped.map((d) => `• ${d.what}${d.where ? ` (${d.where})` : ""}`);
  dialog.showMessageBox(win, {
    type: "info",
    message: `Converted to ${target.formatName}, but not everything carried over.`,
    detail: lines.join("\n"),
    buttons: ["OK"],
  });
}

function asResult(r) {
  const value = r && r.value;
  if (!value || typeof value.text !== "string") return null;
  return { text: value.text, dropped: Array.isArray(value.dropped) ? value.dropped : [] };
}

async function convert(win, to) {
  const doc = win && docs.get(win);
  const target = viewerForFormat(to);
  if (!doc || !target || !conversionTargets(doc.viewer, available).includes(target)) return;

  const formats = await doc.ready;
  if (!formats) {
    explainMissingApi(win);
    return;
  }
  const source = byId(doc.viewer);
  const name = renameFor(displayName(doc), target);

  if (conversionRoute(formats.writes, to) === "export") {
    const r = await callViewer(win, "exportAs", to);
    const result = asResult(r);
    if (!result) return conversionFailed(win, target, r.error || `${source.name} returned no ${target.formatName}.`);
    const out = createWindow(target.id, { suggestedName: name });
    if (await deliver(out, result.text, name, { saved: false })) reportDropped(out, target, result.dropped);
    return;
  }

  // The target's viewer reads the source text and writes it back out.
  const text = await callViewer(win, "getText");
  if (typeof text.value !== "string") return conversionFailed(win, target, text.error || `${source.name} gave no text.`);
  const out = createWindow(target.id, { suggestedName: name });
  if (!(await deliver(out, text.value, name, { saved: false }))) return;
  const r = await callViewer(out, "exportAs", to);
  const result = asResult(r);
  if (!result) return conversionFailed(out, target, r.error || `${target.name} returned no ${target.formatName}.`);
  if (await deliver(out, result.text, name, { saved: false })) reportDropped(out, target, result.dropped);
}

// ── Appearance ───────────────────────────────────────────────────────────────
// nativeTheme drives prefers-color-scheme, which every viewer left on its own
// "system" setting follows; setTheme() reaches the ones that were not.

function setTheme(theme) {
  settings.theme = theme;
  nativeTheme.themeSource = theme;
  saveSettings();
  for (const win of docs.keys()) callViewer(win, "setTheme", theme).catch(() => {});
  refreshMenu();
}

// ── The menu ─────────────────────────────────────────────────────────────────
// Rebuilt whenever focus or a document changes, so Save and Convert reflect
// the window in front. Mostly roles, which is what makes ⌘C / ⌘V / ⌘Z work at
// all on macOS: there, the clipboard shortcuts are menu items.

function buildMenu() {
  const isMac = process.platform === "darwin";
  const front = focusedDoc();
  const viewers = availableViewers(available);
  const several = viewers.length > 1;

  const newItems = viewers.map((v, i) => ({
    label: several ? `New ${v.formatName} Document` : "New",
    accelerator: i === 0 ? "CmdOrCtrl+N" : undefined,
    click: () => newDocument(v.id),
  }));
  // One item per format some other viewer here can convert to; enabled for
  // the front document only within its own model (JSON ↔ YAML, never
  // Markdown).
  const convertible = convertibleViewers(available);
  const targets = front ? conversionTargets(front.doc.viewer, available) : [];
  const convertItems = convertible.length
    ? [
        { type: "separator" },
        ...convertible.map((v) => ({
          label: `Convert to ${v.formatName}`,
          enabled: targets.includes(v),
          click: (_item, win) => convert(win, v.format),
        })),
      ]
    : [];

  const file = [
    ...newItems,
    { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => openDialog() },
    ...(isMac ? [{ role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] }] : []),
    { type: "separator" },
    { label: "Save", accelerator: "CmdOrCtrl+S", enabled: !!front, click: (_item, win) => win && save(win) },
    { label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", enabled: !!front, click: (_item, win) => win && save(win, { as: true }) },
    ...convertItems,
    { type: "separator" },
    { role: "close" },
    ...(isMac ? [] : [{ role: "quit" }]),
  ];

  const appearance = THEMES.map((theme) => ({
    label: theme[0].toUpperCase() + theme.slice(1),
    type: "radio",
    checked: settings.theme === theme,
    click: () => setTheme(theme),
  }));

  // No Reload in a packaged build: there is nothing new to load. Development
  // keeps it, with DevTools, to pick up a viewer's `make site` without
  // restarting; the document survives it (reloadViewer).
  const development = [
    {
      label: "Reload Viewer",
      accelerator: "CmdOrCtrl+R",
      enabled: !!front,
      click: (_item, win) => win && docs.has(win) && reloadViewer(win),
    },
    { role: "toggleDevTools" },
    { type: "separator" },
  ];
  const view = [
    { label: "Appearance", submenu: appearance },
    { type: "separator" },
    ...(app.isPackaged ? [] : development),
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: file },
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Hippo Herd Website", click: () => openExternal(HOME_PAGE) },
        { label: "Source on GitHub", click: () => openExternal(SOURCE) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function refreshMenu() {
  if (app.isReady()) Menu.setApplicationMenu(buildMenu());
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

// Documents named on the command line (Windows and Linux "Open with", and a
// second launch). argv[0] is the executable; in development argv[1] is the
// app directory. Flags and anything that is not a file are skipped.
function filesFromArgv(argv, cwd) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => path.resolve(cwd || process.cwd(), arg))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

// The bundle's provenance, written by scripts/stage-desktop.mjs: which commit
// of this repo each viewer's website/<id>/ came from.
function viewerCredits() {
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "viewers.json"), "utf8"));
  } catch {
    // `make desktop`: no stage, so no manifest.
  }
  return availableViewers(available)
    .map((v) => {
      const m = manifest[v.id];
      return m && m.commit ? `${v.name} (${m.commit}, ${m.date})` : v.name;
    })
    .join(" · ");
}

// macOS delivers Finder's "Open With" and drops on the Dock icon here, often
// before `ready`; those wait for it.
const pendingFiles = [];
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openPath(filePath);
  else pendingFiles.push(filePath);
});

// One process: a second launch hands its files to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, cwd) => {
    const files = filesFromArgv(argv, cwd);
    if (files.length) {
      files.reduce((p, f) => p.then(() => openPath(f)), Promise.resolve());
      return;
    }
    const [first] = docs.keys();
    if (first) showWindow(first);
    else newDocument();
  });

  app.whenReady().then(async () => {
    if (!available.length) {
      dialog.showErrorBox("ViewHippo has no viewers", `No viewer was found in ${WEB_DIR}.`);
      app.exit(1);
      return;
    }

    loadSettings();
    nativeTheme.themeSource = settings.theme;
    app.setAboutPanelOptions({
      applicationName: "ViewHippo",
      applicationVersion: app.getVersion(),
      copyright: "Copyright © 2026 Jason Figge · GPL-3.0-or-later",
      credits: viewerCredits(),
      website: HOME_PAGE,
    });
    lockDownSession();
    refreshMenu();

    if (debug) {
      const host = {
        app,
        webDir: WEB_DIR,
        appDir: __dirname,
        ids: VIEWERS.map((v) => v.id),
        available,
        docs,
        createWindow,
        deliver,
        callViewer,
        reloadViewer,
        updateTitle,
        withTimeout,
      };
      await debug.restoreSession(host);
      debug.watch(host);
    }

    const files = [...pendingFiles.splice(0), ...filesFromArgv(process.argv)];
    if (files.length) {
      for (const f of files) await openPath(f);
    }
    if (!docs.size) newDocument();

    // macOS: clicking the dock icon with no window open brings one back.
    app.on("activate", () => {
      if (!docs.size) newDocument();
    });
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  // A document app: on macOS it stays in the Dock with no window open, as
  // TextEdit does, unless it is quitting; elsewhere the last window quits.
  app.on("window-all-closed", () => {
    if (quitting || process.platform !== "darwin") app.quit();
  });
}
