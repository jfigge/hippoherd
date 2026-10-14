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
 * page.js — the rendered document as a web page of its own: one HTML file,
 * its styles inside it, its images (when embedded) too.
 *
 * The page carries a Content-Security-Policy that lets nothing run. A
 * document's raw HTML is in it, and the file will be opened from disk,
 * where no app is there to stop a script: the policy is what does.
 */

import { escapeHtml } from "../render/html.js";

export const PAGE_CSP =
  "default-src 'none'; img-src 'self' data: https: http:; media-src 'self' data: https: http:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

// `body`: the document's HTML; `css`: every style it needs.
export function htmlPage({ title, body, css = "" }) {
  // Nothing in the styles may close the <style> element early.
  const style = css.replace(/<\/(style)/gi, "<\\/$1");
  return `<!DOCTYPE html>
<html data-theme="light">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MarkHippo">
<title>${escapeHtml(title || "Untitled")}</title>
<style>
${style}
</style>
</head>
<body>
<article class="mh-preview">
${body}
</article>
</body>
</html>
`;
}

// The page's own rules, after the preview's stylesheets: the document on
// its own, without the app around it. `vars`: { "--bg": "#fff", … }.
export function pageCss(vars) {
  const declarations = Object.entries(vars)
    .filter(([name, value]) => /^--[a-z0-9-]+$/.test(name) && value && !/[;{}<]/.test(value))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {
${declarations}
  color-scheme: light;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15.5px/1.65 var(--sans);
}

.mh-preview {
  padding: 40px 32px 64px;
}

@media print {
  .mh-preview {
    max-width: none;
    padding: 0;
  }
}
`;
}
