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
 * preview, the status bar, files, images, export and the theme.
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
import { enhance } from "./enhance.js";
import { Exporter } from "./exporter.js";
import { importImage, isImage } from "./image-import.js";
import { altFromName, placeImage } from "./images/embed.js";
import { MenuButton } from "./menu-button.js";
import { normalizeLabel } from "./parser/normalize.js";
import { ThemeDialog } from "./theme-dialog.js";
import { ThemeManager } from "./theme-manager.js";
import { Minimap } from "./minimap.js";
import { OutlineView } from "./outline-view.js";
import { ScrollSync } from "./scroll-sync.js";
import { outline, sectionAt } from "./nav/outline.js";
import { HIGHLIGHT_DELAY_MS, RENDER_DELAY_MS, debounce } from "./debounce.js";
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
const createHost = () => createMarkHippo({ plugins: BUNDLED.filter((p) => p.required || !disabled.has(p.id)) });
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

const status = new StatusBar({ parse: $("mh-status-parse"), doc: $("mh-status-doc"), cursor: $("mh-status-cursor"), note: $("mh-status-note") });
const preview = new PreviewView($("mh-preview"), document.querySelector(".mh-pane--preview"), {
  taskAttribute: TASK_ATTRIBUTE,
  onTask: toggleTask,
  // Math and diagrams, drawn in the page's mode.
  onUpdate: () => enhance($("mh-preview"), mh.registry, { dark: themes.resolvedMode() === "dark" }),
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
  },
  onCursor: (pos) => status.cursor(pos),
});

// Two speeds: the edit pane's colours follow a short pause in typing, the
// preview a longer one. Both use the same parse — incremental, so the
// frequent one stays cheap.
const scheduleParse = debounce(parse, HIGHLIGHT_DELAY_MS);
const scheduleRender = debounce(render, RENDER_DELAY_MS);

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
  // A document too big for the browser's storage (images, mostly) would
  // come back as it last fitted: say so while it is true.
  status.warning(storage.set(STORE.document, text) ? "" : "Too big to keep in this browser: Save to keep a copy");
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
  filename = name;
  storage.set(STORE.filename, name);
  $("mh-filename").textContent = name;
  editor.setValue(text);
  rerender();
}

async function openFile(file) {
  if (!file) return;
  load(await file.text(), file.name);
}

// The file name without its markdown extension, for exports.
const baseName = () => filename.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "") || "untitled";

function download(text, name, type) {
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
  download(editor.value, /\.(md|markdown|mdown|mkd|txt)$/i.test(filename) ? filename : `${filename}.md`, "text/markdown");
}

const fileInput = $("mh-file-input");
fileInput.addEventListener("change", () => {
  openFile(fileInput.files[0]);
  fileInput.value = "";
});

const ACTIONS = {
  new: () => {
    load("", "untitled.md");
    editor.focus();
  },
  open: () => fileInput.click(),
  save,
};

document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (button && ACTIONS[button.dataset.action]) ACTIONS[button.dataset.action]();
});

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
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
  for (const file of files) {
    let image;
    try {
      image = await importImage(file);
    } catch (err) {
      status.note(err.message, { warn: true });
      continue;
    }
    // Reading it took a moment, in which the text may have changed.
    const text = editor.value;
    from = Math.min(from, text.length);
    to = Math.min(Math.max(from, to), text.length);
    placed = placeImage(text, from, to, { alt: altFromName(file.name), url: image.url }, defines);
    if (placed.append) editor.editAt(text.length, text.length, placed.append);
    editor.replaceRange(placed.from, placed.to, placed.insert);
    from = to = placed.from + placed.insert.length;
  }
  if (!placed) return;
  if (files.length === 1) editor.el.setSelectionRange(...placed.select);
  else editor.el.setSelectionRange(from, from);
  editor.reportCursor();
  render();
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
});

// The document's first top-level heading, else its first heading, else
// its file name.
function documentTitle() {
  parse();
  return (headings.find((h) => h.level === 1) ?? headings[0])?.text || baseName();
}

const EXPORTS = {
  print: () => exporter.print(),
  html: async () => download(await exporter.html(), `${baseName()}.html`, "text/html"),
  rtf: () => download(exporter.rtf(), `${baseName()}.rtf`, "application/rtf"),
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
  if (wasDark !== null && dark !== wasDark && ast) preview.update(mh.render(ast, RENDER_OPTIONS));
  wasDark = dark;
});
$("mh-themes-open").addEventListener("click", () => themeDialog.open());

// ── Plugins ────────────────────────────────────────────────────────────────

const pluginList = $("mh-plugin-list");

function showPlugins() {
  const running = new Set(mh.plugins.map((p) => p.id));
  pluginList.replaceChildren(
    ...BUNDLED.map((plugin) => {
      const li = document.createElement("li");
      li.className = "mh-plugin";
      const label = document.createElement("label");
      label.className = "mh-plugin-head";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.plugin = plugin.id;
      box.checked = running.has(plugin.id);
      box.disabled = Boolean(plugin.required);
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
      if (plugin.required) {
        const badge = document.createElement("span");
        badge.className = "mh-plugin-badge";
        badge.textContent = "Required";
        label.append(badge);
      }
      const desc = document.createElement("p");
      desc.className = "mh-plugin-desc";
      desc.textContent = plugin.description ?? "";
      li.append(label, desc);
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

// ── About ──────────────────────────────────────────────────────────────────

$("mh-about-open").addEventListener("click", () => $("mh-about").showModal());

// ── Start ──────────────────────────────────────────────────────────────────

showView();
themes.apply();
const split = Number(storage.get(STORE.split));
if (split) setSplit(split);
$("mh-filename").textContent = filename;
editor.setValue(storage.get(STORE.document) ?? SAMPLE);
render();
window.addEventListener("beforeunload", () => scheduleParse.flush());
