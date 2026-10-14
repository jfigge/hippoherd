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
 * outline-view.js — the outline panel: the document's headings, indented by
 * level, the one whose section is in view marked. Choosing one jumps the
 * editor (and the preview) to it.
 */

export class OutlineView {
  constructor({ panel, list, empty, onJump }) {
    this.panel = panel;
    this.list = list;
    this.empty = empty;
    this.onJump = onJump;
    this.items = [];
    this.key = "";
    this.current = -1;
    list.addEventListener("click", (e) => {
      const button = e.target.closest("[data-index]");
      if (button) this.onJump(this.items[Number(button.dataset.index)]);
    });
  }

  get visible() {
    return !this.panel.hidden;
  }

  show(on) {
    this.panel.hidden = !on;
  }

  // New headings (outline.js). Redrawn only when they changed; lines that
  // merely moved (Enter typed above) are updated in place.
  update(items) {
    const key = items.map((h) => `${h.level}\u0000${h.text}`).join("\u0001");
    this.items = items;
    if (key === this.key) {
      for (const button of this.list.querySelectorAll("[data-index]")) {
        button.title = `Line ${items[Number(button.dataset.index)].line}`;
      }
      return;
    }
    this.key = key;
    this.current = -1;
    const top = Math.min(...items.map((h) => h.level));
    this.list.replaceChildren(
      ...items.map((h, i) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = `mh-outline-item mh-outline-item--h${h.level}`;
        button.dataset.index = String(i);
        button.style.setProperty("--depth", String(h.level - top));
        button.textContent = h.text || "(empty heading)";
        button.title = `Line ${h.line}`;
        li.append(button);
        return li;
      }),
    );
    this.empty.hidden = items.length > 0;
  }

  // Mark heading `index` as the one in view.
  setCurrent(index) {
    if (index === this.current) return;
    this.list.querySelector("[aria-current]")?.removeAttribute("aria-current");
    this.current = index;
    const button = this.list.querySelector(`[data-index="${index}"]`);
    if (!button) return;
    button.setAttribute("aria-current", "location");
    if (this.visible) button.scrollIntoView({ block: "nearest" });
  }
}
