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
 * enhance.js — the plugins' finishing touches on the rendered preview:
 * math to MathML, diagrams to SVG (`api.enhancer`).
 *
 * Each enhancer gets the preview's elements matching its selector, after
 * the HTML is in the page (and sanitized: what enhancers add is theirs, not
 * the document's). An enhancer may be async — it loads its library the
 * first time — but works synchronously from its cache otherwise, so a
 * re-render while typing does not flicker. A failing enhancer leaves its
 * elements as rendered.
 */

export function enhance(root, registry, context) {
  for (const enhancer of registry.enhancers) {
    const elements = [...root.querySelectorAll(enhancer.selector)];
    if (!elements.length) continue;
    try {
      Promise.resolve(enhancer.run(elements, context)).catch((err) => report(enhancer, err));
    } catch (err) {
      report(enhancer, err);
    }
  }
}

function report(enhancer, err) {
  console.warn(`MarkHippo: the ${enhancer.plugin} plugin could not finish the preview:`, err);
}
