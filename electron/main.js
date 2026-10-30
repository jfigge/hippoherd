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
//   * one window, holding each open document in the viewer that owns its
//     file type (router.js) — as tabs, or one document at a time (View →
//     Open Documents in Tabs; features/viewhippo-tabs-addendum.md) — with
//     Open, Save, Save As and Open Recent. Only the types router.js lists
//     open. With nothing open, the window says how to open something;
//   * Convert to JSON / YAML, done by the viewers themselves — the host only
//     moves text between them (router.js conversionRoute);
//   * an app-wide Appearance, which viewers may honour.
//
// Each document is a WebContentsView laid out under the tab strip, which is
// the window's own page (chrome/). The strip carries each viewer's logo and
// the theme, and the Help menu its Hippo Herd and GitHub links, so with tabs
// on the viewer hides its own header (viewerUrl's `chrome`; the brief's "Host
// chrome"). The host talks to a viewer through the small API the viewer
// publishes as window.hippoViewer
// (features/viewhippo-app-build-brief.md, "Artifact & viewer contract"),
// called with executeJavaScript. So, like JsonHippo's old standalone shell:
//
//   * A viewer's renderer is sandboxed with no Node. Its preload
//     (host-preload.js) gives it window.viewHippoHost — the few things the
//     host does for it that a page cannot: say it changed, save an export,
//     print, and load the user's plugins for it — each one named message,
//     answered below for the document that sent it. The tab strip has a
//     preload of its own (chrome/preload.js); it is the host's page.
//   * No request leaves the machine. Every http(s)/ws request is cancelled;
//     a viewer that asks a CDN first falls back to its bundled copy.
//   * Links leave through the system browser, never in the app's window
//     (policy.js).
//
// CommonJS, like the sibling apps' main processes.
"use strict";

const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, nativeTheme, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { SCHEME, viewerUrl, classifyNavigation, resolveAppFile, findPlugins } = require("./policy");
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

// `make debug`: DevTools for every document, and hot reload of the viewers
// and of this host (debug.js). Never in a packaged build.
const debug = !app.isPackaged && process.env.VIEWHIPPO_DEBUG === "1" ? require("./debug") : null;

const HOME_PAGE = "https://hippoherd.com/";
const SOURCE = "https://github.com/jfigge/hippoherd";

// A neutral first-paint colour per theme, so a document does not flash white
// before a dark viewer paints. The viewer's own background replaces it.
const BACKGROUND = { light: "#ffffff", dark: "#1c1c1c" };

// The tab strip's height; chrome/tabs.css draws it at the same.
const STRIP_HEIGHT = 36;

// How long to wait for the first paint before showing the window anyway, and
// for a viewer to publish window.hippoViewer before treating it as an old
// build without one.
const SHOW_TIMEOUT_MS = 3000;
const READY_TIMEOUT_MS = 5000;

// How long the unsaved-changes check waits for a viewer's text. A viewer that
// has hung must not make its document impossible to close.
const CLOSE_CHECK_TIMEOUT_MS = 3000;

// How long after a viewer says its text changed the host compares it with the
// saved text: long enough that typing is one comparison, not one a keystroke.
const DIRTY_CHECK_DELAY_MS = 250;

// Each viewer's own plugins folder is <this>/<id>/ (host-preload.js).
const pluginsRoot = () => path.join(app.getPath("userData"), "plugins");

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
 * The window, or null before it opens. Closing it quits the app, on macOS too.
 *   win            the BrowserWindow; its own page is the tab strip
 *   docs           the open documents, in tab order
 *   active         the one on screen
 *   closeConfirmed set once every document has passed the unsaved check
 *
 * A document:
 *   id             stable for its lifetime; the tab strip names tabs by it
 *   viewer         the id of the viewer showing it
 *   view           its WebContentsView
 *   filePath       where it was opened from / last saved to; null if untitled
 *   suggestedName  the name Save offers for an untitled document
 *   savedText      the text as last opened or saved, for the unsaved check;
 *                  for a new document, whatever the viewer starts with (an
 *                  empty box, or MarkHippo's sample), so that is not "unsaved"
 *   dirty          its text differs from savedText, as last checked; kept up
 *                  to date only for a viewer that says when it changes
 *                  (viewHippoHost.changed), and shown on its tab
 *   dirtyTimer     a pending check of `dirty`
 *   delivered      set once the host has handed the viewer a document
 *   ready          resolves to the viewer's `formats` once window.hippoViewer
 *                  exists, or to null for a viewer that never publishes one
 *   about          the viewer offers hippoViewer.showAbout() (Help → About)
 */
let frame = null;
let nextDocId = 1;

// tabs      one window of tabs (true), or one document at a time (false)
// fullPath  the title bar shows the document's full path, not its name
let settings = { theme: "system", tabs: true, fullPath: false };

function openExternal(url) {
  shell.openExternal(url).catch((err) => console.error(`[main] could not open ${url}:`, err));
}

// ── Settings: the app's own — Appearance, tabs, and the title ────────────────
// Viewers keep their settings themselves, in their own origin's storage.

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (THEMES.includes(stored.theme)) settings.theme = stored.theme;
    if (typeof stored.tabs === "boolean") settings.tabs = stored.tabs;
    if (typeof stored.fullPath === "boolean") settings.fullPath = stored.fullPath;
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
  // viewhippo:// and the tab strip's file:// are not matched, so they load.
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

  // viewhippo://<id>/… → web/<id>/…, and nothing outside it; /@plugins/… →
  // the viewer's plugins folder (policy.js).
  protocol.handle(SCHEME, async (request) => {
    const file = resolveAppFile(request.url, WEB_DIR, available, pluginsRoot());
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

async function callViewer(doc, method, ...args) {
  const contents = doc.view.webContents;
  if (contents.isDestroyed()) return { error: "The document has closed." };
  const name = JSON.stringify(method);
  return contents.executeJavaScript(
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
function waitForViewer(contents) {
  return contents.executeJavaScript(
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

function parentWindow() {
  return frame && !frame.win.isDestroyed() ? frame.win : null;
}

function showError(message, detail) {
  const options = { type: "error", message, detail, buttons: ["OK"] };
  const parent = parentWindow();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

// A viewer built before the hippoViewer API still opens and works; it just
// cannot be handed a file, saved from, or converted. Said once per document.
function explainMissingApi(doc) {
  if (!doc || doc.warned) return;
  doc.warned = true;
  const viewer = byId(doc.viewer);
  showError(
    `This build of ${viewer.name} can't exchange documents with ViewHippo yet.`,
    `It predates the viewer API the app uses to open, save and convert files. ` +
      `You can still paste into it, or use its own Load from file button.`,
  );
}

// ── The window ───────────────────────────────────────────────────────────────

function displayName(doc) {
  return doc.filePath ? path.basename(doc.filePath) : doc.suggestedName;
}

// The title bar names the document on screen: its short name, or its full
// path with View → Show Full Path in Title Bar. An untitled document has no
// path, so it shows its name either way. Tabs always show the short name. On
// macOS, unsaved changes also show in the window's close button.
function updateTitle() {
  const win = parentWindow();
  if (!win) return;
  const doc = frame.active;
  win.setTitle(!doc ? "ViewHippo" : settings.fullPath && doc.filePath ? doc.filePath : displayName(doc));
  if (process.platform === "darwin") {
    win.setRepresentedFilename((doc && doc.filePath) || "");
    win.setDocumentEdited(Boolean(doc && doc.dirty));
  }
}

// How much of its own header a viewer shows: none of the parts the strip
// carries while there is a strip ("tabs"), all of it when there is not.
const chromeMode = () => (settings.tabs ? "tabs" : "full");

// The same, for a page already loaded: on every load (a reload keeps the URL
// it was first given), and for every document when the setting changes.
function applyChrome(doc) {
  const contents = doc.view.webContents;
  if (contents.isDestroyed()) return;
  contents
    .executeJavaScript(`document.documentElement.dataset.viewhippoChrome = ${JSON.stringify(chromeMode())}`)
    .catch(() => {});
}

// Tell the tab strip what to draw: the tabs (hidden, with tabs off), or with
// no document open, the empty window's words.
function sendTabs() {
  const win = parentWindow();
  if (!win) return;
  const viewers = availableViewers(available);
  const formats = viewers.map((v) => v.formatName);
  win.webContents.send("tabs:state", {
    showTabs: settings.tabs,
    theme: settings.theme,
    empty: {
      formats: formats.length > 1 ? `${formats.slice(0, -1).join(", ")} or ${formats.at(-1)}` : formats[0],
      shortcut: process.platform === "darwin" ? "⌘O" : "Ctrl+O",
      viewers: viewers.map((v) => ({ id: v.id, formatName: v.formatName })),
    },
    active: frame.active ? frame.active.id : null,
    tabs: frame.docs.map((d) => ({
      id: d.id,
      name: displayName(d),
      tooltip: d.filePath || `${displayName(d)} — not saved yet`,
      dirty: d.dirty,
      viewer: byId(d.viewer).name,
      color: byId(d.viewer).color,
      icon: `marks/${d.viewer}.svg`,
    })),
  });
}

// Each document fills the window below the strip, or the whole window with
// tabs off. Only the active one is visible.
function layout() {
  const win = parentWindow();
  if (!win) return;
  const [width, height] = win.getContentSize();
  const top = settings.tabs ? STRIP_HEIGHT : 0;
  for (const doc of frame.docs) {
    doc.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }
}

function showWindow() {
  const win = parentWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function ensureFrame() {
  if (frame) return frame;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "ViewHippo",
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    // Windows and Linux take the window (and taskbar) icon from here; macOS
    // uses the bundle's, and in development the Dock icon set at startup.
    icon: path.join(__dirname, "icons", "linux", "512x512.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, "chrome", "preload.js"),
    },
  });
  const f = { win, docs: [], active: null, closeConfirmed: false };
  frame = f;

  // Show on the first paint, or after a timeout if that never comes.
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    clearTimeout(timer);
    win.show();
  };
  const timer = setTimeout(show, SHOW_TIMEOUT_MS);
  win.once("ready-to-show", show);

  // The title is the document's, and the strip's page goes nowhere.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  for (const event of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(event, layout);
  }
  win.on("focus", refreshMenu);

  // Closing the window closes every document in it, each asking first if it
  // has unsaved changes, and then quits the app. Cancelling any one keeps the
  // window, and the app.
  win.on("close", (event) => {
    if (f.closeConfirmed) return;
    event.preventDefault();
    confirmAll().then((ok) => {
      if (!ok) return;
      f.closeConfirmed = true;
      if (!win.isDestroyed()) win.close();
    });
  });
  win.on("closed", () => {
    for (const doc of f.docs) destroyView(doc);
    if (frame === f) frame = null;
    refreshMenu();
  });

  win.loadFile(path.join(__dirname, "chrome", "tabs.html")).catch((err) => console.error("[main] tab strip failed to load:", err));
  return f;
}

// The tab strip's messages. Only the window's own page may send them.
function fromStrip(event) {
  return frame && !frame.win.isDestroyed() && event.sender === frame.win.webContents;
}
const docById = (id) => (frame ? frame.docs.find((d) => d.id === id) : undefined);

ipcMain.on("tabs:ready", (event) => {
  if (fromStrip(event)) sendTabs();
});
ipcMain.on("tabs:activate", (event, id) => {
  if (fromStrip(event) && docById(id)) activate(docById(id));
});
ipcMain.on("tabs:close", (event, id) => {
  if (fromStrip(event) && docById(id)) closeDoc(docById(id));
});
ipcMain.on("tabs:open", (event) => {
  if (fromStrip(event)) openDialog();
});
ipcMain.on("tabs:new", (event, viewerId) => {
  if (fromStrip(event) && available.includes(viewerId)) newDocument(viewerId);
});
ipcMain.on("tabs:theme", (event) => {
  if (fromStrip(event)) setTheme(THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length]);
});

// ── Documents ────────────────────────────────────────────────────────────────

// Sets doc.ready for the page load that is about to happen: the first one, or
// a development reload. Once the viewer is up, it gets the Appearance (always:
// the strip's theme control stands in for the viewer's own, so the two must
// agree), and an undelivered document takes the viewer's starting text as its
// saved state.
function trackReady(doc) {
  const contents = doc.view.webContents;
  doc.ready = new Promise((resolve) => {
    const stop = () => {
      contents.off("did-finish-load", finished);
      contents.off("did-fail-load", failed);
    };
    const finished = () => {
      stop();
      waitForViewer(contents).then(resolve, () => resolve(null));
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
    callViewer(doc, "setTheme", settings.theme).catch(() => {});
    doc.about = await contents
      .executeJavaScript('typeof (window.hippoViewer || {}).showAbout === "function"')
      .catch(() => false);
    if (doc === front()) refreshMenu();
    const start = await callViewer(doc, "getText").catch(() => ({}));
    if (!doc.delivered && typeof start.value === "string") doc.savedText = start.value;
  });
  return doc.ready;
}

/** A new document in `viewerId`, loading but not yet in the window (place() puts it there). */
function createDoc(viewerId, { suggestedName } = {}) {
  const viewer = byId(viewerId);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, "host-preload.js"),
    },
  });
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light);

  const doc = {
    id: nextDocId++,
    viewer: viewerId,
    view,
    filePath: null,
    suggestedName: suggestedName || renameFor(null, viewer),
    savedText: "",
    dirty: false,
    dirtyTimer: null,
    delivered: false,
    ready: null,
    warned: false,
    about: false,
  };
  trackReady(doc);

  const contents = view.webContents;
  if (debug) debug.instrument(contents, viewerId);
  contents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error(`[main] load failed: ${url} — ${desc} (${code})`);
  });
  contents.on("render-process-gone", (_e, details) => console.error(`[main] renderer gone: ${details.reason}`));
  contents.on("dom-ready", () => applyChrome(doc));

  // A link click or a script navigation. Only the viewer's own page loads here.
  contents.on("will-navigate", (event, url) => {
    const verdict = classifyNavigation(url, viewerId);
    if (verdict === "app") return;
    event.preventDefault();
    if (verdict === "external") openExternal(url);
  });

  // window.open and target=_blank: never a second Electron window.
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, viewerId) === "external") openExternal(url);
    return { action: "deny" };
  });

  contents.loadURL(viewerUrl(viewerId, app.getVersion(), chromeMode())).catch((err) => console.error("[main] viewer failed to load:", err));
  return doc;
}

function destroyView(doc) {
  clearTimeout(doc.dirtyTimer);
  if (!doc.view.webContents.isDestroyed()) doc.view.webContents.close();
}

/** Show `doc`: its tab becomes the active one, and it gets the keyboard. */
function activate(doc) {
  if (!frame || !frame.docs.includes(doc)) return;
  frame.active = doc;
  for (const d of frame.docs) d.view.setVisible(d === doc);
  layout();
  if (!doc.view.webContents.isDestroyed()) doc.view.webContents.focus();
  updateTitle();
  sendTabs();
  refreshMenu();
}

/**
 * Put a new document in the window: a new tab beside the active one, or,
 * with tabs off, in place of the document that was there. Callers make room
 * first (makeRoom), which is where the replaced document's unsaved changes
 * are asked about.
 */
function place(doc) {
  const f = ensureFrame();
  const at = f.active ? f.docs.indexOf(f.active) + 1 : f.docs.length;
  f.docs.splice(at, 0, doc);
  f.win.contentView.addChildView(doc.view);
  const replaced = settings.tabs ? [] : f.docs.filter((d) => d !== doc);
  activate(doc);
  for (const old of replaced) closeDoc(old, { confirmed: true });
}

// With tabs off, the document on screen has to make way for the next one.
// Resolves true once it may go: nothing unsaved, saved, or discarded.
async function makeRoom() {
  if (settings.tabs || !frame) return true;
  for (const doc of [...frame.docs]) {
    if (!(await confirmClose(doc))) return false;
  }
  return true;
}

/**
 * Close one document. Closing the last leaves the window open and empty,
 * saying how to open another. Resolves false if the user kept it.
 */
async function closeDoc(doc, { confirmed = false } = {}) {
  const f = frame;
  if (!f || !f.docs.includes(doc)) return true;
  if (!confirmed && !(await confirmClose(doc))) return false;
  if (!f.docs.includes(doc)) return true;

  const i = f.docs.indexOf(doc);
  f.docs.splice(i, 1);
  if (!f.win.isDestroyed()) f.win.contentView.removeChildView(doc.view);
  destroyView(doc);

  if (f.active === doc) {
    f.active = null;
    const next = f.docs[i] || f.docs[i - 1];
    if (next) {
      activate(next);
      return true;
    }
    updateTitle();
  }
  sendTabs();
  refreshMenu();
  return true;
}

/** A new, untitled document in `viewerId` (default: the first in this build). */
async function newDocument(viewerId = available[0]) {
  if (!(await makeRoom())) return null;
  const doc = createDoc(viewerId);
  place(doc);
  showWindow();
  return doc;
}

// Load the viewer's page again and hand it back the document it held. Unsaved
// stays unsaved: the saved state is kept. In development, View → Reload Viewer
// and `make debug`'s hot reload, to pick up a new `make site`; anywhere, a
// viewer asking for it (viewHippoHost.reload: MarkHippo's Reload plugins).
async function reloadViewer(doc) {
  if (!doc || doc.view.webContents.isDestroyed()) return;
  const formats = await withTimeout(doc.ready, CLOSE_CHECK_TIMEOUT_MS, null);
  const held = formats ? await callViewer(doc, "getText").catch(() => ({})) : {};
  const keep = typeof held.value === "string" && (doc.delivered || held.value !== doc.savedText);
  const ready = trackReady(doc);
  doc.view.webContents.reloadIgnoringCache();
  if (keep && (await ready)) await deliver(doc, held.value, displayName(doc), { saved: false });
}

/** Hand `text` to the viewer showing `doc` as its document. */
async function deliver(doc, text, name, { saved }) {
  doc.delivered = true;
  if (!(await doc.ready)) {
    explainMissingApi(doc);
    return false;
  }
  const loaded = await callViewer(doc, "load", text, { name });
  if (loaded.missing) {
    explainMissingApi(doc);
    return false;
  }
  if (loaded.error) {
    showError(`${byId(doc.viewer).name} could not load “${name}”.`, loaded.error);
    return false;
  }
  // The viewer may tidy what it was given (a smart paste, say), so the text
  // that counts as saved is the text it holds now, not the bytes on disk.
  if (saved) {
    const now = await callViewer(doc, "getText");
    doc.savedText = typeof now.value === "string" ? now.value : text;
  }
  // A converted or reloaded document arrives unsaved; an opened one, saved.
  await checkDirty(doc);
  return true;
}

// An untitled document nobody has typed into — a New document left as it
// was — takes the first file opened, rather than staying behind empty.
async function reusableDoc(viewerId) {
  const doc = frame && frame.active;
  if (!doc || doc.viewer !== viewerId || doc.filePath || doc.delivered) return null;
  if (!(await doc.ready)) return null;
  const text = await callViewer(doc, "getText");
  return typeof text.value === "string" && text.value === doc.savedText ? doc : null;
}

async function openPath(filePath) {
  const resolved = path.resolve(filePath);
  const name = path.basename(resolved);

  const open = frame && frame.docs.find((d) => d.filePath === resolved);
  if (open) {
    activate(open);
    showWindow();
    return;
  }

  const viewer = viewerForFile(resolved);
  if (!viewer) {
    const kinds = availableViewers(available).map((v) => v.formatName).join(" and ");
    showError(`ViewHippo can't open “${name}”.`, `It opens ${kinds} documents.`);
    return;
  }
  if (!available.includes(viewer.id)) {
    showError(
      `${viewer.name} isn't in this version of ViewHippo yet.`,
      `“${name}” is a ${viewer.formatName} document. ${viewer.name} will open it once it joins the app.`,
    );
    return;
  }

  let text;
  try {
    text = await fs.promises.readFile(resolved, "utf8");
  } catch (err) {
    showError(`Couldn't read “${name}”.`, err.message);
    return;
  }

  let doc = await reusableDoc(viewer.id);
  if (!doc) {
    if (!(await makeRoom())) return;
    doc = createDoc(viewer.id);
    place(doc);
  }
  doc.filePath = resolved;
  updateTitle();
  sendTabs();
  showWindow();
  app.addRecentDocument(resolved);
  await deliver(doc, text, name, { saved: true });
  refreshMenu();
}

async function openDialog() {
  const parent = parentWindow();
  const options = { properties: ["openFile", "multiSelections"], filters: openFilters(available) };
  const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (canceled) return;
  for (const filePath of filePaths) await openPath(filePath);
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function save(doc, { as = false } = {}) {
  if (!doc) return false;
  const viewer = byId(doc.viewer);

  const current = await callViewer(doc, "getText");
  if (current.missing) {
    explainMissingApi(doc);
    return false;
  }
  if (current.error) {
    showError(`${viewer.name} could not hand over the document.`, current.error);
    return false;
  }

  let target = doc.filePath;
  if (as || !target) {
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow(), {
      defaultPath: doc.filePath || doc.suggestedName,
      filters: [{ name: `${viewer.formatName} Documents`, extensions: [...viewer.extensions] }],
    });
    if (canceled || !filePath) return false;
    target = filePath;
  }

  try {
    await fs.promises.writeFile(target, current.value, "utf8");
  } catch (err) {
    showError(`Couldn't save “${path.basename(target)}”.`, err.message);
    return false;
  }
  doc.filePath = target;
  doc.savedText = current.value;
  updateTitle();
  sendTabs();
  app.addRecentDocument(target);
  // Typing may have gone on while the dialog was open.
  await checkDirty(doc);
  return true;
}

// Resolves true when the document may close: nothing unsaved, the user saved
// it, or the user chose to discard it. It is shown first, so the question is
// asked about the document in front of the user.
async function confirmClose(doc) {
  if (!doc || doc.view.webContents.isDestroyed()) return true;
  if (!(await withTimeout(doc.ready, CLOSE_CHECK_TIMEOUT_MS, null))) return true;

  const current = await withTimeout(
    callViewer(doc, "getText").catch(() => ({ error: "unreachable" })),
    CLOSE_CHECK_TIMEOUT_MS,
    { error: "timeout" },
  );
  if (typeof current.value !== "string" || current.value === doc.savedText) return true;

  activate(doc);
  showWindow();
  const { response } = await dialog.showMessageBox(parentWindow(), {
    type: "warning",
    message: `Do you want to save the changes you made to “${displayName(doc)}”?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ["Save", "Cancel", "Don't Save"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) return save(doc);
  return response === 2;
}

async function confirmAll() {
  for (const doc of frame ? [...frame.docs] : []) {
    if (!(await confirmClose(doc))) return false;
  }
  return true;
}

// ── Unsaved changes ──────────────────────────────────────────────────────────
// Whether a document's text differs from its saved text: a dot on its tab and,
// on macOS, in the window's close button. A viewer says when its text may
// have changed (viewHippoHost.changed) and the host compares, once typing
// pauses. Closing still asks the viewer itself (confirmClose), so changes in
// a viewer that never says are not lost either; they just are not shown.

function scheduleDirtyCheck(doc) {
  clearTimeout(doc.dirtyTimer);
  doc.dirtyTimer = setTimeout(() => checkDirty(doc), DIRTY_CHECK_DELAY_MS);
}

async function checkDirty(doc) {
  clearTimeout(doc.dirtyTimer);
  doc.dirtyTimer = null;
  if (doc.view.webContents.isDestroyed()) return;
  const current = await callViewer(doc, "getText").catch(() => ({}));
  if (typeof current.value !== "string") return;
  const dirty = current.value !== doc.savedText;
  if (dirty === doc.dirty) return;
  doc.dirty = dirty;
  sendTabs();
  if (doc === front()) updateTitle();
}

// ── The viewers' bridge (host-preload.js) ────────────────────────────────────
// Answered for the document whose page sent the message, and only when its
// viewer's own page sent it: not a frame inside it, nor a page it went to.

function senderDoc(event) {
  const doc = frame && frame.docs.find((d) => d.view.webContents === event.sender);
  const from = event.senderFrame;
  if (!doc || !from || from !== event.sender.mainFrame) return null;
  return classifyNavigation(from.url, doc.viewer) === "app" ? doc : null;
}

function handleFromViewer(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const doc = senderDoc(event);
    if (!doc) throw new Error(`${channel}: not from a viewer's page`);
    return fn(doc, ...args);
  });
}

// Where an export goes: where the user says, offered beside the document's
// file (or, untitled, in the dialog's own default folder).
async function chooseExportPath(doc, name) {
  const base = path.basename(name);
  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow(), {
    defaultPath: doc.filePath ? path.join(path.dirname(doc.filePath), base) : base,
  });
  return canceled || !filePath ? null : filePath;
}

const pluginsDir = (doc) => path.join(pluginsRoot(), doc.viewer);

ipcMain.on("host:changed", (event) => {
  const doc = senderDoc(event);
  if (doc) scheduleDirtyCheck(doc);
});

handleFromViewer("host:save-export", async (doc, { name, data } = {}) => {
  if (typeof name !== "string" || !name || !(typeof data === "string" || data instanceof Uint8Array)) {
    throw new Error("save-export: bad arguments");
  }
  const file = await chooseExportPath(doc, name);
  if (!file) return null;
  await fs.promises.writeFile(file, data);
  return file;
});

handleFromViewer(
  "host:print",
  (doc) =>
    new Promise((resolve) => {
      doc.view.webContents.print({ printBackground: false }, (ok, reason) => {
        if (!ok && reason !== "cancelled") console.error(`[main] printing failed: ${reason}`);
        resolve(ok);
      });
    }),
);

// The page is made ready to print first (MarkHippo fills its print area), so
// the PDF is made before the dialog, while the page is still that way.
handleFromViewer("host:print-pdf", async (doc, { name } = {}) => {
  const pdf = await doc.view.webContents.printToPDF({ printBackground: false, preferCSSPageSize: true });
  const file = await chooseExportPath(doc, name || `${path.parse(displayName(doc)).name}.pdf`);
  if (!file) return null;
  await fs.promises.writeFile(file, pdf);
  return file;
});

handleFromViewer("host:plugins", (doc) => findPlugins(pluginsDir(doc), doc.viewer));

handleFromViewer("host:open-plugins-folder", async (doc) => {
  await fs.promises.mkdir(pluginsDir(doc), { recursive: true });
  const failed = await shell.openPath(pluginsDir(doc));
  if (failed) throw new Error(failed);
});

// Sent, not asked: the page that asks is gone by the time it is done.
ipcMain.on("host:reload", (event) => {
  const doc = senderDoc(event);
  if (doc) reloadViewer(doc).catch((err) => console.error("[main] reload failed:", err));
});

// ── Convert ──────────────────────────────────────────────────────────────────
// The viewers do the converting; the host moves text between them. See
// router.js conversionRoute and the brief's "Conversion" section. The result
// is a new, untitled document: a new tab, or with tabs off, the document that
// replaces the source (which is asked about first, if it has unsaved changes).

function conversionFailed(target, reason) {
  showError(`Couldn't convert this document to ${target.formatName}.`, reason);
}

function reportDropped(target, dropped) {
  if (!dropped.length) return;
  const lines = dropped.map((d) => `• ${d.what}${d.where ? ` (${d.where})` : ""}`);
  dialog.showMessageBox(parentWindow(), {
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

async function convert(doc, to) {
  const target = viewerForFormat(to);
  if (!doc || !target || !conversionTargets(doc.viewer, available).includes(target)) return;

  const formats = await doc.ready;
  if (!formats) {
    explainMissingApi(doc);
    return;
  }
  const source = byId(doc.viewer);
  const name = renameFor(displayName(doc), target);

  // Everything needed from the source is taken before it can be replaced.
  let exported = null;
  let text = null;
  if (conversionRoute(formats.writes, to) === "export") {
    const r = await callViewer(doc, "exportAs", to);
    exported = asResult(r);
    if (!exported) return conversionFailed(target, r.error || `${source.name} returned no ${target.formatName}.`);
  } else {
    const r = await callViewer(doc, "getText");
    if (typeof r.value !== "string") return conversionFailed(target, r.error || `${source.name} gave no text.`);
    text = r.value;
  }

  if (!(await makeRoom())) return;
  const out = createDoc(target.id, { suggestedName: name });
  place(out);

  if (exported) {
    if (await deliver(out, exported.text, name, { saved: false })) reportDropped(target, exported.dropped);
    return;
  }
  // The target's viewer reads the source text and writes it back out.
  if (!(await deliver(out, text, name, { saved: false }))) return;
  const r = await callViewer(out, "exportAs", to);
  const result = asResult(r);
  if (!result) return conversionFailed(target, r.error || `${target.name} returned no ${target.formatName}.`);
  if (await deliver(out, result.text, name, { saved: false })) reportDropped(target, result.dropped);
}

// ── Settings from the View menu ──────────────────────────────────────────────

// nativeTheme drives prefers-color-scheme, which every viewer left on its own
// "system" setting follows (and so does the tab strip); setTheme() reaches
// the viewers that were not.
function setTheme(theme) {
  settings.theme = theme;
  nativeTheme.themeSource = theme;
  saveSettings();
  for (const doc of frame ? frame.docs : []) callViewer(doc, "setTheme", theme).catch(() => {});
  sendTabs();
  refreshMenu();
}

// Turning tabs off leaves one document: the one on screen. The others close
// first, each asking about unsaved changes; cancelling any keeps tabs on.
async function setTabs(on) {
  if (on === settings.tabs) return;
  if (!on && frame && frame.docs.length > 1) {
    const keep = frame.active;
    for (const doc of frame.docs.filter((d) => d !== keep)) {
      if (!(await closeDoc(doc))) {
        activate(keep);
        return;
      }
    }
    activate(keep);
  }
  settings.tabs = on;
  saveSettings();
  for (const doc of frame ? frame.docs : []) applyChrome(doc);
  layout();
  sendTabs();
  refreshMenu();
}

function setFullPath(on) {
  settings.fullPath = on;
  saveSettings();
  updateTitle();
  refreshMenu();
}

// ── The menu ─────────────────────────────────────────────────────────────────
// Rebuilt whenever the document on screen changes, so Save and Convert
// reflect it. Edit is roles, which is what makes ⌘C / ⌘V / ⌘Z work at all on
// macOS (there, the clipboard shortcuts are menu items); they act on the
// focused document, which activate() gives the keyboard.

function front() {
  return frame ? frame.active : null;
}

function cycleTab(step) {
  const doc = front();
  if (!doc || frame.docs.length < 2) return;
  const i = frame.docs.indexOf(doc);
  activate(frame.docs[(i + step + frame.docs.length) % frame.docs.length]);
}

function zoom(by) {
  const doc = front();
  if (!doc || doc.view.webContents.isDestroyed()) return;
  const contents = doc.view.webContents;
  contents.setZoomLevel(by === 0 ? 0 : contents.getZoomLevel() + by);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const doc = front();
  const viewers = availableViewers(available);
  const several = viewers.length > 1;
  const tabs = settings.tabs;

  const newItems = viewers.map((v, i) => ({
    label: several ? `New ${v.formatName} Document` : "New",
    accelerator: i === 0 ? "CmdOrCtrl+N" : undefined,
    click: () => newDocument(v.id),
  }));
  // One item per format some other viewer here can convert to; enabled for
  // the front document only within its own model (JSON ↔ YAML, never
  // Markdown).
  const convertible = convertibleViewers(available);
  const targets = doc ? conversionTargets(doc.viewer, available) : [];
  const convertItems = convertible.length
    ? [
        { type: "separator" },
        ...convertible.map((v) => ({
          label: `Convert to ${v.formatName}`,
          enabled: targets.includes(v),
          click: () => convert(front(), v.format),
        })),
      ]
    : [];

  const file = [
    ...newItems,
    { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => openDialog() },
    ...(isMac ? [{ role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] }] : []),
    { type: "separator" },
    { label: "Save", accelerator: "CmdOrCtrl+S", enabled: !!doc, click: () => save(front()) },
    { label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", enabled: !!doc, click: () => save(front(), { as: true }) },
    ...convertItems,
    { type: "separator" },
    { label: tabs ? "Close Tab" : "Close", accelerator: "CmdOrCtrl+W", enabled: !!doc, click: () => front() && closeDoc(front()) },
    ...(tabs
      ? [{ label: "Close Window", accelerator: "Shift+CmdOrCtrl+W", enabled: !!frame, click: () => parentWindow() && parentWindow().close() }]
      : []),
    ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
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
    { label: "Reload Viewer", accelerator: "CmdOrCtrl+R", enabled: !!doc, click: () => reloadViewer(front()) },
    {
      label: "Toggle Developer Tools",
      accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
      enabled: !!doc,
      click: () => front() && front().view.webContents.toggleDevTools(),
    },
    { type: "separator" },
  ];
  const view = [
    { label: "Appearance", submenu: appearance },
    { type: "separator" },
    { label: "Open Documents in Tabs", type: "checkbox", checked: tabs, click: (item) => setTabs(item.checked) },
    { label: "Show Full Path in Title Bar", type: "checkbox", checked: settings.fullPath, click: (item) => setFullPath(item.checked) },
    { type: "separator" },
    ...(app.isPackaged ? [] : development),
    { label: "Actual Size", accelerator: "CmdOrCtrl+0", enabled: !!doc, click: () => zoom(0) },
    { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", enabled: !!doc, click: () => zoom(0.5) },
    { label: "Zoom Out", accelerator: "CmdOrCtrl+-", enabled: !!doc, click: () => zoom(-0.5) },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const tabItems = tabs
    ? [
        { type: "separator" },
        { label: "Show Next Tab", accelerator: "Ctrl+Tab", enabled: !!frame && frame.docs.length > 1, click: () => cycleTab(1) },
        { label: "Show Previous Tab", accelerator: "Ctrl+Shift+Tab", enabled: !!frame && frame.docs.length > 1, click: () => cycleTab(-1) },
      ]
    : [];
  const windowMenu = {
    label: "Window",
    role: "window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...tabItems,
      ...(isMac ? [{ type: "separator" }, { role: "front" }] : []),
    ],
  };

  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: file },
    { role: "editMenu" },
    { label: "View", submenu: view },
    windowMenu,
    {
      role: "help",
      submenu: [
        // What the viewer's own header held, which the strip has no room for:
        // its About (opened from its logo), and its GitHub link.
        ...(doc && doc.about
          ? [{ label: `About ${byId(doc.viewer).name}`, click: () => front() && callViewer(front(), "showAbout").catch(() => {}) }]
          : []),
        ...(doc ? [{ label: `${byId(doc.viewer).name} on GitHub`, click: () => openExternal(byId(doc.viewer).source) }] : []),
        ...(doc ? [{ type: "separator" }] : []),
        { label: "Hippo Herd Website", click: () => openExternal(HOME_PAGE) },
        { label: "ViewHippo on GitHub", click: () => openExternal(SOURCE) },
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
    ensureFrame();
    showWindow();
  });

  app.whenReady().then(async () => {
    if (!available.length) {
      dialog.showErrorBox("ViewHippo has no viewers", `No viewer was found in ${WEB_DIR}.`);
      app.exit(1);
      return;
    }

    // A packaged app's Dock and taskbar icons come from the bundle (the .icns
    // and the .exe). Run from source, the Dock would show Electron's, so it is
    // given the macOS icon: the mark inside the usual transparent margin.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock.setIcon(path.join(__dirname, "icons", "mac.png"));
    }
    // Groups the taskbar button with the installed app's shortcut.
    if (process.platform === "win32") app.setAppUserModelId("com.hippoherd.viewhippo");

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

    let resume = null;
    if (debug) {
      const host = {
        app,
        webDir: WEB_DIR,
        appDir: __dirname,
        ids: VIEWERS.map((v) => v.id),
        available,
        documents: () => (frame ? frame.docs : []),
        activeDocument: front,
        window: parentWindow,
        createDoc,
        place,
        activate,
        deliver,
        callViewer,
        reloadViewer,
        updateTitle,
        sendTabs,
        withTimeout,
      };
      resume = await debug.restoreSession(host);
      debug.watch(host);
    }

    const files = [...pendingFiles.splice(0), ...filesFromArgv(process.argv)];
    for (const f of files) await openPath(f);
    if (resume) activate(resume);
    // Nothing to open: the empty window.
    ensureFrame();
  });

  // One window is the whole app: closing it quits, on macOS as everywhere
  // else, rather than leaving ViewHippo in the Dock with no window. (Closing
  // the last tab leaves the window open and empty; it is closing the window
  // itself — its close button, Close Window, or Quit — that ends the app.)
  app.on("window-all-closed", () => app.quit());
}
