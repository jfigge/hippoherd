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

// tabs.js — draws the tab strip from the state main.js sends.
//
// A tab always shows the short name, and its tooltip always the full path
// (features/viewhippo-tabs-addendum.md). Click a tab to show it; click its ×,
// or middle-click it, to close it. A tab with unsaved changes shows a dot in
// place of its ×, until the pointer is on it. Each tab carries its viewer's logo, and the
// right of the strip the theme, which the viewers' own headers would. With no
// document open the page says how to open one instead. Everything else is
// main.js's: this page holds no state of its own beyond the last state it was
// sent.
"use strict";

(() => {
  const api = window.viewHippoTabs;
  const bar = document.getElementById("bar");
  const strip = document.getElementById("tabs");
  const empty = document.getElementById("empty");
  let state = { showTabs: true, active: null, tabs: [], empty: null, theme: "system" };
  const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" };

  function tab(t) {
    const el = document.createElement("div");
    el.className = t.dirty ? "tab dirty" : "tab";
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(t.id === state.active));
    el.title = t.tooltip;
    el.style.setProperty("--viewer", t.color);

    const mark = document.createElement("img");
    mark.className = "mark";
    mark.src = t.icon;
    mark.alt = "";
    mark.title = t.viewer;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t.name;

    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.textContent = "×";
    const label = t.dirty ? `Close ${t.name} (unsaved changes)` : `Close ${t.name}`;
    close.setAttribute("aria-label", label);
    close.title = label;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      api.close(t.id);
    });

    el.addEventListener("mousedown", (event) => {
      if (event.button === 0 && event.target !== close) api.activate(t.id);
    });
    el.addEventListener("auxclick", (event) => {
      if (event.button === 1) api.close(t.id);
    });

    el.append(mark, name, close);
    return el;
  }

  // "Or start a new one: JSON · YAML · Markdown", one link per viewer.
  function newLinks(viewers) {
    const parts = [document.createTextNode("Or start a new one: ")];
    viewers.forEach((v, i) => {
      if (i) parts.push(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.textContent = v.formatName;
      a.addEventListener("click", () => api.create(v.id));
      parts.push(a);
    });
    return parts;
  }

  function render(next) {
    state = next;
    const none = state.tabs.length === 0;
    document.body.hidden = !none && !state.showTabs;
    bar.hidden = none;
    const theme = THEME_LABEL[state.theme] ? state.theme : "system";
    document.getElementById("theme-label").textContent = THEME_LABEL[theme];
    document.getElementById("theme-icon").setAttribute("href", `#i-${theme}`);
    document.getElementById("theme").title = `Appearance: ${THEME_LABEL[theme]} — click for the next`;
    empty.hidden = !none;
    if (none && state.empty) {
      document.getElementById("formats").textContent = `${state.empty.formats} document`;
      document.getElementById("shortcut").textContent = state.empty.shortcut;
      document.getElementById("new").replaceChildren(...newLinks(state.empty.viewers));
    }
    strip.replaceChildren(...state.tabs.map(tab));
    const active = strip.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // A click on the strip leaves the keyboard with the document, not here:
  // ⌘C, ⌘F and the rest belong to the viewer on screen.
  document.addEventListener("mouseup", () => {
    if (state.active !== null) api.activate(state.active);
  });

  // The mouse wheel scrolls an overflowing strip sideways.
  strip.addEventListener("wheel", (event) => {
    if (event.deltaY) strip.scrollLeft += event.deltaY;
  });

  document.getElementById("open").addEventListener("click", () => api.open());
  document.getElementById("theme").addEventListener("click", () => api.cycleTheme());

  api.onState(render);
  api.ready();
})();
