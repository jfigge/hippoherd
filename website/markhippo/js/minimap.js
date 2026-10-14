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
 * minimap.js — the whole source in miniature, down the side of the editor.
 *
 * Every line is drawn as short bars where its words are, in the colours the
 * parser gave them (the edit pane's own segments, so a heading shows in the
 * heading colour and a code block as a block of code colour). A shaded band
 * marks the part of the document in view; clicking or dragging anywhere
 * scrolls there.
 *
 * Lines are up to 3px tall, fewer when the document would not fit, so the
 * map is always the whole document. The text is drawn into an offscreen
 * canvas only when it or the theme changes; scrolling just redraws the
 * band over it.
 */

const MAX_LINE = 3;
const COLUMNS = 100;

// Which colour a segment takes, by the most specific of its classes.
const COLOURS = [
  [/mh-tk-([a-z]+)/, (m) => `--tk-${m[1]}`],
  [/mh-md-(?:code|codeblock|math)\b/, () => "--md-code"],
  [/mh-md-(?:footnote)\b/, () => "--tk-function"],
  [/mh-md-task\b/, () => "--accent"],
  [/mh-md-(?:marker|url|fence|hr|escape|info)\b/, () => "--muted"],
  [/mh-md-(?:heading|quote|list)\b/, () => "--accent"],
  [/mh-md-(?:link|image|label)\b/, () => "--tk-function"],
  [/mh-md-html\b/, () => "--tk-tag"],
  [/mh-md-string\b/, () => "--tk-string"],
  [/mh-md-entity\b/, () => "--tk-number"],
];

export class Minimap {
  constructor(canvas, { editor }) {
    this.canvas = canvas;
    this.editor = editor;
    this.content = document.createElement("canvas");
    this.dirty = true;
    this.frame = 0;
    this.lineHeight = MAX_LINE;

    const go = (e) => {
      const y = e.clientY - canvas.getBoundingClientRect().top;
      const line = Math.floor(y / this.lineHeight) + 1;
      const scroller = editor.scroller;
      scroller.scrollTop = editor.lineTop(line) - scroller.clientHeight / 2;
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      go(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) go(e);
    });
    new ResizeObserver(() => this.invalidate()).observe(canvas);
  }

  get visible() {
    return !this.canvas.hidden;
  }

  show(on) {
    this.canvas.hidden = !on;
    if (on) this.invalidate();
  }

  // The text or its colours changed: redraw everything.
  invalidate() {
    this.dirty = true;
    this.schedule();
  }

  // Only the view moved: redraw the band.
  schedule() {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.dirty = true;
    }
    if (this.dirty) this.drawText(width, height, dpr);
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.content, 0, 0);
    ctx.scale(dpr, dpr);

    // The band: the lines in view.
    const scroller = this.editor.scroller;
    const first = this.editor.lineAt(scroller.scrollTop);
    const last = this.editor.lineAt(scroller.scrollTop + scroller.clientHeight);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#888";
    const top = (first - 1) * this.lineHeight;
    const band = Math.max(6, (last - first + 1) * this.lineHeight);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(0, top, width, band);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, top, width, 1);
    ctx.fillRect(0, top + band - 1, width, 1);
    ctx.globalAlpha = 1;
  }

  drawText(width, height, dpr) {
    this.dirty = false;
    const { text, lines } = this.editor.hl;
    const rows = text.split("\n");
    this.lineHeight = Math.min(MAX_LINE, height / Math.max(1, rows.length));
    const lh = this.lineHeight;
    const charWidth = (width - 8) / COLUMNS;
    this.content.width = this.canvas.width;
    this.content.height = this.canvas.height;
    const ctx = this.content.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(document.documentElement);
    const cache = new Map();
    const colour = (className) => {
      if (cache.has(className)) return cache.get(className);
      let name = "--subtext";
      for (const [re, to] of COLOURS) {
        const m = className.match(re);
        if (m) {
          name = to(m);
          break;
        }
      }
      const value = style.getPropertyValue(name).trim() || "#888";
      cache.set(className, value);
      return value;
    };
    const bar = Math.max(0.5, lh * 0.7);
    const words = /\S+/g;
    const run = (row, from, to, y) => {
      words.lastIndex = from;
      let m;
      while ((m = words.exec(row)) !== null && m.index < to) {
        const end = Math.min(to, m.index + m[0].length);
        if (m.index >= COLUMNS) break;
        ctx.fillRect(4 + m.index * charWidth, y, (Math.min(end, COLUMNS) - m.index) * charWidth, bar);
        if (end < m.index + m[0].length) break;
      }
    };

    ctx.globalAlpha = 0.85;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const y = i * lh;
      let at = 0;
      for (const [from, to, className] of lines[i] ?? []) {
        if (from > at) {
          ctx.fillStyle = colour("");
          run(row, at, from, y);
        }
        ctx.fillStyle = colour(className);
        run(row, from, to, y);
        at = to;
      }
      if (at < row.length) {
        ctx.fillStyle = colour("");
        run(row, at, row.length, y);
      }
    }
    ctx.globalAlpha = 1;
  }
}
