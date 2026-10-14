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
 * app.js — wires the page together: the editor, the parser host, the
 * preview, the status bar, files, images, export and the theme — and, in
 * the desktop app, its shell (desktop.js).
 *
 * Everything the parser and renderer do happens in MarkHippo's own modules
 * (core/, parser/, render/, plugins/); this file is only the page.
 */

import { createMarkHippo } from "./core/host.js";
import commonmark from "./plugins/commonmark/index.js";
import code from "./plugins/code/index.js";
import themesPlugin from "./plugins/themes/index.js";
import tables from "./plugins/gfm/tables.js";
import taskLists from "./plugins/gfm/task-lists.js";
import strikethrough from "./plugins/gfm/strikethrough.js";
import autolinks from "./plugins/gfm/autolinks.js";
import tagFilter from "./plugins/gfm/tag-filter.js";
import footnotes from "./plugins/footnotes/index.js";
import math from "./plugins/math/index.js";
import mermaid from "./plugins/mermaid/index.js";
import { SHOWN_AS_FILES, desktop, documentImageUrl, loadUserPlugins } from "./desktop.js";
import { enhance } from "./enhance.js";
import { Exporter } from "./exporter.js";
import { dataUrl, importImage, isImage } from "./image-import.js";
import { altFromName, placeImage } from "./images/embed.js";
import { MenuButton } from "./menu-button.js";
import { normalizeLabel } from "./parser/normalize.js";
import { ThemeDialog } from "./theme-dialog.js";
import { ThemeManager } from "./theme-manager.js";
import { Minimap } from "./minimap.js";
import { OutlineView } from "./outline-view.js";
import { ScrollSync } from "./scroll-sync.js";
import { outline, sectionAt } from "./nav/outline.js";
import { HIGHLIGHT_DELAY_MS, RENDER_DELAY_MS, STORE_DELAY_MS, debounce } from "./debounce.js";
import { Autocomplete } from "./autocomplete.js";
import { EditorView } from "./editor-view.js";
import { PreviewView } from "./preview-view.js";
import { StatusBar } from "./status-bar.js";
import { SAMPLE } from "./sample.js";

const STORE = {
  document: "markhippo.document",
  filename: "markhippo.filename",
  split: "markhippo.split",
  plugins: "markhippo.plugins",
  view: "markhippo.view",
};

const $ = (id) => document.getElementById(id);

const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  // Answers whether it was kept.
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      // Storage blocked or full: the document still works, it just will not
      // be there next time.
      return false;
    }
  },
};

// The bundled plugin set, in installation order. The extensions (tables,
// footnotes, task lists, math, Mermaid) arrive as further plugins here.
const BUNDLED = [commonmark, code, tables, taskLists, strikethrough, autolinks, tagFilter, footnotes, math, mermaid, themesPlugin];

// Plugins the user switched off, by id (required ones cannot be).
function loadDisabled() {
  try {
    return new Set(JSON.parse(storage.get(STORE.plugins) ?? "{}").disabled ?? []);
  } catch {
    return new Set();
  }
}

let disabled = loadDisabled();

// The desktop app's plugins, from the user's own folder: [{ name, plugin }]
// or, for one that would not load, [{ name, error }]. None on the web.
const userPlugins = await loadUserPlugins();
// Plugins that would not install, with why (a user's plugin that throws in
// setup, say, or uses an id already taken).
let pluginErrors = new Map();

// The host, from the bundled plugins and the user's, less those switched
// off. A plugin that fails part-way may have registered some of its rules,
// so the host is built again without it, from a clean registry.
function createHost() {
  const all = [...BUNDLED, ...userPlugins.filter((u) => u.plugin).map((u) => u.plugin)];
  const plugins = all.filter((p) => p.required || !disabled.has(p.id));
  const errors = new Map();
  const onError = (plugin, err) => errors.set(plugin, err?.message ?? String(err));
  let host = createMarkHippo({ plugins, onError });
  if (errors.size) host = createMarkHippo({ plugins: plugins.filter((p) => !errors.has(p)), onError });
  pluginErrors = errors;
  return host;
}
let mh = createHost();

// The preview's source-line marks, which synced scroll steers by, go in an
// attribute named afresh each session, so raw HTML in a document cannot
// plant marks of its own.
const LINE_ATTRIBUTE = `data-line-${Math.random().toString(36).slice(2, 10)}`;
// Task checkboxes are live, carrying their source offset — in an attribute
// named afresh each session too.
const TASK_ATTRIBUTE = `data-task-${Math.random().toString(36).slice(2, 10)}`;
const RENDER_OPTIONS = { html: true, safe: true, sourceLines: LINE_ATTRIBUTE, headingIds: true, taskAttribute: TASK_ATTRIBUTE };
// Exports have neither: nothing in them follows the editor.
const EXPORT_OPTIONS = { html: true, safe: true, headingIds: true };

// The last parse, and the text it was of; and the text the preview shows.
let ast = null;
let parsedText = null;
let renderedText = null;
let filename = storage.get(STORE.filename) || "untitled.md";
// The desktop app's document: its file (null while untitled, and always on
// the web), and the text last opened or saved, against which an edit is an
// unsaved change.
let docPath = null;
let savedText = null;
// What the shell was last told (null: nothing yet, so the first is sent).
let reportedDirty = null;

const status = new StatusBar({ parse: $("mh-status-parse"), doc: $("mh-status-doc"), cursor: $("mh-status-cursor"), note: $("mh-status-note") });
const preview = new PreviewView($("mh-preview"), document.querySelector(".mh-pane--preview"), {
  taskAttribute: TASK_ATTRIBUTE,
  onTask: toggleTask,
  // Math and diagrams, drawn in the page's mode.
  onUpdate: () => enhance($("mh-preview"), mh.registry, { dark: themes.resolvedMode() === "dark" }),
  // In the desktop app, the document's own pictures are files beside it.
  rewrite: (root) => {
    if (!docPath) return;
    for (const img of root.querySelectorAll("img[src]")) {
      const url = documentImageUrl(img.getAttribute("src"));
      if (url) img.setAttribute("src", url);
    }
  },
});

// A task ticked in the preview is ticked in the source: [ ] ↔ [x].
function toggleTask(offset) {
  // The preview is behind the editor (typing it has not caught up with):
  // its offsets are stale. Catch up instead; the next click ticks.
  if (editor.value !== renderedText) {
    render();
    return;
  }
  const marker = editor.value.slice(offset, offset + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return;
  editor.editAt(offset + 1, offset + 2, marker[1] === " " ? "x" : " ");
  render();
  // The preview was redrawn: keep the focus on the same checkbox.
  $("mh-preview").querySelector(`input[${TASK_ATTRIBUTE}="${offset}"]`)?.focus({ preventScroll: true });
}
const editor = new EditorView($("mh-source"), {
  highlight: $("mh-highlight"),
  scroller: $("mh-source-scroll"),
  onChange: () => {
    scheduleParse();
    scheduleRender();
    showDirty();
  },
  onCursor: (pos) => status.cursor(pos),
});

// Two speeds: the edit pane's colours follow a short pause in typing, the
// preview a longer one. Both use the same parse — incremental, so the
// frequent one stays cheap.
const scheduleParse = debounce(parse, HIGHLIGHT_DELAY_MS);
const scheduleRender = debounce(render, RENDER_DELAY_MS);

// The document is kept in the browser after a longer pause still, and only
// when it has changed: with pictures in it, a write can be megabytes.
let storedText = storage.get(STORE.document);
function store() {
  const text = editor.value;
  if (text === storedText) return;
  const kept = storage.set(STORE.document, text);
  if (kept) storedText = text;
  // A document too big for the browser's storage would come back as it
  // last fitted: say so while it is true.
  status.warning(kept ? "" : "Too big to keep in this browser: Save to keep a copy");
}
const scheduleStore = debounce(store, STORE_DELAY_MS);

// Suggestions are the fast path: they open on the keystroke, parsing first
// (incrementally) if the colours have not caught up yet.
editor.attach(
  new Autocomplete(editor, $("mh-complete"), {
    complete(text, offset, options) {
      parse();
      return mh.complete(ast, text, offset, options);
    },
  }),
);

function parse() {
  const text = editor.value;
  if (text === parsedText) return;
  const t0 = performance.now();
  const stats = { mode: "full" };
  ast = ast ? mh.reparse(ast, text, { stats }) : mh.parse(text);
  editor.highlight(text, mh.highlight(ast));
  parsedText = text;
  status.parsed(stats, performance.now() - t0, ast);
  scheduleStore();
  // The navigation trio reads the same tree.
  headings = outline(ast);
  outlineView.update(headings);
  minimap.invalidate();
  sync.invalidate();
  showPlace();
}

function render() {
  scheduleParse.cancel();
  parse();
  preview.update(mh.render(ast, RENDER_OPTIONS));
  renderedText = parsedText;
  sync.invalidate();
}

// ── Navigation: outline, minimap, synced scroll ────────────────────────────

let headings = [];
const outlineView = new OutlineView({
  panel: $("mh-outline"),
  list: $("mh-outline-list"),
  empty: $("mh-outline-empty"),
  onJump: (heading) => sync.jumpTo(heading.line),
});
const minimap = new Minimap($("mh-minimap"), { editor });
const sync = new ScrollSync({
  editor,
  preview: document.querySelector(".mh-pane--preview"),
  content: $("mh-preview"),
  lineAttribute: LINE_ATTRIBUTE,
  onScroll: () => {
    minimap.schedule();
    showPlace();
  },
});

// The outline marks the section at the top of the editor — just below the
// very top, where a jump puts the heading it jumped to.
function showPlace() {
  const line = editor.lineAt(editor.scroller.scrollTop + 40);
  outlineView.setCurrent(sectionAt(headings, line));
}

const VIEW = { outline: false, minimap: false, sync: true };
function loadView() {
  try {
    return { ...VIEW, ...JSON.parse(storage.get(STORE.view) ?? "{}") };
  } catch {
    return { ...VIEW };
  }
}
const view = loadView();
const toggles = { outline: $("mh-view-outline"), minimap: $("mh-view-minimap"), sync: $("mh-view-sync") };

function showView() {
  outlineView.show(view.outline);
  minimap.show(view.minimap);
  sync.setEnabled(view.sync);
  for (const [name, button] of Object.entries(toggles)) button.setAttribute("aria-pressed", String(Boolean(view[name])));
}

for (const [name, button] of Object.entries(toggles)) {
  button.addEventListener("click", () => {
    view[name] = !view[name];
    storage.set(STORE.view, JSON.stringify(view));
    showView();
  });
}

// Start again from a full parse — a new document, or a new set of plugins.
function rerender() {
  scheduleParse.cancel();
  scheduleRender.cancel();
  ast = null;
  parsedText = null;
  render();
}

// ── Files ──────────────────────────────────────────────────────────────────

function load(text, name) {
  showName(name);
  editor.setValue(text);
  rerender();
  showDirty();
}

function showName(name) {
  filename = name;
  storage.set(STORE.filename, name);
  $("mh-filename").textContent = name;
  $("mh-filename").title = docPath ?? "The document's file name";
}

async function openFile(file) {
  if (!file) return;
  // The desktop app opens the file itself, in place, so Save writes it back.
  if (desktop) {
    const path = desktop.pathForFile(file);
    if (path) {
      desktop.open(path);
      return;
    }
  }
  load(await file.text(), file.name);
}

// Unsaved changes, told to the desktop app's window (its title, and the
// question before closing). The web keeps the document in the browser.
function showDirty() {
  if (!desktop) return;
  const dirty = editor.value !== savedText;
  if (dirty === reportedDirty) return;
  reportedDirty = dirty;
  desktop.setDirty(dirty);
}

// The file name without its markdown extension, for exports.
const baseName = () => filename.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "") || "untitled";

// A file for the user: downloaded, or in the desktop app saved where they
// choose.
function download(text, name, type) {
  if (desktop) return desktop.saveExport(name, text);
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function save() {
  scheduleRender.flush();
  if (desktop) return saveInPlace();
  download(editor.value, /\.(md|markdown|mdown|mkd|txt)$/i.test(filename) ? filename : `${filename}.md`, "text/markdown");
  return true;
}

// The desktop app's Save, in place (or, untitled or `as`, where the user
// chooses). Answers whether it saved.
async function saveInPlace({ as = false } = {}) {
  const text = editor.value;
  const saved = await desktop.save(text, { as });
  if (!saved) return false;
  const moved = saved.path !== docPath;
  docPath = saved.path;
  savedText = text;
  reportedDirty = false;
  showName(saved.name);
  showDirty();
  // In a new folder, the document's pictures are found from there.
  if (moved) render();
  return true;
}

const fileInput = $("mh-file-input");
fileInput.addEventListener("change", () => {
  openFile(fileInput.files[0]);
  fileInput.value = "";
});

const ACTIONS = {
  new: () => {
    if (desktop) {
      desktop.newDocument();
      return;
    }
    load("", "untitled.md");
    editor.focus();
  },
  open: () => (desktop ? desktop.open() : fileInput.click()),
  save,
};

document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (button && ACTIONS[button.dataset.action]) ACTIONS[button.dataset.action]();
});

document.addEventListener("keydown", (e) => {
  // The desktop app's menu has these shortcuts, and runs them itself.
  if (desktop || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key === "s") {
    e.preventDefault();
    save();
  } else if (key === "o") {
    e.preventDefault();
    ACTIONS.open();
  } else if (key === "p") {
    e.preventDefault();
    runExport("print");
  }
});

// Drag and drop a file anywhere on the page.
const drop = $("mh-drop");
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
document.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  drop.hidden = false;
});
document.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) drop.hidden = true;
});
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  // Images go into the document — where they were dropped, on the editor,
  // or at the caret; anything else is opened.
  const files = [...e.dataTransfer.files];
  const images = files.filter(isImage);
  if (!images.length) {
    openFile(files[0]);
    return;
  }
  const onEditor = e.target instanceof Node && $("mh-source-scroll").contains(e.target);
  addImages(images, onEditor ? editor.offsetAt(e.clientX, e.clientY) : null);
});

// ── Images ─────────────────────────────────────────────────────────────────

// A pasted image (a screenshot, say) goes into the document. Anything with
// text to paste pastes its text, as ever — a spreadsheet's cells come with
// a picture of them, and the cells are what is wanted.
editor.el.addEventListener("paste", (e) => {
  const data = e.clipboardData;
  if (!data || [...data.types].includes("text/plain")) return;
  const images = [...data.files].filter(isImage);
  if (!images.length) return;
  e.preventDefault();
  addImages(images, null);
});

// Each image into the document (images/embed.js), at `at` or in place of
// the selection, then the preview at once. One image's alt text is left
// selected, to type a description over.
async function addImages(files, at) {
  let from = at ?? editor.el.selectionStart;
  let to = at ?? editor.el.selectionEnd;
  let placed = null;
  // The text `from` and `to` are offsets in.
  let expected = editor.value;
  for (const file of files) {
    let image;
    try {
      // In a saved desktop document the picture is a file beside it;
      // otherwise (or if that fails) it goes in the document.
      const beside = docPath ? await saveBeside(file) : null;
      image = beside ? { path: beside } : await importImage(file);
    } catch (err) {
      status.note(err.message, { warn: true });
      continue;
    }
    // Reading it took a moment, in which the text may have changed: the
    // offsets no longer point where they did, so the caret is where it goes.
    const text = editor.value;
    if (text !== expected) {
      from = editor.el.selectionStart;
      to = editor.el.selectionEnd;
    }
    from = Math.min(from, text.length);
    to = Math.min(Math.max(from, to), text.length);
    const alt = altFromName(file.name);
    placed = image.path
      ? { from, to, insert: `![${alt}](${image.path})`, append: "", select: [from + 2, from + 2 + alt.length] }
      : placeImage(text, from, to, { alt, url: image.url }, defines);
    if (placed.append) editor.editAt(text.length, text.length, placed.append);
    editor.replaceRange(placed.from, placed.to, placed.insert);
    from = to = placed.from + placed.insert.length;
    expected = editor.value;
  }
  if (!placed) return;
  if (files.length === 1) editor.el.setSelectionRange(...placed.select);
  else editor.el.setSelectionRange(from, from);
  editor.reportCursor();
  render();
  if (desktop && !docPath && !toldWhereImagesGo) {
    toldWhereImagesGo = true;
    status.note("Save the document, and pictures pasted into it go in an assets folder beside it");
  }
}
let toldWhereImagesGo = false;

// The desktop app: the picture written to assets/ beside the saved
// document, as it is, or converted if it is a kind the page cannot show.
// Answers its path relative to the document.
async function saveBeside(file) {
  let { type } = file;
  let bytes;
  if (SHOWN_AS_FILES.has(type)) {
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const { url } = await importImage(file);
    type = url.slice(5, url.indexOf(";"));
    bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  }
  return desktop.saveImage(file.name, type, bytes);
}

// Whether `text` defines the reference `label` — that the definition at
// its end has not been swallowed by something left open above it.
const defines = (text, label) => Object.hasOwn(mh.parse(text).refs, normalizeLabel(`[${label}]`));

// ── Export ─────────────────────────────────────────────────────────────────

const exporter = new Exporter({
  render: () => {
    parse();
    return mh.render(ast, EXPORT_OPTIONS);
  },
  registry: () => mh.registry,
  colours: () => themes.current().light,
  title: documentTitle,
  printArea: $("mh-print"),
  preview: $("mh-preview"),
  ...(desktop && {
    localImages: inlineDocumentImages,
    printer: () => desktop.print(),
    clipboard: (html, text) => desktop.copy(html, text),
  }),
});

// The desktop document's own pictures, into an export as data: URLs: the
// export is read somewhere else, where their paths lead nowhere.
async function inlineDocumentImages(root) {
  if (!docPath) return;
  await Promise.all(
    [...root.querySelectorAll("img[src]")].map(async (img) => {
      const url = documentImageUrl(img.getAttribute("src"));
      if (!url) return;
      try {
        const response = await fetch(url);
        if (response.ok) img.setAttribute("src", await dataUrl(await response.blob()));
      } catch {
        // Missing: the export keeps the path, as the document does.
      }
    }),
  );
}

// The document's first top-level heading, else its first heading, else
// its file name.
function documentTitle() {
  parse();
  return (headings.find((h) => h.level === 1) ?? headings[0])?.text || baseName();
}

const EXPORTS = {
  print: () => exporter.print(),
  pdf: () => exporter.pdf(() => desktop.printToPDF(`${baseName()}.pdf`)),
  html: async () => download(await exporter.html(), `${baseName()}.html`, "text/html"),
  rtf: async () => download(await exporter.rtf(), `${baseName()}.rtf`, "application/rtf"),
  text: () => download(exporter.text(), `${baseName()}.txt`, "text/plain"),
  copy: async () => {
    await exporter.copy();
    status.note("Copied as rich text, to paste into an email or a document");
  },
};

// Started inside the click or key that asked for it: copying is allowed
// only there.
function runExport(kind) {
  const failed = (err) => {
    console.warn("MarkHippo: export failed:", err);
    status.note(`That did not work: ${err?.message ?? err}`, { warn: true });
  };
  try {
    Promise.resolve(EXPORTS[kind]?.()).catch(failed);
  } catch (err) {
    failed(err);
  }
}

new MenuButton($("mh-export"), $("mh-export-menu"), { onChoose: runExport });

// ── Split pane ─────────────────────────────────────────────────────────────

const panes = $("mh-panes");
const divider = $("mh-divider");

function setSplit(percent) {
  const p = Math.min(80, Math.max(20, percent));
  panes.style.setProperty("--split", `${p}%`);
  divider.setAttribute("aria-valuenow", String(Math.round(p)));
  storage.set(STORE.split, String(p));
}

divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add("mh-divider--dragging");
});
divider.addEventListener("pointermove", (e) => {
  if (!divider.hasPointerCapture(e.pointerId)) return;
  const rect = panes.getBoundingClientRect();
  setSplit(((e.clientX - rect.left) / rect.width) * 100);
});
divider.addEventListener("pointerup", (e) => {
  divider.releasePointerCapture(e.pointerId);
  divider.classList.remove("mh-divider--dragging");
});
divider.addEventListener("keydown", (e) => {
  const now = Number(divider.getAttribute("aria-valuenow"));
  if (e.key === "ArrowLeft") setSplit(now - 5);
  else if (e.key === "ArrowRight") setSplit(now + 5);
  else return;
  e.preventDefault();
});

// ── Theme ──────────────────────────────────────────────────────────────────

// The palette (Themes dialog) and the mode (the header button) are separate
// choices; the palettes come from the Hippo palette, the plugins, and the
// user (theme-manager.js).
const themes = new ThemeManager({ storage, registry: () => mh.registry });
const themeDialog = new ThemeDialog($("mh-themes"), { themes, download });

const MODES = [
  { id: "system", label: "System", icon: "mh-i-system" },
  { id: "light", label: "Light", icon: "mh-i-sun" },
  { id: "dark", label: "Dark", icon: "mh-i-moon" },
];
const themeButton = $("mh-theme");

function showMode() {
  const mode = MODES.find((m) => m.id === themes.mode) ?? MODES[0];
  themeButton.querySelector("use").setAttribute("href", `#${mode.icon}`);
  themeButton.querySelector(".mh-theme-label").textContent = mode.label;
  themeButton.setAttribute("aria-label", mode.id === "system" ? "Mode: follow the system" : `Mode: ${mode.label}`);
}

themeButton.addEventListener("click", () => {
  themes.setMode(MODES[(MODES.findIndex((m) => m.id === themes.mode) + 1) % MODES.length].id);
});
let wasDark = null;
themes.onChange(() => {
  showMode();
  minimap.invalidate();
  // Diagrams are drawn for light or dark: redraw them when that changes.
  const dark = themes.resolvedMode() === "dark";
  if (wasDark !== null && dark !== wasDark && ast) {
    preview.update(mh.render(ast, RENDER_OPTIONS));
    renderedText = parsedText;
  }
  wasDark = dark;
});
$("mh-themes-open").addEventListener("click", () => themeDialog.open());

// ── Plugins ────────────────────────────────────────────────────────────────

const pluginList = $("mh-plugin-list");

function showPlugins() {
  const running = new Set(mh.plugins.map((p) => p.id));
  const yours = userPlugins.map(({ name, plugin, error }) => plugin ?? { id: null, name, source: name, error });
  pluginList.replaceChildren(
    ...[...BUNDLED, ...yours].map((plugin) => {
      const own = !BUNDLED.includes(plugin);
      const error = plugin.error ?? pluginErrors.get(plugin);
      const li = document.createElement("li");
      li.className = "mh-plugin";
      const label = document.createElement("label");
      label.className = "mh-plugin-head";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.plugin = plugin.id;
      box.checked = running.has(plugin.id);
      box.disabled = Boolean(plugin.required) || !plugin.id;
      const name = document.createElement("span");
      name.className = "mh-plugin-name";
      name.textContent = plugin.name ?? plugin.id;
      label.append(box, name);
      if (plugin.version) {
        const version = document.createElement("span");
        version.className = "mh-plugin-version";
        version.textContent = plugin.version;
        label.append(version);
      }
      if (plugin.required || own) {
        const badge = document.createElement("span");
        badge.className = "mh-plugin-badge";
        badge.textContent = plugin.required ? "Required" : "Yours";
        label.append(badge);
      }
      const desc = document.createElement("p");
      desc.className = "mh-plugin-desc";
      desc.textContent = plugin.description ?? "";
      li.append(label, desc);
      if (own) {
        const source = userPlugins.find((u) => u.plugin === plugin)?.name ?? plugin.source;
        const where = document.createElement("p");
        where.className = "mh-plugin-source";
        where.textContent = `From ${source}, in your plugins folder`;
        li.append(where);
      }
      if (error) {
        li.classList.add("mh-plugin--failed");
        const why = document.createElement("p");
        why.className = "mh-plugin-error";
        why.textContent = `Not running: ${error}`;
        li.append(why);
      }
      return li;
    }),
  );
}

pluginList.addEventListener("change", (e) => {
  const id = e.target.dataset.plugin;
  if (!id) return;
  if (e.target.checked) disabled.delete(id);
  else disabled.add(id);
  storage.set(STORE.plugins, JSON.stringify({ disabled: [...disabled] }));
  mh = createHost();
  rerender();
  // A palette's plugin may have come or gone.
  themes.apply();
});

$("mh-plugins-open").addEventListener("click", () => {
  showPlugins();
  $("mh-plugins").showModal();
});

// The desktop app: the folder the user's plugins go in, and picking up
// what was added there (the page loads them as it starts).
if (desktop) {
  $("mh-plugins-desktop").hidden = false;
  $("mh-plugins-folder").addEventListener("click", () =>
    desktop.openPluginsFolder().catch((err) => status.note(`The plugins folder could not be opened: ${err.message}`, { warn: true })),
  );
  $("mh-plugins-reload").addEventListener("click", () => window.location.reload());
}

// ── About ──────────────────────────────────────────────────────────────────

$("mh-about-open").addEventListener("click", () => $("mh-about").showModal());

// ── The desktop app ────────────────────────────────────────────────────────

// The menu's commands. Some the shell waits on, and gets the answer of:
// "save" before closing (did it save?), "discard" (done).
const COMMANDS = {
  save: () => save(),
  "save-as": () => saveInPlace({ as: true }),
  // Closing without saving: the document kept in the browser goes back to
  // the saved one, so the changes are not there next time either.
  discard: () => {
    scheduleStore.cancel();
    storage.set(STORE.document, savedText ?? "");
    storedText = savedText ?? "";
    return true;
  },
  "toggle:outline": () => toggles.outline.click(),
  "toggle:minimap": () => toggles.minimap.click(),
  "toggle:sync": () => toggles.sync.click(),
  "show:plugins": () => $("mh-plugins-open").click(),
  "show:themes": () => $("mh-themes-open").click(),
};

// The first document: a file the app was opened with, or reopened from
// last time; or, a reload, the one in the browser; or, as on the web, the
// browser's — untitled.
async function startDesktop() {
  const start = await desktop.initial();
  $("mh-export-pdf").hidden = false;
  $("mh-about-version").textContent = `Version ${start.version} · desktop app`;
  $("mh-about-version").hidden = false;
  desktop.onLoad((doc) => {
    docPath = doc.path;
    savedText = doc.text;
    reportedDirty = null;
    load(doc.text, doc.name);
    editor.focus();
  });
  desktop.onCommand((command) => {
    if (command.startsWith("export:")) return runExport(command.slice(7));
    return COMMANDS[command]?.();
  });
  const doc = start.document;
  if (doc && start.reload) {
    docPath = doc.path;
    savedText = doc.savedText;
    showName(doc.name);
    return storage.get(STORE.document) ?? doc.savedText;
  }
  if (doc) {
    docPath = doc.path;
    savedText = doc.text;
    showName(doc.name);
    return doc.text;
  }
  const text = storage.get(STORE.document) ?? SAMPLE;
  savedText = text;
  showName("untitled.md");
  return text;
}

// ── Start ──────────────────────────────────────────────────────────────────

showView();
themes.apply();
const split = Number(storage.get(STORE.split));
if (split) setSplit(split);
$("mh-filename").textContent = filename;
editor.setValue(desktop ? await startDesktop() : (storage.get(STORE.document) ?? SAMPLE));
render();
showDirty();
// Leaving, or hidden (and perhaps never shown again): keep what is there.
const keep = () => {
  scheduleParse.flush();
  scheduleStore.flush();
};
window.addEventListener("beforeunload", keep);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") keep();
});
