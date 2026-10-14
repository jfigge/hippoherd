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
 * menu-button.js — a button that opens a menu of actions (Export), in the
 * ARIA menu button pattern.
 *
 * The button opens it (also with ↓, or ↑ for the last item); in it, ↑ ↓
 * Home End and a letter move between the items, Enter or Space chooses,
 * Escape closes it back to the button, and Tab or a click elsewhere closes
 * it. `onChoose(value)` gets the chosen item's data-value.
 */

const ITEM = '[role="menuitem"]';

export class MenuButton {
  constructor(button, menu, { onChoose } = {}) {
    this.button = button;
    this.menu = menu;
    this.onChoose = onChoose ?? (() => {});

    button.addEventListener("click", () => (this.isOpen ? this.close() : this.open(0)));
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      this.open(e.key === "ArrowUp" ? -1 : 0);
    });
    menu.addEventListener("keydown", (e) => this.keydown(e));
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(ITEM);
      if (!item || !menu.contains(item)) return;
      this.close(true);
      this.onChoose(item.dataset.value);
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.isOpen && !menu.contains(e.target) && !button.contains(e.target)) this.close();
    });
    menu.addEventListener("focusout", (e) => {
      if (this.isOpen && e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== button) this.close();
    });
  }

  get isOpen() {
    return !this.menu.hidden;
  }

  get items() {
    return [...this.menu.querySelectorAll(ITEM)].filter((item) => !item.disabled && !item.hidden);
  }

  // Open with the item at `index` focused (negative counts from the end).
  open(index) {
    this.menu.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.items.at(index)?.focus();
  }

  close(focusButton = false) {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (focusButton) this.button.focus();
  }

  keydown(e) {
    const items = this.items;
    const at = items.indexOf(document.activeElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      this.close(true);
      return;
    } else if (e.key === "Tab") {
      this.close();
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // The next item, after this one, starting with the letter.
      const letter = e.key.toLowerCase();
      for (let k = 1; k <= items.length; k++) {
        const item = items[(at + k) % items.length];
        if (item.textContent.trim().toLowerCase().startsWith(letter)) {
          next = (at + k) % items.length;
          break;
        }
      }
    }
    if (next === -1) return;
    e.preventDefault();
    items[next].focus();
  }
}
