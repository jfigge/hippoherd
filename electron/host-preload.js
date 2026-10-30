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

// host-preload.js — window.viewHippoHost, what the app does for a viewer that
// a browser tab cannot (features/viewhippo-app-build-brief.md, "Desktop
// features beyond the contract").
//
// window.hippoViewer is the host calling the viewer; this is the other way.
// Every part of it is optional: a viewer feature-detects what it uses, and on
// the web, or in an older ViewHippo, there is no viewHippoHost and it does
// what it does in a browser. Each call is one named message, answered in
// main.js for the document whose page sent it; nothing of Node or Electron
// itself is handed over.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const isText = (value) => typeof value === "string";

contextBridge.exposeInMainWorld("viewHippoHost", {
  // The text may have changed. The host compares it with the saved text
  // itself (for the tab's dot and the window's edited state), so this says
  // nothing more and may be called on every edit.
  changed: () => ipcRenderer.send("host:changed"),
  // An export (text or bytes), saved where the user chooses: its path, or
  // null if cancelled.
  saveExport: (name, data) => ipcRenderer.invoke("host:save-export", { name, data }),
  // Print the page through the system's dialog: whether it printed.
  print: () => ipcRenderer.invoke("host:print"),
  // The page as it would print, saved as a PDF where the user chooses: its
  // path, or null.
  printToPDF: (name) => ipcRenderer.invoke("host:print-pdf", { name: isText(name) ? name : "" }),
  // The user's own plugins for this viewer: [{ name, url }] to import.
  plugins: () => ipcRenderer.invoke("host:plugins"),
  // That folder, made if need be, in Finder or Explorer.
  openPluginsFolder: () => ipcRenderer.invoke("host:open-plugins-folder"),
  // Load the page again, to pick up plugins added to the folder. The host
  // hands the new page the document as it stands, unsaved changes and all;
  // a page reloading itself would come back empty.
  reload: () => ipcRenderer.send("host:reload"),
});
