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

// The desktop shell's promises that can be checked without Electron: which
// viewer opens which file (electron/router.js), what a viewer may load and
// where it may go (electron/policy.js), and that the packaging config builds
// exactly the installers the Release workflow publishes.
//
//   make test        (node --test test/*.test.mjs)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import router from "../electron/router.js";
import policy from "../electron/policy.js";
import debug from "../electron/debug.js";

const { viewerForFile, conversionTargets, convertibleViewers, conversionRoute, openFilters, renameFor, fileAssociations } = router;
const { viewerUrl, classifyNavigation, resolveAppFile } = policy;
const { viewerOfChange, syntaxErrors } = debug;

const BOTH = ["jsonhippo", "yamlhippo"];
const JSON_ONLY = ["jsonhippo"];
const ALL = ["jsonhippo", "yamlhippo", "markhippo"];
const JSON_AND_MARK = ["jsonhippo", "markhippo"];

describe("routing", () => {
  test("files go to the viewer that owns their extension, case-insensitively", () => {
    assert.equal(viewerForFile("/a/b.json").id, "jsonhippo");
    assert.equal(viewerForFile("/a/B.JSON").id, "jsonhippo");
    assert.equal(viewerForFile("/a/b.yaml").id, "yamlhippo");
    assert.equal(viewerForFile("/a/b.yml").id, "yamlhippo");
    for (const ext of ["md", "markdown", "mdown", "mkd", "mkdn", "MD"]) assert.equal(viewerForFile(`/a/b.${ext}`).id, "markhippo", ext);
  });

  test("anything else has no viewer", () => {
    assert.equal(viewerForFile("/a/b.txt"), null);
    assert.equal(viewerForFile("/a/json"), null);
    assert.equal(viewerForFile("/a/b.json.bak"), null);
  });

  test("conversion is offered only to the other viewers in this build", () => {
    assert.deepEqual(conversionTargets("jsonhippo", BOTH).map((v) => v.format), ["yaml"]);
    assert.deepEqual(conversionTargets("yamlhippo", BOTH).map((v) => v.format), ["json"]);
    assert.deepEqual(conversionTargets("jsonhippo", JSON_ONLY), []);
  });

  test("conversion stays within a data model: Markdown converts to nothing, nothing to Markdown", () => {
    assert.deepEqual(conversionTargets("markhippo", ALL), []);
    assert.deepEqual(conversionTargets("jsonhippo", ALL).map((v) => v.id), ["yamlhippo"]);
    assert.deepEqual(convertibleViewers(ALL).map((v) => v.id), ["jsonhippo", "yamlhippo"]);
    assert.deepEqual(convertibleViewers(JSON_AND_MARK), []);
  });

  test("a viewer that writes the target exports; one that cannot hands its text over", () => {
    assert.equal(conversionRoute(["yaml", "json"], "json"), "export"); // YamlHippo → JSON
    assert.equal(conversionRoute(["json"], "yaml"), "import"); //          JsonHippo → YAML
    assert.equal(conversionRoute(undefined, "yaml"), "import");
  });

  test("the open dialog offers what this build opens", () => {
    assert.deepEqual(openFilters(JSON_ONLY), [{ name: "JSON Documents", extensions: ["json"] }]);
    assert.deepEqual(openFilters(BOTH)[0], { name: "All Supported Documents", extensions: ["json", "yaml", "yml"] });
  });

  test("a converted document is named after its source", () => {
    const yaml = router.byId("yamlhippo");
    assert.equal(renameFor("config.json", yaml), "config.yaml");
    assert.equal(renameFor("archive.tar.json", yaml), "archive.tar.yaml");
    assert.equal(renameFor(null, yaml), "Untitled.yaml");
  });

  test("the OS is never offered .yaml before YamlHippo is in the build", () => {
    assert.deepEqual(fileAssociations(JSON_ONLY).flatMap((a) => a.ext), ["json"]);
    assert.deepEqual(fileAssociations(BOTH).flatMap((a) => a.ext), ["json", "yaml", "yml"]);
    assert.deepEqual(fileAssociations(JSON_AND_MARK).map((a) => a.name), ["JSON Document", "Markdown Document"]);
  });
});

describe("classifyNavigation", () => {
  test("the viewer's own page loads", () => {
    assert.equal(classifyNavigation(viewerUrl("jsonhippo", "1.2.3"), "jsonhippo"), "app");
    assert.equal(new URL(viewerUrl("jsonhippo", "1.2.3")).search, "?desktop=1.2.3&host=viewhippo");
    assert.equal(classifyNavigation("viewhippo://jsonhippo/", "jsonhippo"), "app");
    assert.equal(classifyNavigation("viewhippo://jsonhippo/index.html#tree", "jsonhippo"), "app");
  });

  test("links leave through the system browser", () => {
    assert.equal(classifyNavigation("https://hippoherd.com/jsonhippo/docs/", "jsonhippo"), "external");
    assert.equal(classifyNavigation("http://example.com/", "jsonhippo"), "external");
    assert.equal(classifyNavigation("mailto:someone@example.com", "jsonhippo"), "external");
  });

  test("everything else goes nowhere", () => {
    for (const url of [
      "viewhippo://yamlhippo/index.html", // another viewer
      "viewhippo://jsonhippo/docs/index.html", // another page: it would lose the document
      "file:///etc/passwd",
      "data:text/html,hi",
      "javascript:alert(1)",
      "blob:viewhippo://jsonhippo/x",
      "not a url",
    ]) {
      assert.equal(classifyNavigation(url, "jsonhippo"), "deny", url);
    }
  });
});

describe("resolveAppFile", () => {
  const web = path.resolve("/srv/web");
  const at = (...p) => path.join(web, ...p);

  test("a viewer's files resolve inside its own directory", () => {
    assert.equal(resolveAppFile("viewhippo://jsonhippo/index.html?desktop=1", web, BOTH), at("jsonhippo", "index.html"));
    assert.equal(resolveAppFile("viewhippo://jsonhippo/", web, BOTH), at("jsonhippo", "index.html"));
    assert.equal(resolveAppFile("viewhippo://jsonhippo/js/app.js", web, BOTH), at("jsonhippo", "js", "app.js"));
    assert.equal(resolveAppFile("viewhippo://jsonhippo/img/a%20b.svg", web, BOTH), at("jsonhippo", "img", "a b.svg"));
  });

  test("an unknown or absent viewer serves nothing", () => {
    assert.equal(resolveAppFile("viewhippo://yamlhippo/index.html", web, JSON_ONLY), null);
    assert.equal(resolveAppFile("viewhippo://chiphippo/index.html", web, BOTH), null);
    assert.equal(resolveAppFile("https://jsonhippo/index.html", web, BOTH), null);
  });

  test("nothing escapes the viewer's directory", () => {
    for (const url of [
      "viewhippo://jsonhippo/../yamlhippo/index.html",
      "viewhippo://jsonhippo/%2e%2e/yamlhippo/index.html",
      "viewhippo://jsonhippo/%2e%2e%2f%2e%2e/etc/passwd",
      "viewhippo://jsonhippo/..%5c..%5cetc",
      "viewhippo://jsonhippo/a%00b",
      "viewhippo://jsonhippo/%E0%A4%A",
    ]) {
      const file = resolveAppFile(url, web, BOTH);
      assert.ok(file === null || file.startsWith(at("jsonhippo") + path.sep), `${url} → ${file}`);
    }
    assert.equal(resolveAppFile("viewhippo://jsonhippo/%2e%2e%2fyamlhippo/index.html", web, BOTH), null);
  });

  test("the site's page about the viewer is not part of the viewer", () => {
    assert.equal(resolveAppFile("viewhippo://jsonhippo/about/", web, BOTH), null);
    assert.equal(resolveAppFile("viewhippo://jsonhippo/about/index.html", web, BOTH), null);
    assert.equal(resolveAppFile("viewhippo://jsonhippo/docs/about.html", web, BOTH), at("jsonhippo", "docs", "about.html"));
  });
});

describe("packaging", () => {
  const pkg = JSON.parse(readFileSync(new URL("../electron/package.json", import.meta.url), "utf8"));
  const build = pkg.build;

  test("every file main.js requires is packaged", () => {
    const main = readFileSync(new URL("../electron/main.js", import.meta.url), "utf8");
    const local = [...main.matchAll(/require\("\.\/([^"]+)"\)/g)].map((m) => `${m[1]}.js`);
    assert.ok(local.length > 0);
    for (const file of local) assert.ok(build.files.includes(file), `${file} is not in build.files`);
  });

  test("the six direct-download installers are the ones release.yml expects", () => {
    assert.equal(build.artifactName, "ViewHippo-${version}-${arch}.${ext}");
    assert.equal(build.nsis.artifactName, "ViewHippo-Setup-${version}-${arch}.${ext}");
    assert.deepEqual(build.mac.target, [{ target: "dmg", arch: ["arm64", "x64"] }]);
    assert.deepEqual(build.win.target, [{ target: "nsis", arch: ["x64", "arm64"] }]);
    assert.deepEqual(build.linux.target, [{ target: "AppImage", arch: ["x64", "arm64"] }]);
  });

  test("the Mac App Store build is sandboxed, and asks for files and nothing else", () => {
    assert.equal(build.mas.hardenedRuntime, false);
    const plist = readFileSync(new URL(`../electron/${build.mas.entitlements}`, import.meta.url), "utf8");
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort();
    assert.deepEqual(keys, [
      "com.apple.security.app-sandbox",
      "com.apple.security.cs.allow-jit",
      "com.apple.security.files.user-selected.read-write",
    ]);
  });
});

describe("make debug", () => {
  test("a change under website/<id>/ belongs to that viewer, except its about/ page", () => {
    assert.equal(viewerOfChange("jsonhippo/js/app.js", ALL), "jsonhippo");
    assert.equal(viewerOfChange("markhippo\\index.html", ALL), "markhippo");
    assert.equal(viewerOfChange("yamlhippo", ALL), "yamlhippo");
    assert.equal(viewerOfChange("jsonhippo/about/index.html", ALL), null);
    assert.equal(viewerOfChange("chiphippo/index.html", ALL), null);
    assert.equal(viewerOfChange("index.html", ALL), null);
    assert.equal(viewerOfChange(null, ALL), null);
  });

  test("an edit that doesn't parse is caught, with its file and line, before a restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viewhippo-debug-"));
    try {
      writeFileSync(path.join(dir, "good.js"), 'const x = require("y");\nmodule.exports = x;\n');
      writeFileSync(path.join(dir, "notes.txt"), "not { code");
      assert.deepEqual(syntaxErrors(dir), []);
      writeFileSync(path.join(dir, "bad.js"), "const a = 1;\nfunction (\n");
      const errors = syntaxErrors(dir);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /bad\.js:2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the shell's own files all parse", () => {
    assert.deepEqual(syntaxErrors(new URL("../electron/", import.meta.url).pathname), []);
  });
});
