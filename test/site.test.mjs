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

// The site's side of ViewHippo: JsonHippo's and YamlHippo's pages offer
// ViewHippo's installers, read from this repository's releases.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, RELEASES_FROM } from "../scripts/build-versions.mjs";
import { HERD } from "../content/hippos.mjs";

describe("ViewHippo downloads on the site", () => {
  test("build-versions reads the same repositories as content/hippos.mjs's desktopApp", () => {
    const fromContent = Object.fromEntries(HERD.filter((x) => x.desktopApp).map((x) => [x.slug, x.desktopApp.repo]));
    assert.deepEqual(RELEASES_FROM, fromContent);
  });

  test("every installer release.yml publishes is offered, for the right machine", () => {
    const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    const names = [...workflow.matchAll(/"(ViewHippo-[^"]+)"/g)].map((m) => m[1].replace("${V}", "0.1.0"));
    assert.equal(names.length, 6);
    const offered = Object.fromEntries(names.map((n) => [n, classify(n)]));
    assert.deepEqual(offered, {
      "ViewHippo-0.1.0-arm64.dmg": { platform: "mac", arch: "arm64", kind: "dmg", label: "Disk Image" },
      "ViewHippo-0.1.0-x64.dmg": { platform: "mac", arch: "x64", kind: "dmg", label: "Disk Image" },
      "ViewHippo-Setup-0.1.0-x64.exe": { platform: "win", arch: "x64", kind: "exe", label: "Installer" },
      "ViewHippo-Setup-0.1.0-arm64.exe": { platform: "win", arch: "arm64", kind: "exe", label: "Installer" },
      "ViewHippo-0.1.0-x86_64.AppImage": { platform: "linux", arch: "x64", kind: "appimage", label: "AppImage" },
      "ViewHippo-0.1.0-arm64.AppImage": { platform: "linux", arch: "arm64", kind: "appimage", label: "AppImage" },
    });
  });

  test("the generated pages link to ViewHippo's releases", () => {
    for (const x of HERD.filter((y) => y.desktopApp)) {
      const page = readFileSync(new URL(`../website${x.page}index.html`, import.meta.url), "utf8");
      assert.match(page, /id="downloads"/, `${x.slug}: no downloads section`);
      assert.match(page, /comes inside <strong>ViewHippo<\/strong>/, `${x.slug}: ViewHippo not named`);
      assert.ok(!page.includes(`github.com/jfigge/${x.slug}/releases`), `${x.slug}: still links to its own releases`);
    }
  });
});
