# ViewHippo — Shared desktop app build

## What this is
ViewHippo is the **shared Electron desktop app** (destined for the App Store) that
bundles the herd's viewers together: **JsonHippo**, **YamlHippo** and **MarkHippo**.
It lives **inside the Hippo Herd website project** (`jfigge/hippoherd`, `electron/`)
as that project's desktop export. This brief sets up the app shell and the release
build that pulls the suite together.

## The app is deliberately THIN
It owns **no parser or viewer logic of its own**. It is:
- the Electron shell, window, and menus;
- a file-open dialog;
- a **router** that loads the right viewer bundle by opened file type
  (`.json` → JsonHippo, `.yaml`/`.yml` → YamlHippo,
  `.md`/`.markdown`/`.mdown`/`.mkd`/`.mkdn` → MarkHippo);
- app-wide concerns only: window behaviour, file-type routing, and (optionally) a
  global light/dark that viewers can honour.

Settings and any plugins belong to the **viewer**, not the host — each viewer brings
its own; the host delegates to whichever viewer is on screen.

## Source of truth
The app **consumes the viewers' build artifacts**; it never contains its own copy of
their code. Each viewer pushes its built bundle into this project via its own
`make site` (see `viewhippo-viewer-integration-prompt.md`). Fix a bug in a viewer's
project, redeploy, and the desktop app gets it. **Do not let the app grow its own
viewer logic** — that's the two-codebases trap we're avoiding.

## Features the shell provides
1. **File-type routing** — open a file, load the matching viewer bundle, show it.
2. **In-process JSON↔YAML conversion** — a convert command turns a JSON document
   into YAML and back, without a round-trip to a website.
   - It's lossy YAML→JSON (anchors/aliases, comments, multi-doc streams, non-string
     keys drop). Do it as best as possible and **show a note on what was dropped**.
   - Conversion only happens between viewers that **share a data model**. JSON and
     YAML share a tree; Markdown is a document of its own and converts to nothing.

## Release build
- Set up the build so that **on release**, the whole thing is assembled: the latest
  viewer bundles are pulled in, the Electron app is packaged, signed, and produced
  as an App Store–ready artifact.
- Reuse Jason's existing signing/cert and CI pipeline conventions (he already ships
  Electron apps to the Mac App Store).

## Decisions
**2026-10-15**
- **Name:** the app is **ViewHippo**. Bundle id `com.hippoherd.viewhippo`; installers
  `ViewHippo-<version>-<arch>.<ext>`.
- **Distribution:** Mac App Store **and** direct downloads (DMG / Windows / Linux) on
  this repo's GitHub Releases, which the site's `versions.json` already reads.
- **Conversion hands off text, not the tree.** Each viewer is its own page in its
  own renderer, so a "tree handoff" would be a structured clone over IPC of nodes
  whose `start`/`end`/`raw` offsets mean nothing to the other viewer. Re-parsing
  costs milliseconds and keeps the viewers decoupled.
- **Viewers switch on as they arrive.** Each viewer is registered in the router and
  is part of a build once its bundle is in `website/<viewer>/`. Until it implements
  the viewer API below, it opens empty and the app says it can't hand it a file.
- **Save / Save As are in scope.** A converted document needs somewhere to go.
- **MarkHippo joins ViewHippo.** This reverses the original scope rule, which kept
  markdown out. It joins as a viewer with no conversion (see the scope rule below).

## Artifact & viewer contract
`viewhippo-viewer-integration-prompt.md` turns this into instructions for a viewer's
repository.

### The artifact
- A viewer's artifact is **`website/<viewer>/` in this repo**. That's exactly what
  its `make site` already writes (`rsync --delete` of its `dist/`), so `make site`
  feeds the web page and the app in one step. The app packages that directory
  **minus `about/`**, which is hippoherd's generated page about the viewer.
- The entry is `index.html`. It must work **offline**: the app cancels every
  network request, so anything loaded from a CDN needs a local fallback (as
  JsonHippo's jQuery already has).
- A viewer is switched on in the app when `website/<viewer>/index.html` exists.
- Each viewer is served from its own origin (`viewhippo://<viewer>/`), so its
  `localStorage` is its own.
- The page is loaded as `index.html?desktop=<app version>&host=viewhippo`.
  `desktop` is what JsonHippo's and MarkHippo's own shells already pass; `host`
  tells the viewer it is inside ViewHippo.

### The viewer API (about 30 lines, in the viewer)
Once the page has booted, set `window.hippoViewer` and dispatch
`hippoviewer-ready` on `window`:

```js
window.hippoViewer = {
  formats: { reads: ["json"], writes: ["json"] }, // what load() / exportAs() take
  load(text, { name }) {},  // replace the document; validate it as a paste would
  getText() {},             // the current text, for Save and the unsaved-changes check
  exportAs(format) {},      // → { text, dropped: [{ what, where }] }; throws if the text doesn't parse
  setTheme(mode) {},        // optional: "system" | "light" | "dark"
};
window.dispatchEvent(new Event("hippoviewer-ready"));
```

The host calls these through `webContents.executeJavaScript`. There's no preload
and no Node, and the renderer stays sandboxed. A viewer without the API still
opens, but the app can't hand it a file and says so.

### Conversion (the host's algorithm)
To convert the document in viewer S into format *t*, owned by viewer T, where S and
T share a data model:
1. If S `writes` *t*: `S.exportAs(t)`.
2. Otherwise: `T.load(S.getText())` (valid JSON is valid YAML), then
   `T.exportAs(t)`.
3. The result opens in a new, untitled T window. A non-empty `dropped` list is
   shown to the user.

So the YAML emitter and the YAML→JSON drop report live entirely in YamlHippo.
JsonHippo needs no YAML knowledge.

## Open question: desktop features beyond the contract
MarkHippo's own desktop shell gives its page a bridge (`window.markhippoDesktop`,
through a preload). It uses it to:
- save in place;
- save exports through a dialog;
- print and print to PDF;
- copy rich text;
- save pasted pictures into `assets/` beside the document;
- show the document's own relative images (`/@doc/`);
- load the user's plugins from a folder.

ViewHippo's contract has none of these. Inside ViewHippo, MarkHippo falls back to
what it does in a browser tab, which is weaker than its own app. Two ways forward:
- **Generic host services.** ViewHippo grows a small, optional bridge
  (`window.viewHippoHost`: save an export, print, rich copy, document-relative
  assets, a per-viewer plugins folder) that any viewer can feature-detect. The
  services are file and OS plumbing, not viewer logic.
- **MarkHippo stays standalone** as well, and ViewHippo hosts the browser-level
  MarkHippo.

Until this is decided, viewers keep such features feature-detected, so they degrade
to browser behaviour inside ViewHippo.

**Status (2026-10-15): deferred.** MarkHippo goes into ViewHippo cut down, at browser
level. Which host services to add, if any, will be decided once that version is in
use.

## Scope rule for the future
A viewer joins ViewHippo if it is a **viewer/editor of a text document format** whose
web page already lives on hippoherd.com and publishes through `make site`.
Conversion is offered only between viewers that **share a data model** (JSON ↔ YAML
today). Keep the suite from becoming a dumping ground: anything that needs the
network, a server, or its own native integrations is a separate app.
