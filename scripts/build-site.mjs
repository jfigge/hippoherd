#!/usr/bin/env node
/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Build the whole site from content/hippos.mjs.
//
//   node scripts/build-site.mjs
//
// WHY THIS EXISTS. The sibling sites each inline everything in one
// index.html, which is right for a one-page site. This one has eight pages
// that share a header, a six-item dropdown, a footer, and a <head> — about 90
// lines of chrome that would otherwise be copy-pasted eight times. The eighth
// copy drifts from the first the week a link changes, and the way you find out
// is a visitor telling you that the menu on one page is missing a hippo.
//
// The output is COMMITTED, so website/ is a complete static site that can be
// served straight from a checkout; CI regenerates it before deploying, which
// is the same argument the sibling deploy workflows make about their docs — a
// few seconds every push beats a silently stale page.
import { mkdir, writeFile } from "node:fs/promises";
import { HERD, BY_SLUG, OWNER } from "../content/hippos.mjs";

const OUT = "website";
const SITE = "https://hippoherd.com";

// ── Escaping ─────────────────────────────────────────────────────────────────
//
// Content in hippos.mjs may carry inline markup on purpose (see the note at the
// top of that file), so `h` is for the places that must NOT — attribute values,
// <title>, meta descriptions — and prose is interpolated raw.
const h = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Meta descriptions and og:description are attribute values, so any markup the
// prose carries has to come out rather than be escaped into visible <strong>.
const plain = (s) =>
  h(
    String(s)
      .replace(/<[^>]+>/g, "")
      .replace(/[“”]/g, '"')
      .replace(/’/g, "'")
      .replace(/\s+/g, " ")
      .trim(),
  );

// ── Icons ────────────────────────────────────────────────────────────────────
// 24x24, stroked with currentColor — the same set and the same weight the
// sibling sites use, so a feature card here looks like a feature card there.
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  chip: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  folder:
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M14 9l3 3"/>',
  terminal:
    '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  network:
    '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v3M10 13l-3 3M14 13l3 3"/>',
  activity:
    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  phone:
    '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>',
  move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
  shuffle:
    '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  offline:
    '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 12.86a10 10 0 0 1 5.17-2.7"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  external:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  alert:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  monitor:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  heart:
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};

const icon = (name, size = 20, extra = "") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${ICONS[name] || ""}</svg>`;

const GITHUB_MARK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>';

const APPLE_MARK =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.85.99-2.24 1.76-3.4 1.66-.14-1.1.4-2.26 1.07-3.02.77-.88 2.14-1.55 3.24-1.66.01.09.02.19.02.29zM20.9 17.13c-.6 1.38-.89 2-1.66 3.22-1.08 1.7-2.6 3.82-4.48 3.83-1.67.02-2.1-1.09-4.37-1.08-2.27.01-2.74 1.1-4.41 1.08-1.88-.02-3.32-1.93-4.4-3.63C-1.4 15.9-1.72 9.28 1.14 5.9 2.16 4.66 3.7 3.87 5.35 3.85c1.79-.03 2.92 1.13 4.4 1.13 1.44 0 2.32-1.14 4.39-1.14 1.5 0 3.1.82 4.24 2.23-3.73 2.04-3.12 7.37.52 8.83-.01.02-.01.04-.01.06z"/></svg>';

// ── Platform icons for the download cards ────────────────────────────────────
const OS_ICONS = {
  mac: '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="M29.5 6C27.2 6 24.9 7.4 23.4 9.2c-1.3 1.6-2.3 3.9-1.9 6.2 2.5.1 5-1.3 6.6-3.2 1.4-1.7 2.3-4 1.4-6.2z" fill="#cdd6f4"/><path d="M32.8 16c-3.3-.2-6.1 1.9-7.7 1.9-1.6 0-4-1.8-6.6-1.7C14.8 16.3 11 18.7 9 22.7c-4.1 7-1.1 17.4 2.9 23.1 1.9 2.8 4.2 5.9 7.2 5.8 2.9-.1 4-1.9 7.4-1.9 3.4 0 4.4 1.9 7.4 1.8 3.1-.1 5.1-2.8 7-5.6 2.2-3.2 3.1-6.3 3.2-6.4-.1 0-6.1-2.3-6.2-9.3-.1-5.8 4.7-8.6 4.9-8.7-2.7-4-6.8-4.4-8-4.5z" fill="#cdd6f4"/></svg>',
  win: '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><rect x="6" y="6" width="15" height="15" rx="2" fill="#d0d0d0"/><rect x="23" y="6" width="15" height="15" rx="2" fill="#d0d0d0"/><rect x="6" y="23" width="15" height="15" rx="2" fill="#d0d0d0"/><rect x="23" y="23" width="15" height="15" rx="2" fill="#d0d0d0"/></svg>',
  linux:
    '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><ellipse cx="22" cy="14" rx="8" ry="9" fill="#cdd6f4"/><ellipse cx="22" cy="30" rx="10" ry="8" fill="#cdd6f4"/><ellipse cx="22" cy="29" rx="7" ry="6" fill="#1e1e2e"/><circle cx="19" cy="13" r="1.5" fill="#1e1e2e"/><circle cx="25" cy="13" r="1.5" fill="#1e1e2e"/><ellipse cx="22" cy="17" rx="3" ry="2" fill="#fab387"/><line x1="12" y1="35" x2="16" y2="38" stroke="#cdd6f4" stroke-width="2.5" stroke-linecap="round"/><line x1="32" y1="35" x2="28" y2="38" stroke="#cdd6f4" stroke-width="2.5" stroke-linecap="round"/></svg>',
};

const OS_META = {
  mac: { name: "macOS", req: "macOS 12 Monterey or later" },
  win: { name: "Windows", req: "Windows 10 / 11" },
  linux: { name: "Linux", req: "64-bit · glibc 2.28+" },
};

// ── Shared chrome ────────────────────────────────────────────────────────────

const repoUrl = (slug) => `https://github.com/${OWNER}/${slug}`;

// A hippo has downloadable builds when it has shipped at least once. The two
// that have not are not given an empty download grid with three "coming soon"
// cards in it — they get a panel that says what is actually true.
const shipped = (hippo) =>
  hippo.status === "released" || hippo.status === "prerelease";

const STATUS_LABEL = {
  released: null, // the version chip already says it
  prerelease: "Pre-release",
  development: "In development",
  planned: "Planned",
};

function navDropdown(current) {
  const items = HERD.map((x) => {
    const here = x.slug === current ? ' aria-current="page"' : "";
    return `        <a class="nav-dropdown-item" href="/${x.slug}/"${here}><img src="/marks/${x.slug}.svg" width="16" height="16" alt=""> ${h(x.name)}</a>`;
  }).join("\n");

  return `    <details class="nav-dropdown">
      <summary class="nav-link nav-dropdown-summary">
        The Hippos
        <svg class="nav-dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS.chevron}</svg>
      </summary>
      <div class="nav-dropdown-menu">
${items}
      </div>
    </details>`;
}

function nav(current) {
  return `<nav class="site">
  <a class="nav-logo" href="/">
    <span class="logo-mark"><img src="/favicon.svg" width="32" height="32" alt=""></span>
    <span class="nav-wordmark">Hippo Herd</span>
  </a>
  <div class="nav-right">
${navDropdown(current)}
    <a class="nav-link" href="https://github.com/${OWNER}" rel="noopener noreferrer">GitHub</a>
    <a class="nav-link" href="https://github.com/sponsors/${OWNER}" rel="noopener noreferrer">Donate</a>
    <a class="btn btn-primary" href="${current ? "#downloads" : "#herd"}">
      ${icon("download", 15)}
      ${current ? "Download" : "Meet the herd"}
    </a>
  </div>
</nav>`;
}

function footer() {
  return `<footer>
  <div class="footer-inner">
    <div class="footer-logo">
      <span class="logo-mark"><img src="/favicon.svg" width="28" height="28" alt=""></span>
      <span class="footer-name">Hippo Herd</span>
    </div>
    <p style="margin-bottom:14px">
      ${HERD.map((x) => `<a href="/${x.slug}/">${h(x.name)}</a>`).join("\n      &nbsp;·&nbsp;\n      ")}
    </p>
    <p style="margin-bottom:14px">
      <a href="https://github.com/${OWNER}" rel="noopener noreferrer">GitHub</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/sponsors/${OWNER}" rel="noopener noreferrer">Donate</a>
      &nbsp;·&nbsp;
      <a href="/privacy.html">Privacy</a>
    </p>
    <p>Copyright &copy; 2026 Jason Figge. Every hippo is free and open source.<br>
    No telemetry, no accounts, no tracking — on the apps or on this site.</p>
    <p style="margin-top:14px">Crafted with <a class="cc-referral" href="https://claude.ai/code" rel="noopener noreferrer">Claude&nbsp;Code</a>.</p>
  </div>
</footer>`;
}

// Every site we will ever put in an iframe, named explicitly. Derived from the
// content rather than hand-listed so it cannot drift from preview.js's own
// allowlist or from the pages that actually carry a preview.
const FRAME_SRC = HERD.filter((x) => x.domain)
  .map((x) => `https://${x.domain}`)
  .join(" ");

function layout({ title, description, canonical, brand, bodyAttrs = "", content, scripts = [] }) {
  const allScripts = ["/herd.js", "/nav.js", ...scripts];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <!-- GitHub Pages cannot set response headers, so the CSP rides in a meta tag.
       No inline or executable scripts on any page — every script below is
       same-origin — while inline STYLES need 'unsafe-inline' because each hippo
       sets its own accent through a style="--brand:…" attribute.
       frame-src names the hippo sites the preview embeds, and nothing else.
       NO frame-ancestors: the spec IGNORES it (along with report-uri and
       sandbox) when the policy arrives in a meta element, so it would protect
       nothing and log a console error on every page load. Clickjacking cover
       needs a real response header, which Pages cannot send — better to not
       claim it than to ship a directive the browser throws away unread. -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src ${FRAME_SRC}; object-src 'none'; base-uri 'self'; form-action 'none'" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="${h(brand)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="description" content="${plain(description)}" />
  <title>${h(title)}</title>
  <link rel="canonical" href="${h(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Hippo Herd" />
  <meta property="og:title" content="${h(title)}" />
  <meta property="og:description" content="${plain(description)}" />
  <meta property="og:url" content="${h(canonical)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${h(title)}" />
  <meta name="twitter:description" content="${plain(description)}" />
  <link rel="stylesheet" href="/site.css" />
</head>
<body${bodyAttrs}${brand ? ` style="--brand:${h(brand)}"` : ""}>

${content}

${footer()}

${allScripts.map((s) => `<script src="${s}" defer></script>`).join("\n")}
</body>
</html>
`;
}

// ── The index ────────────────────────────────────────────────────────────────

function hippoCard(x) {
  const statusChip = STATUS_LABEL[x.status]
    ? `<span class="chip chip-muted">${h(STATUS_LABEL[x.status])}</span>`
    : "";

  // The second button is what herd.js retargets at a real installer once it
  // knows the machine. It ships pointing at the releases page, which is the
  // correct destination when there is nothing better to offer.
  const action = shipped(x)
    ? `<a class="btn btn-ghost" data-card-dl href="${repoUrl(x.slug)}/releases/latest" rel="noopener noreferrer">
        ${icon("download", 14)}
        <span data-card-dl-label>Latest release</span>
      </a>`
    : x.repoPrivate
      ? "" // nothing to link to yet — see the note in content/hippos.mjs
      : `<a class="btn btn-ghost" href="${repoUrl(x.slug)}" rel="noopener noreferrer">
        ${GITHUB_MARK}
        Watch the repo
      </a>`;

  return `      <article class="hippo-card" data-hippo="${x.slug}" style="--brand:${x.color}">
        <div class="hippo-card-head">
          <img class="hippo-card-mark" src="/marks/${x.slug}.svg" width="46" height="46" alt="" />
          <div>
            <h3 class="hippo-card-name"><a href="/${x.slug}/">${h(x.name)}</a></h3>
            <p class="hippo-card-tagline">${h(x.tagline)}</p>
          </div>
        </div>
        <p class="blurb">${x.lead}</p>
        <div class="hippo-card-meta">
          <span class="chip chip-brand" data-version-chip>—</span>
          ${statusChip}
          <span class="chip">${h(x.stack)}</span>
          <span class="chip">${x.platforms.map(h).join(" · ")}</span>
        </div>
        <div class="hippo-card-actions">
          <a class="btn btn-primary" href="/${x.slug}/">Learn more</a>
          ${action}
        </div>
      </article>`;
}

function indexPage() {
  const content = `${nav(null)}

<div class="hero">
  <img class="hero-mark" src="/favicon.svg" width="84" height="84" alt="" />
  <div class="hero-badge">
    ${icon("heart", 11)}
    Six hippos, one herd
  </div>
  <h1>Welcome to the<br><span class="accent">hippo herd</span></h1>
  <p class="hero-desc">
    A small family of free, open-source tools that run on your machine and keep
    to themselves. No accounts, no telemetry, no cloud waiting to be configured
    — just software that works when the wifi doesn't.
  </p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="#herd">
      ${icon("grid", 16)}
      Meet the herd
    </a>
    <a class="btn btn-ghost" href="https://github.com/${OWNER}" rel="noopener noreferrer">
      ${GITHUB_MARK}
      View on GitHub
    </a>
  </div>
  <p class="hero-platforms">macOS · Windows · Linux &nbsp;·&nbsp; iOS &amp; Android soon &nbsp;·&nbsp; Free &amp; open source</p>
</div>

<section class="section section-alt" id="herd">
  <div class="section-inner">
    <p class="section-tag">The herd</p>
    <h2 class="section-title">Every hippo, and what it's for</h2>
    <p class="section-body">
      Each one solves a problem its author had, properly rather than broadly.
      They share a look, a licence, and a refusal to talk to anything you
      didn't ask them to.
    </p>

    <div class="detected" data-detected>
      ${icon("monitor", 16)}
      <span>Detected <strong data-detected-label></strong> — download buttons below are picked to match.</span>
      <span data-detected-note></span>
    </div>

    <div class="herd-grid">
${HERD.map(hippoCard).join("\n\n")}
    </div>
  </div>
</section>

<section class="section">
  <div class="section-inner">
    <p class="section-tag">In common</p>
    <h2 class="section-title">What every hippo agrees on</h2>
    <p class="section-body">Different problems, same principles — and they are not marketing lines, they are constraints the code is written under.</p>

    <div class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon">${icon("offline")}</div>
        <h3>Offline first, and offline last</h3>
        <p>Every hippo does its whole job with the network unplugged. Anything that does reach out — an SSH tunnel, an HTTP request — reaches where you pointed it and nowhere else.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${icon("eye")}</div>
        <h3>No accounts, no telemetry</h3>
        <p>Nothing to sign into, nothing phoning home, no analytics, no crash beacon, no update ping. There is no server to hold your data because there is no server.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${icon("folder")}</div>
        <h3>Your data stays yours</h3>
        <p>Files in directories you can see, back up, and read without the app that made them. Nothing is locked in a proprietary store you have to export from.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${icon("code")}</div>
        <h3>Open source, free forever</h3>
        <p>Apache 2.0 across the herd, MPL 2.0 for Keep Hippo. Every line is on GitHub — read it, fork it, build it yourself if you'd rather not trust a binary.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${icon("monitor")}</div>
        <h3>Native on all three desktops</h3>
        <p>macOS, Windows and Linux, on Intel and on ARM, built from the same source with the same features. No platform is the afterthought.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">${icon("book")}</div>
        <h3>Documented properly</h3>
        <p>Each hippo ships a real user guide written alongside it, hosted and in-repo from one source, so the two cannot disagree.</p>
      </div>
    </div>
  </div>
</section>`;

  return layout({
    title: "Hippo Herd — free, offline, open-source tools",
    description:
      "The hippo herd: Rest Hippo, Chip Hippo, Jump Hippo, Keep Hippo, Mind Hippo and Roll Hippo. Free, open-source tools that run on your machine, with no accounts and no telemetry.",
    canonical: SITE + "/",
    brand: "#2BC4B0",
    content,
  });
}

// ── A hippo page ─────────────────────────────────────────────────────────────

function preview(x) {
  if (!x.domain) return "";
  return `<section class="section">
  <div class="section-inner">
    <p class="section-tag">Its own site</p>
    <h2 class="section-title">${h(x.name)} has a home of its own</h2>
    <!-- Deliberately says nothing about "the preview below": the preview is
         dropped on a phone (see site.css), and a paragraph pointing at
         something that isn't there is the bug that wording creates. The claim
         about it being live belongs in the caption, which is dropped with it. -->
    <p class="section-body">
      <strong>${h(x.domain)}</strong> carries the full guide, the complete
      download list, and every release note.
    </p>
    <a class="btn btn-primary preview-fallback" href="https://${h(x.domain)}/" rel="noopener noreferrer">
      ${icon("external", 16)}
      Open ${h(x.domain)}
    </a>
  </div>

  <div style="padding:40px 2rem 0">
    <div class="preview" data-preview-src="https://${h(x.domain)}/" data-preview-title="${h(x.name)} website">
      <div class="preview-chrome">
        <span class="preview-dot"></span>
        <span class="preview-dot"></span>
        <span class="preview-dot"></span>
        <span class="preview-url">${h(x.domain)}</span>
      </div>
      <div class="preview-viewport">
        <div class="preview-placeholder">
          ${icon("external", 22)}
          <span>Loading ${h(x.domain)}…</span>
          <noscript><a href="https://${h(x.domain)}/" rel="noopener noreferrer">Open ${h(x.domain)}</a></noscript>
        </div>
        <a class="preview-cover" href="https://${h(x.domain)}/" rel="noopener noreferrer">
          <span>${icon("external", 16)} Open ${h(x.domain)}</span>
        </a>
      </div>
    </div>
    <p class="preview-caption">That is ${h(x.domain)} itself, live — not a screenshot. Click anywhere on it to open the real thing.</p>
  </div>
</section>`;
}

function downloads(x) {
  const stores = (x.stores || [])
    .filter((s) => s.url)
    .map(
      (s) => `      <a class="store-badge" href="${h(s.url)}" rel="noopener noreferrer">
        ${APPLE_MARK}
        <span>
          <span class="store-badge-sub">${h(s.sub)}</span>
          <span class="store-badge-name">${h(s.name)}</span>
        </span>
      </a>`,
    )
    .join("\n");

  const storeRow = stores ? `\n    <div class="store-row">\n${stores}\n    </div>\n` : "";

  // A store listing that exists but has no URL recorded yet still deserves a
  // sentence — a visitor on a Mac should not have to guess whether searching
  // the App Store is worth their time. See the TODO in content/hippos.mjs.
  const storeNote =
    (x.stores || []).length && !stores
      ? `\n    <p class="dl-note">${h(x.name)} is also published on the <strong>Mac App Store</strong> — search for it there if you'd rather have automatic updates and sandboxed installation.</p>\n`
      : "";

  const osCards = ["mac", "win", "linux"]
    .map(
      (os) => `      <div class="os-card">
        <div class="os-header">
          <div class="os-icon">${OS_ICONS[os]}</div>
          <div>
            <div class="os-name">${OS_META[os].name}</div>
            <div class="os-req">${OS_META[os].req}</div>
          </div>
        </div>
        <div class="dl-list" data-dl-list="${os}">
          <a class="dl-row" href="${repoUrl(x.slug)}/releases/latest" rel="noopener noreferrer">
            <span class="dl-icon">${icon("download", 16)}</span>
            <div class="dl-info">
              <div class="dl-label">Download for ${OS_META[os].name}</div>
              <div class="dl-meta">Latest release on GitHub</div>
            </div>
          </a>
        </div>
      </div>`,
    )
    .join("\n\n");

  return `<section class="section section-deep" id="downloads">
  <div class="section-inner">
    <p class="section-tag">Downloads</p>
    <h2 class="section-title">Get ${h(x.name)}</h2>
    <p class="section-body">Version <span data-version>—</span> · free to download and use. No account required.</p>

    <div class="detected" data-detected>
      ${icon("monitor", 16)}
      <span>We think you're on <strong data-detected-label></strong>.</span>
      <a class="btn btn-primary" data-detected-dl href="${repoUrl(x.slug)}/releases/latest" rel="noopener noreferrer">
        ${icon("download", 15)}
        <span data-detected-dl-label>Download</span>
      </a>
      <span data-detected-note></span>
    </div>
${storeRow}${storeNote}
    <div class="os-grid">
${osCards}
    </div>

    <p class="dl-note">
      Every build is published on
      <a href="${repoUrl(x.slug)}/releases" rel="noopener noreferrer" data-release-link>GitHub Releases</a>,
      where you will also find the release notes and every previous version. Prefer to
      build it yourself? The <a href="${repoUrl(x.slug)}" rel="noopener noreferrer">source</a>
      is right there.
    </p>
  </div>
</section>`;
}

function notYet(x) {
  const mobile = x.platforms.includes("iOS");
  const body = x.repoPrivate
    ? `${h(x.name)} is still being built, and its repository is private for now. There is nothing to install and nothing to watch yet — this page will carry the downloads, and the link to the source, as soon as either exists.`
    : mobile
      ? `${h(x.name)} is heading for the App Store and Google Play. There is nothing to install today — the repository is the place to watch, and this page will carry the store links the moment they exist.`
      : `${h(x.name)} is being built in the open and has no tagged release yet. The repository is the place to watch; this page will carry the downloads the moment there are any.`;

  // A private repository gets a sentence, not a link. Sending a visitor to a
  // GitHub 404 to prove a project exists is worse than telling them it is not
  // open yet.
  const row = x.repoPrivate
    ? ""
    : `
    <div class="link-row">
      <a class="link-card" href="${repoUrl(x.slug)}" rel="noopener noreferrer">
        ${GITHUB_MARK}
        <span>${OWNER}/${x.slug}<small>Source, plans and progress</small></span>
      </a>
      <a class="link-card" href="${repoUrl(x.slug)}/releases" rel="noopener noreferrer" data-release-link>
        ${icon("download", 16)}
        <span>Releases<small><span data-version-tag>No release yet</span></small></span>
      </a>
    </div>`;

  return `<section class="section section-deep" id="downloads">
  <div class="section-inner">
    <p class="section-tag">Downloads</p>
    <h2 class="section-title">Not out yet</h2>
    <p class="section-body">${body}</p>
${row}
  </div>
</section>`;
}

function callout(x) {
  if (!x.callout) return "";
  return `    <div class="callout">
      ${icon("alert", 18)}
      <p><strong>${h(x.callout.title)}.</strong> ${x.callout.body}</p>
    </div>`;
}

function links(x) {
  const rows = [];
  if (x.domain) {
    rows.push(`      <a class="link-card" href="https://${h(x.domain)}/" rel="noopener noreferrer">
        ${icon("external", 16)}
        <span>${h(x.domain)}<small>The project's own website</small></span>
      </a>`);
  }
  if (!x.repoPrivate) {
    rows.push(`      <a class="link-card" href="${repoUrl(x.slug)}" rel="noopener noreferrer">
        ${GITHUB_MARK}
        <span>${OWNER}/${x.slug}<small>Source, issues and releases</small></span>
      </a>`);
  }
  if (x.docs) {
    rows.push(`      <a class="link-card" href="${h(x.docs)}" rel="noopener noreferrer">
        ${icon("book", 16)}
        <span>User guide<small>Every feature, documented</small></span>
      </a>`);
  }
  if (!x.repoPrivate) {
    rows.push(`      <a class="link-card" href="${repoUrl(x.slug)}#readme" rel="noopener noreferrer">
        ${icon("code", 16)}
        <span>README<small>The short version, on GitHub</small></span>
      </a>`);
  }
  rows.push(`      <a class="link-card" href="/#herd">
        ${icon("grid", 16)}
        <span>The rest of the herd<small>Five more hippos</small></span>
      </a>`);
  return `    <div class="link-row">\n${rows.join("\n")}\n    </div>`;
}

function herdNav(x) {
  const i = HERD.findIndex((y) => y.slug === x.slug);
  const prev = HERD[(i - 1 + HERD.length) % HERD.length];
  const next = HERD[(i + 1) % HERD.length];
  return `<div class="herd-nav">
  <a href="/${prev.slug}/">
    ${icon("arrowLeft", 16)}
    <img src="/marks/${prev.slug}.svg" width="32" height="32" alt="" />
    <span><small>Previous</small>${h(prev.name)}</span>
  </a>
  <a href="/${next.slug}/">
    <span style="text-align:right"><small>Next</small>${h(next.name)}</span>
    <img src="/marks/${next.slug}.svg" width="32" height="32" alt="" />
    ${icon("arrowRight", 16)}
  </a>
</div>`;
}

// A filled dot for a hippo that has shipped, a hollow one for a hippo that has
// not — the same badge the sibling sites use above their own headline.
const DOT = (filled) =>
  `<svg width="10" height="10" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>`;

function hippoPage(x) {
  const statusBadge = STATUS_LABEL[x.status]
    ? `${DOT(x.status === "prerelease")} ${h(STATUS_LABEL[x.status])} · <span data-version-tag>—</span>`
    : `${DOT(true)} <span data-version-tag>—</span> — available now`;

  const content = `${nav(x.slug)}

<div class="hero">
  <img class="hero-mark" src="/marks/${x.slug}.svg" width="84" height="84" alt="" />
  <div class="hero-badge">
    ${statusBadge}
  </div>
  <h1>${h(x.name)}</h1>
  <p class="hero-desc">${x.blurb}</p>
  <div class="hero-actions">
    ${
      shipped(x)
        ? `<a class="btn btn-primary" href="#downloads">${icon("download", 16)} Download</a>`
        : x.repoPrivate
          ? `<a class="btn btn-primary" href="#downloads">${icon("clock", 16)} Release status</a>`
          : `<a class="btn btn-primary" href="${repoUrl(x.slug)}" rel="noopener noreferrer">${GITHUB_MARK} View the source</a>`
    }
    ${
      x.domain
        ? `<a class="btn btn-ghost" href="https://${h(x.domain)}/" rel="noopener noreferrer">${icon("external", 16)} ${h(x.domain)}</a>`
        : `<a class="btn btn-ghost" href="/#herd">${icon("grid", 16)} Back to the herd</a>`
    }
  </div>
  <p class="hero-platforms">${x.platforms.map(h).join(" · ")} &nbsp;·&nbsp; ${h(x.stack)} &nbsp;·&nbsp; ${h(x.license)}</p>
</div>

<section class="section section-alt">
  <div class="section-inner">
    <p class="section-tag">What it does</p>
    <h2 class="section-title">${h(x.tagline)}</h2>
    <p class="section-body">${x.lead}</p>
${callout(x)}
    <div class="feature-grid">
${x.features
  .map(
    (f) => `      <div class="feature-card">
        <div class="feature-icon">${icon(f.icon)}</div>
        <h3>${f.title}</h3>
        <p>${f.body}</p>
      </div>`,
  )
  .join("\n\n")}
    </div>
  </div>
</section>

${shipped(x) ? downloads(x) : notYet(x)}

${preview(x)}

<section class="section${x.domain ? " section-alt" : ""}">
  <div class="section-inner">
    <p class="section-tag">Where to go next</p>
    <h2 class="section-title">${h(x.name)}, everywhere else</h2>
    <p class="section-body">The herd page is the introduction. These are the places the project actually lives.</p>
${links(x)}
  </div>
</section>

${herdNav(x)}`;

  return layout({
    title: `${x.name} — ${x.tagline} · Hippo Herd`,
    description: x.lead,
    canonical: `${SITE}/${x.slug}/`,
    brand: x.color,
    bodyAttrs: ` data-hippo-page="${x.slug}"`,
    content,
    scripts: x.domain ? ["/preview.js"] : [],
  });
}

// ── Supporting pages ─────────────────────────────────────────────────────────

function privacyPage() {
  const content = `${nav(null)}

<div class="prose">
  <h1>Privacy</h1>
  <p class="lede">hippoherd.com · last updated 5 August 2026</p>

  <p>
    This site collects nothing. There is no analytics script, no tag manager, no
    pixel, no cookie, no local storage, and no form to submit. The site is static
    HTML served by GitHub Pages, and nothing on it identifies you.
  </p>

  <h2>What the pages load</h2>
  <p>
    Every stylesheet, script, and image on this site is served from
    hippoherd.com itself. There is no CDN, no web font service, and no third-party
    request made on your behalf — the site's Content-Security-Policy is written
    to forbid them, so a change that introduced one would break rather than run.
  </p>
  <p>
    Each hippo's page shows a live preview of that project's own website in a
    frame — resthippo.com, chiphippo.com, jumphippo.com or keephippo.com. Those
    are also static sites of ours, hosted the same way and collecting the same
    nothing, but loading one does mean your browser makes a request to that
    domain. If you would rather it didn't, the previews only load when you scroll
    to them, and blocking frames stops them entirely without breaking the page.
  </p>

  <h2>What GitHub sees</h2>
  <p>
    GitHub Pages serves this site and GitHub Releases serves the downloads.
    GitHub logs requests to its own infrastructure, including your IP address, as
    described in
    <a href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement" rel="noopener noreferrer">GitHub's privacy statement</a>.
    That is between you and GitHub; we receive none of it and have no analytics
    dashboard of any kind.
  </p>

  <h2>What the apps do</h2>
  <p>
    Every hippo is offline software. None of them has an account, a licence
    check, an update beacon, or a telemetry channel, and none of them sends your
    data anywhere. Each project states its own position in its repository, and
    the ones with their own sites carry their own privacy pages.
  </p>

  <h2>Getting in touch</h2>
  <p>
    Questions belong in the relevant project's
    <a href="https://github.com/${OWNER}" rel="noopener noreferrer">GitHub issues</a>,
    where the answer is useful to everyone rather than to one inbox.
  </p>
</div>`;

  return layout({
    title: "Privacy — Hippo Herd",
    description:
      "hippoherd.com collects nothing: no analytics, no cookies, no third-party requests, and no telemetry in any of the apps.",
    canonical: SITE + "/privacy.html",
    brand: "#2BC4B0",
    content,
  });
}

function notFoundPage() {
  const content = `${nav(null)}

<div class="hero">
  <img class="hero-mark" src="/favicon.svg" width="84" height="84" alt="" />
  <div class="hero-badge">${icon("search", 11)} 404</div>
  <h1>That hippo<br><span class="accent">wandered off</span></h1>
  <p class="hero-desc">
    There is nothing at this address. The herd is all here, though — pick one.
  </p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="/">${icon("grid", 16)} Back to the herd</a>
  </div>
</div>

<section class="section section-alt">
  <div class="section-inner">
    <div class="link-row" style="margin-top:0">
${HERD.map(
  (x) => `      <a class="link-card" href="/${x.slug}/" style="--brand:${x.color}">
        <img src="/marks/${x.slug}.svg" width="20" height="20" alt="" />
        <span>${h(x.name)}<small>${h(x.tagline)}</small></span>
      </a>`,
).join("\n")}
    </div>
  </div>
</section>`;

  return layout({
    title: "Not found — Hippo Herd",
    description: "There is nothing at this address on hippoherd.com.",
    canonical: SITE + "/404.html",
    brand: "#2BC4B0",
    content,
  });
}

function sitemap() {
  const urls = [
    SITE + "/",
    ...HERD.map((x) => `${SITE}/${x.slug}/`),
    SITE + "/privacy.html",
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
}

// ── Write ────────────────────────────────────────────────────────────────────

const written = [];
async function emit(path, body) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir) await mkdir(dir, { recursive: true });
  await writeFile(path, body);
  written.push(path);
}

await emit(`${OUT}/index.html`, indexPage());
for (const x of HERD) await emit(`${OUT}/${x.slug}/index.html`, hippoPage(x));
await emit(`${OUT}/privacy.html`, privacyPage());
await emit(`${OUT}/404.html`, notFoundPage());
await emit(`${OUT}/sitemap.xml`, sitemap());
await emit(`${OUT}/CNAME`, "hippoherd.com\n");
await emit(
  `${OUT}/robots.txt`,
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
);

console.log(written.map((p) => "  " + p).join("\n"));
console.log(`${written.length} files written.`);
