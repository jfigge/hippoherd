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
 * scroll-sync.js — keeping the editor and the preview at the same place.
 *
 * Scrolling either pane scrolls the other to match, through the anchors of
 * nav/scroll-map.js: each preview element the renderer marked with its
 * source line (`lineAttribute`, the renderer's sourceLines) is paired with
 * that line's top in the editor.
 * The anchors are measured lazily — after a render, an edit or a resize
 * they are only marked stale — so scrolling costs a binary search.
 *
 * A programmatic scroll fires a scroll event of its own; the position it
 * was set to is remembered, and the event that reports it is not synced
 * back (no feedback loop, no jitter).
 */

import { scrollMap } from "./nav/scroll-map.js";

export class ScrollSync {
  // `editor`: the EditorView; `preview`: the preview's scroller; `content`:
  // the rendered document; `onScroll`: called after either pane scrolls.
  constructor({ editor, preview, content, lineAttribute = "data-line", onScroll }) {
    this.editor = editor;
    this.lineAttribute = lineAttribute;
    this.preview = preview;
    this.content = content;
    this.onScroll = onScroll ?? (() => {});
    this.enabled = true;
    this.map = null;
    this.expect = new Map();
    editor.scroller.addEventListener("scroll", () => this.scrolled(editor.scroller, preview, "forward"), { passive: true });
    preview.addEventListener("scroll", () => this.scrolled(preview, editor.scroller, "backward"), { passive: true });
    // The panes' sizes, and the rendered document's — which changes on its
    // own as images load or <details> open.
    const resized = new ResizeObserver(() => this.invalidate());
    resized.observe(editor.scroller);
    resized.observe(preview);
    resized.observe(content);
  }

  invalidate() {
    this.map = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.scrolled(this.editor.scroller, this.preview, "forward");
  }

  scrolled(from, to, direction) {
    const expected = this.expect.get(from);
    if (expected !== undefined) {
      this.expect.delete(from);
      if (Math.abs(from.scrollTop - expected) < 2) {
        this.onScroll();
        return;
      }
    }
    if (this.enabled) this.follow(from, to, direction);
    this.onScroll();
  }

  follow(from, to, direction) {
    const map = this.measure();
    const top = Math.round(map[direction](from.scrollTop));
    if (Math.abs(to.scrollTop - top) < 1) return;
    to.scrollTop = top;
    // What the browser actually settled on (clamped), not what was asked.
    this.expect.set(to, to.scrollTop);
  }

  // Jump both panes to source `line` (the outline): the editor to the
  // line, the preview exactly to what was rendered from it — not to a
  // mapped position, so neither scroll is synced back over the other.
  jumpTo(line) {
    this.editor.goToLine(line);
    this.expect.set(this.editor.scroller, this.editor.scroller.scrollTop);
    const el = [...this.anchors()].find((e) => this.lineOf(e) >= line);
    if (!el) return;
    this.preview.scrollTop = this.offsetIn(el) - 8;
    this.expect.set(this.preview, this.preview.scrollTop);
  }

  // The renderer's line marks.
  anchors() {
    return this.content.querySelectorAll(`[${this.lineAttribute}]`);
  }

  lineOf(el) {
    return Number(el.getAttribute(this.lineAttribute));
  }

  measure() {
    if (this.map) return this.map;
    const pairs = [];
    const base = this.offsetIn(null);
    for (const el of this.anchors()) {
      pairs.push([this.editor.lineTop(this.lineOf(el)), el.getBoundingClientRect().top + base]);
    }
    const ed = this.editor.scroller;
    this.map = scrollMap(pairs, ed.scrollHeight - ed.clientHeight, this.preview.scrollHeight - this.preview.clientHeight);
    return this.map;
  }

  // An element's top in the preview's scrolled content — or, given null,
  // what to add to a client top to get that.
  offsetIn(el) {
    const base = this.preview.scrollTop - this.preview.getBoundingClientRect().top;
    return el ? el.getBoundingClientRect().top + base : base;
  }
}
