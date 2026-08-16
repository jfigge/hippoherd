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

// Build website/versions.json from the GitHub Releases API — for the WHOLE HERD.
//
// The sibling sites each generate a versions.json for their own repo. This one
// is the aggregate: one file holding the latest release of every hippo, so the
// herd site can offer a direct download for the visitor's machine without seven
// round trips to api.github.com from the browser (which would also burn the
// visitor's unauthenticated rate limit, 60/hr shared across every site they
// visit).
//
// Run in CI with GITHUB_TOKEN set, or locally:
//   GITHUB_TOKEN=$(gh auth token) node scripts/build-versions.mjs
//
// Usage: node scripts/build-versions.mjs [--out path]
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const out = arg("--out", "website/versions.json");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

// The herd, in the order the site presents it. Slugs match website/hippos/<slug>/
// and the data-hippo attributes in the markup; nothing here is discovered, so a
// new hippo is one line in this list and one line in HIPPOS in website/herd.js.
const HERD = [
  "resthippo",
  "chiphippo",
  "jumphippo",
  "keephippo",
  "mazehippo",
  "mindhippo",
  "rollhippo",
];

const OWNER = "jfigge";

// ── Asset classification ─────────────────────────────────────────────────────
//
// This has to read TWO naming conventions, which the per-project scripts do not:
//
//   electron-builder  Chip-Hippo-1.0.0-arm64.dmg      (Rest, Chip, Jump)
//   GoReleaser        keephippo_0.4.0_darwin_arm64.tar.gz  (Keep, and Mind later)
//
// so platform is read from an OS TOKEN first and only falls back to the file
// extension. Getting that order wrong is not hypothetical: electron-builder's
// mac ZIP carries no "mac" token at all (Chip-Hippo-1.0.0-arm64.zip IS the macOS
// archive), while GoReleaser's Windows archive is keephippo_..._windows_amd64.zip
// — the same extension meaning two different platforms, separable only by the
// token. Extension-first would have filed every Keep Hippo Windows build under
// macOS.

// Architecture, read off the artifact filename. Every generator spells it
// differently — x64 for a dmg, x86_64 for an AppImage, amd64 for a deb and for
// everything GoReleaser emits — so what this needs is a vocabulary, not a guess.
//
// Anything not named here answers null rather than being ASSERTED to be Intel:
// a download badged for the wrong machine is worse than one badged for none.
// herd.js gives an unnamed arch its own heading instead of dropping the asset.
//
// ORDER MATTERS IN EXACTLY ONE PLACE: x86_64 must be read as x64 before the ia32
// row gets to see its `x86` prefix. Everything else is mutually exclusive.
const ARCH_SPELLINGS = [
  [/arm64|aarch64/, "arm64"],
  [/x86[_-]?64|x64|amd64/, "x64"],
  [/universal/, "universal"],
  [/armv7l|armhf|arm/, "armv7l"],
  [/ia32|i[3-6]86|x86|386/, "ia32"],
];

// A name whose arch slot expanded to NOTHING, i.e. one ending at the version:
// "Rest-Hippo-Setup-1.1.5.exe" against "Rest-Hippo-Setup-1.1.5-x64.exe".
// electron-builder collapses the slot for the one artifact that is not
// arch-specific — the COMBINED multi-arch installer it emits alongside the
// per-arch ones, roughly double the size because it holds both.
//
// The trailing group must be a VERSION — at least one dot — and not merely
// digits, or a hypothetical "…-arm-64" would read as combined rather than as an
// architecture nobody has taught this table yet.
const NO_ARCH_SLOT = /[-._]\d+(?:\.\d+)+$/;

// Whole tokens only, so a product name or a version can never be read as an
// architecture. `name` is expected lowercased, extension included.
function tokenTest(source, name) {
  return new RegExp(`(?:^|[^a-z0-9])(?:${source})(?![a-z0-9])`).test(name);
}

function archOf(name) {
  for (const [re, arch] of ARCH_SPELLINGS) {
    if (tokenTest(re.source, name)) return arch;
  }
  return NO_ARCH_SLOT.test(stripExt(name)) ? "universal" : null;
}

// ".tar.gz" is two extensions and has to lose both, or NO_ARCH_SLOT never sees
// the version it is looking for.
function stripExt(name) {
  return name.replace(/\.tar\.(gz|xz|bz2)$/, "").replace(/\.[a-z0-9]+$/, "");
}

const OS_TOKENS = [
  [/darwin|macos|osx|mac/, "mac"],
  [/windows|win32|win64|win/, "win"],
  [/linux/, "linux"],
];

function osTokenOf(name) {
  for (const [re, os] of OS_TOKENS) {
    if (tokenTest(re.source, name)) return os;
  }
  return null;
}

// Non-installer assets that ride along in a release and must never become a
// download row: updater metadata, delta maps, and signature/checksum files.
const NOT_A_DOWNLOAD =
  /\.(blockmap|yml|yaml|sig|asc|pem|sha256|sha512|txt|json)$/;

// Extension → what it is, and which platform it implies when no OS token said.
// `zip` and `tar.gz` deliberately have NO implied platform of their own here;
// they are resolved below, where the electron-builder convention applies.
const KINDS = [
  [/\.dmg$/, { kind: "dmg", label: "Disk Image", implies: "mac" }],
  [/\.pkg$/, { kind: "pkg", label: "Installer Package", implies: "mac" }],
  [/\.msi$/, { kind: "msi", label: "MSI Installer", implies: "win" }],
  [/\.exe$/, { kind: "exe", label: "Installer", implies: "win" }],
  [/\.appimage$/, { kind: "appimage", label: "AppImage", implies: "linux" }],
  [/\.deb$/, { kind: "deb", label: "Debian Package", implies: "linux" }],
  [/\.rpm$/, { kind: "rpm", label: "RPM Package", implies: "linux" }],
  [/\.snap$/, { kind: "snap", label: "Snap Package", implies: "linux" }],
  [/\.tar\.(gz|xz|bz2)$|\.tgz$/, { kind: "tarball", label: "Tarball", implies: null }],
  [/\.zip$/, { kind: "zip", label: "ZIP Archive", implies: null }],
];

// Classify a release asset by filename. Returns null for anything that is not a
// download a visitor could run, so it is dropped from the manifest entirely.
export function classify(name) {
  const n = name.toLowerCase();
  if (NOT_A_DOWNLOAD.test(n)) return null;

  const hit = KINDS.find(([re]) => re.test(n));
  if (!hit) return null;
  let { kind, label, implies } = hit[1];

  // The OS token wins over the extension's implication wherever they disagree —
  // see the note above. A bare .zip with no token is electron-builder's macOS
  // archive; a bare .tar.gz with no token could be anything, so it is dropped
  // rather than guessed at.
  const token = osTokenOf(n);
  let platform = token || implies;
  if (!platform && kind === "zip") platform = "mac";
  if (!platform) return null;

  // Windows: electron-builder ships BOTH an NSIS installer (…-Setup-…) and a
  // portable .exe under the same version, and they are not interchangeable —
  // one installs, the other runs from wherever it lands. Only the name tells
  // them apart, and only when both exist; a lone .exe is the installer.
  if (kind === "exe" && !n.includes("setup")) {
    kind = "portable";
    label = "Portable";
  }
  // Mac's .zip and Windows' .zip are both archives but mean different things to
  // the reader; the label is what appears in the row, so make it say which.
  if (kind === "zip" && platform === "win") label = "ZIP Archive";

  return { platform, arch: archOf(n), kind, label };
}

// Order within an OS/arch group: recommended installer first, archives last.
// herd.js sorts the same way; this only decides which asset is "primary" for the
// one-click button, which must be a real installer and never a loose archive.
const KIND_RANK = {
  dmg: 0,
  pkg: 0,
  exe: 0,
  msi: 0,
  appimage: 0,
  deb: 1,
  rpm: 1,
  snap: 1,
  tarball: 2,
  portable: 3,
  zip: 4,
};

export function rank(kind) {
  return KIND_RANK[kind] != null ? KIND_RANK[kind] : 9;
}

async function gh(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "hippoherd-build-versions",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null; // repo not created yet — not an error here
  if (!res.ok) {
    throw new Error(`GitHub API ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// One hippo's latest release, or a null-shaped entry if it has none.
//
// A hippo with no release yet is EXPECTED, not exceptional — Mind Hippo has no
// tags and Roll Hippo has no code — so it must not fail the build or vanish from
// the manifest. It gets an entry with latest:null, which the site renders as
// "no release yet" beside a link to the repo.
async function fetchHippo(slug) {
  const repo = `${OWNER}/${slug}`;
  const empty = {
    repo,
    latest: null,
    tag: null,
    url: `https://github.com/${repo}/releases`,
    publishedAt: null,
    prerelease: false,
    assets: [],
  };

  const raw = await gh(`/repos/${repo}/releases?per_page=20`);
  if (!raw || !Array.isArray(raw)) return empty;

  const published = raw.filter((r) => !r.draft);
  // Prefer the newest STABLE release; fall back to a pre-release only when that
  // is all there is, so a visitor is never handed a pre-release while a stable
  // build sits one row down.
  const r = published.find((x) => !x.prerelease) || published[0];
  if (!r) return empty;

  const assets = (r.assets || [])
    .map((a) => {
      const c = classify(a.name);
      return c
        ? { name: a.name, size: a.size, url: a.browser_download_url, ...c }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => rank(a.kind) - rank(b.kind));

  return {
    repo,
    latest: String(r.tag_name || "").replace(/^v/, ""),
    tag: r.tag_name,
    url: r.html_url,
    publishedAt: r.published_at,
    prerelease: !!r.prerelease,
    assets,
  };
}

// ── Build ────────────────────────────────────────────────────────────────────
// Only fetch and write when invoked directly. Importing the module — which the
// classify() test does — must never reach the network or touch a file.
const IS_MAIN =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (IS_MAIN) {
  const entries = await Promise.all(
    HERD.map(async (slug) => [slug, await fetchHippo(slug)]),
  );

  const data = {
    generatedAt: new Date().toISOString(),
    hippos: Object.fromEntries(entries),
  };

  await writeFile(out, JSON.stringify(data, null, 2) + "\n");

  for (const [slug, h] of entries) {
    console.log(
      `  ${slug.padEnd(11)} ${(h.latest ? "v" + h.latest : "(no release)").padEnd(14)} ${h.assets.length} asset(s)`,
    );
  }
  console.log(`Wrote ${out}`);
}
