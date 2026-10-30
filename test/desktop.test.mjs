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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import router from "../electron/router.js";
import policy from "../electron/policy.js";
import debug from "../electron/debug.js";

const { viewerForFile, conversionTargets, convertibleViewers, conversionRoute, openFilters, renameFor, fileAssociations } = router;
const { viewerUrl, classifyNavigation, resolveAppFile, findPlugins } = policy;
const { viewerOfChange, syntaxErrors } = debug;

const BOTH = ["jsonhippo", "yamlhippo"];
const JSON_ONLY = ["jsonhippo"];
const ALL = ["jsonhippo", "yamlhippo", "markhippo"];
const JSON_AND_MARK = ["jsonhippo", "markhippo"];

describe("routing", () => {
  test("files go to the viewer that owns their extension, case-insensitively", () => {
    for (const ext of ["json", "JSON", "jsn", "Jsn", "geojson", "jsonld"]) assert.equal(viewerForFile(`/a/b.${ext}`).id, "jsonhippo", ext);
    for (const ext of ["yaml", "yml", "YAML", "Yml"]) assert.equal(viewerForFile(`/a/b.${ext}`).id, "yamlhippo", ext);
    for (const ext of ["md", "markdown", "mdown", "mkd", "mkdn", "MD"]) assert.equal(viewerForFile(`/a/b.${ext}`).id, "markhippo", ext);
  });

  test("anything else has no viewer", () => {
    assert.equal(viewerForFile("/a/b.txt"), null);
    assert.equal(viewerForFile("/a/b.jsonc"), null); // comments: not JSON
    assert.equal(viewerForFile("/a/b.json5"), null);
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
    const JSON_EXTS = ["json", "jsn", "geojson", "jsonld"];
    assert.deepEqual(openFilters(JSON_ONLY), [{ name: "JSON Documents", extensions: JSON_EXTS }]);
    assert.deepEqual(openFilters(BOTH)[0], { name: "All Supported Documents", extensions: [...JSON_EXTS, "yaml", "yml"] });
    // Known types only: no "All Files" filter, ever.
    for (const set of [JSON_ONLY, BOTH, ALL]) {
      for (const f of openFilters(set)) assert.ok(!f.extensions.includes("*"), JSON.stringify(f));
    }
  });

  test("a converted document is named after its source", () => {
    const yaml = router.byId("yamlhippo");
    assert.equal(renameFor("config.json", yaml), "config.yaml");
    assert.equal(renameFor("archive.tar.json", yaml), "archive.tar.yaml");
    assert.equal(renameFor(null, yaml), "Untitled.yaml");
  });

  test("the OS is never offered .yaml before YamlHippo is in the build", () => {
    assert.deepEqual(fileAssociations(JSON_ONLY).flatMap((a) => a.ext), ["json", "jsn", "geojson", "jsonld"]);
    assert.deepEqual(fileAssociations(BOTH).flatMap((a) => a.ext), ["json", "jsn", "geojson", "jsonld", "yaml", "yml"]);
    assert.deepEqual(fileAssociations(JSON_AND_MARK).map((a) => a.name), ["JSON Document", "Markdown Document"]);
  });
});

describe("classifyNavigation", () => {
  test("the viewer's own page loads", () => {
    assert.equal(classifyNavigation(viewerUrl("jsonhippo", "1.2.3"), "jsonhippo"), "app");
    assert.equal(new URL(viewerUrl("jsonhippo", "1.2.3")).search, "?desktop=1.2.3&host=viewhippo&chrome=full");
    assert.equal(new URL(viewerUrl("jsonhippo", "1.2.3", "tabs")).searchParams.get("chrome"), "tabs");
    assert.equal(new URL(viewerUrl("jsonhippo", "1.2.3", "bogus")).searchParams.get("chrome"), "full");
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

  const plugins = path.resolve("/home/user/plugins");

  test("/@plugins/ is the viewer's own plugins folder, and only a plugin's kinds of file", () => {
    const resolve = (url) => resolveAppFile(url, web, BOTH, plugins);
    assert.equal(resolve("viewhippo://jsonhippo/@plugins/sort.js"), path.join(plugins, "jsonhippo", "sort.js"));
    assert.equal(resolve("viewhippo://jsonhippo/@plugins/My%20Kit/index.mjs"), path.join(plugins, "jsonhippo", "My Kit", "index.mjs"));
    assert.equal(resolve("viewhippo://yamlhippo/@plugins/kit/look.CSS"), path.join(plugins, "yamlhippo", "kit", "look.CSS"));
    assert.equal(resolve("viewhippo://jsonhippo/@plugins/notes.md"), null);
    assert.equal(resolve("viewhippo://jsonhippo/@plugins/"), null);
  });

  test("a plugin URL reaches neither another viewer's plugins nor anything outside", () => {
    const resolve = (url) => resolveAppFile(url, web, BOTH, plugins);
    for (const url of [
      "viewhippo://jsonhippo/@plugins/../yamlhippo/x.js",
      "viewhippo://jsonhippo/@plugins/%2e%2e/yamlhippo/x.js",
      "viewhippo://jsonhippo/@plugins/%2e%2e%2f%2e%2e%2fsecret.js",
      "viewhippo://jsonhippo/@plugins/a%5cb.js",
    ]) {
      // A literal ../ is gone before the handler sees it: the URL's own path
      // climbs out of /@plugins/, into the viewer's directory.
      const file = resolve(url);
      const safe = [path.join(plugins, "jsonhippo"), at("jsonhippo")].some((root) => file?.startsWith(root + path.sep));
      assert.ok(file === null || safe, `${url} → ${file}`);
    }
    assert.equal(resolve("viewhippo://jsonhippo/@plugins/%2e%2e%2fyamlhippo%2fx.js"), null);
  });

  test("without a plugins folder, /@plugins/ serves nothing", () => {
    assert.equal(resolveAppFile("viewhippo://jsonhippo/@plugins/sort.js", web, BOTH), null);
  });
});

describe("findPlugins", () => {
  test("each .js/.mjs file, and each folder with an index, as URLs on the viewer's origin", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viewhippo-plugins-"));
    try {
      writeFileSync(path.join(dir, "b.mjs"), "");
      writeFileSync(path.join(dir, "a b.js"), "");
      writeFileSync(path.join(dir, "readme.md"), "");
      writeFileSync(path.join(dir, ".hidden.js"), "");
      mkdirSync(path.join(dir, "kit"));
      writeFileSync(path.join(dir, "kit", "index.mjs"), "");
      mkdirSync(path.join(dir, "empty"));
      assert.deepEqual(await findPlugins(dir, "markhippo"), [
        { name: "a b.js", url: "viewhippo://markhippo/@plugins/a%20b.js" },
        { name: "b.mjs", url: "viewhippo://markhippo/@plugins/b.mjs" },
        { name: "kit", url: "viewhippo://markhippo/@plugins/kit/index.mjs" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a folder that is not there yet has none", async () => {
    assert.deepEqual(await findPlugins(path.join(tmpdir(), "viewhippo-no-such-folder"), "markhippo"), []);
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

  test("the viewers' preload is packaged", () => {
    const main = readFileSync(new URL("../electron/main.js", import.meta.url), "utf8");
    assert.match(main, /preload: path\.join\(__dirname, "host-preload\.js"\)/);
    assert.ok(build.files.includes("host-preload.js"));
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
