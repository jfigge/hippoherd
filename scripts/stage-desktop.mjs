#!/usr/bin/env node
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

// Put the viewers into a staged desktop build.
//
//   node scripts/stage-desktop.mjs build/electron
//
// `make desktop-setup` copies electron/ to the stage first; this adds what the
// app hosts. For every viewer in electron/router.js whose bundle is here —
// website/<id>/index.html, written by that viewer's own `make site` — it:
//
//   * copies website/<id>/ to <stage>/web/<id>/, minus about/ (hippoherd's
//     page ABOUT the viewer, which is part of the site, not of the viewer);
//   * records which commit of this repo that copy came from, in
//     <stage>/web/viewers.json, for the About panel;
//   * writes the file associations for exactly those viewers into the staged
//     package.json, so the OS never offers the app for a file it cannot open.
//
// What is committed is what ships: the release build packages this checkout's
// website/<id>/, so a viewer reaches the app by `make site` there and a commit
// here — the same step that publishes it to hippoherd.com.

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { VIEWERS, fileAssociations } = require(path.join(repoRoot, "electron", "router.js"));

const stage = process.argv[2] && path.resolve(process.argv[2]);
if (!stage || !existsSync(path.join(stage, "package.json"))) {
  console.error("usage: node scripts/stage-desktop.mjs <stage dir holding the shell's package.json>");
  process.exit(2);
}

const SITE_PAGE = "about";

// The last commit that touched website/<id>/, or null outside a git checkout.
function provenance(id) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%h %cs", "--", `website/${id}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return null;
    const [commit, date] = out.split(" ");
    return { commit, date };
  } catch {
    return null;
  }
}

const web = path.join(stage, "web");
rmSync(web, { recursive: true, force: true });
mkdirSync(web, { recursive: true });

const manifest = {};
for (const viewer of VIEWERS) {
  const from = path.join(repoRoot, "website", viewer.id);
  if (!existsSync(path.join(from, "index.html"))) {
    console.log(`  - ${viewer.name}: no website/${viewer.id}/index.html — not in this build`);
    continue;
  }
  const to = path.join(web, viewer.id);
  cpSync(from, to, {
    recursive: true,
    // Only the top level's about/ is the site's; a viewer's own docs/about/
    // (should it ever have one) is the viewer's.
    filter: (src) =>
      path.relative(from, src).split(path.sep)[0] !== SITE_PAGE && path.basename(src) !== ".DS_Store",
  });
  manifest[viewer.id] = provenance(viewer.id) || {};
  const p = manifest[viewer.id];
  console.log(`  + ${viewer.name}: website/${viewer.id}/ → web/${viewer.id}/${p.commit ? `  (${p.commit}, ${p.date})` : ""}`);
}

const ids = Object.keys(manifest);
if (!ids.length) {
  console.error("No viewer bundles under website/ — nothing for the app to host.");
  process.exit(1);
}
writeFileSync(path.join(web, "viewers.json"), JSON.stringify(manifest, null, 2) + "\n");

const pkgFile = path.join(stage, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
pkg.build.fileAssociations = fileAssociations(ids);
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
console.log(`  file associations: ${pkg.build.fileAssociations.flatMap((a) => a.ext).map((e) => `.${e}`).join(" ")}`);
