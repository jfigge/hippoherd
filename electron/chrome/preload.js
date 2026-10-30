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

// preload.js — the tab strip's bridge to the host, and nothing else.
//
// Only the host's own page (chrome/tabs.html) gets a preload. The viewers
// still get none: they are reached through window.hippoViewer, as before.
// The strip is told what to draw, and says which tab was clicked or closed —
// or, with no document open, that Open… or a New link was clicked — and
// asks for the theme to change.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viewHippoTabs", {
  onState: (render) => ipcRenderer.on("tabs:state", (_event, state) => render(state)),
  ready: () => ipcRenderer.send("tabs:ready"),
  activate: (id) => ipcRenderer.send("tabs:activate", id),
  close: (id) => ipcRenderer.send("tabs:close", id),
  open: () => ipcRenderer.send("tabs:open"),
  create: (viewerId) => ipcRenderer.send("tabs:new", viewerId),
  cycleTheme: () => ipcRenderer.send("tabs:theme"),
});
