# Prompt: ship this viewer inside ViewHippo

Paste everything below the line into a Claude Code session opened in a **viewer's
own repository** (`jsonhippo`, `yamlhippo` or `markhippo`). It's the same prompt for
every viewer; the per-viewer details are in the table it contains.

---

You're working in one of the Hippo herd's **viewer** repositories. Your job is to
make this viewer ready to ship inside **ViewHippo**, the herd's shared desktop app,
and to publish it there.

## How ViewHippo works (read this before changing anything)

- ViewHippo is a thin Electron shell in the **hippoherd** repository (`electron/`,
  usually checked out at `../hippoherd`). It owns **no viewer logic**. It opens one
  window per document and routes each file to the viewer that owns its extension.
  It provides Open / Save / Save As / Open Recent, an app-wide Appearance menu, and
  JSON ↔ YAML conversion.
- **This repository stays the source of truth.** ViewHippo packages exactly what
  this repo's `make site` publishes to `../hippoherd/website/<id>/` (the same copy
  that serves hippoherd.com/<id>/), **minus `about/`**, which is hippoherd's own
  generated page about the viewer. Nothing is fetched at build time. What's
  committed in hippoherd is what ships.
- In ViewHippo, the viewer's page loads **unchanged**, as
  `viewhippo://<id>/index.html?desktop=<app version>&host=viewhippo`:
  - Each viewer gets its own origin, and so its own `localStorage`.
  - The renderer is sandboxed, with **no preload and no Node**.
  - **Every network request is cancelled.**
  - Links to http(s) and mailto open in the system browser.
  - Navigating to any other page inside the bundle is refused, because it would
    throw away the open document.
- The host talks to the page only through `window.hippoViewer` (below), called with
  `executeJavaScript`. A page without it still opens, but the app can't give it a
  file, save it, or convert it, and the app tells the user so.
- The full contract is in `../hippoherd/features/viewhippo-app-build-brief.md`. Read
  it first. If it disagrees with this prompt, **the brief wins**; point out the
  disagreement in your report.

## Find this viewer's row

| Viewer | id (`website/<id>/`) | Extensions it opens | `formats` | Data model |
|---|---|---|---|---|
| JsonHippo | `jsonhippo` | `.json` | `{ reads: ["json"], writes: ["json"] }` | tree |
| YamlHippo | `yamlhippo` | `.yaml` `.yml` | `{ reads: ["yaml", "json"], writes: ["yaml", "json"] }` | tree |
| MarkHippo | `markhippo` | `.md` `.markdown` `.mdown` `.mkd` `.mkdn` | `{ reads: ["markdown"], writes: ["markdown"] }` | document |

If this repository isn't one of these, **stop and ask**. A new viewer also needs a
row in `../hippoherd/electron/router.js`, and that's a decision for the hippoherd
repo, not something to do from here.

## Tasks

### 1. Publish through `make site`
- `make site` must:
  - run the repo's checks first (`check`: lint, validate, test), so a red build
    never reaches the site or the app;
  - build `dist/`;
  - `rsync -a --delete --exclude .DS_Store --exclude /about/ dist/
    "$(HIPPOHERD)/website/<id>/"`, with `HIPPOHERD ?= ../hippoherd`.
- JsonHippo's and MarkHippo's Makefiles already do this. Confirm it, and change
  nothing that works. YamlHippo copies JsonHippo's `site` and `preview-site`
  targets as they are.
- Never hand-edit anything under `../hippoherd/website/<id>/`, and never touch its
  `about/`.

### 2. Make the page work offline and inside a bundle
- **No runtime network dependency.** Anything loaded from a CDN (jQuery, fonts,
  Mermaid, highlighters, …) needs a bundled copy the page falls back to, or uses
  directly. JsonHippo's jQuery fallback is the worked example. No analytics, no
  remote fonts, no `fetch` to hippoherd.com.
- **Relative URLs for the bundle's own files** (`css/app.css`, not
  `/<id>/css/app.css`), so the same files work at hippoherd.com/<id>/ and at
  viewhippo://<id>/.
- **Links to the viewer's docs or other pages** must be absolute https URLs
  (`https://hippoherd.com/<id>/docs/`), so they open in the browser. A relative
  link to `docs/` goes nowhere inside the app.
- **`localStorage` keys** are prefixed `<id>.`.

### 3. Implement `window.hippoViewer`
Put it in one small module, for example `src/js/viewhippo.js`, wired from the
app's entry point. It has **no Electron, IPC, or Node code**, and it's harmless in
a browser tab (nothing calls it there). Once the app has booted and can take a
document:

```js
window.hippoViewer = {
  formats: { reads: [...], writes: [...] },  // from the table
  load(text, { name }) {},  // replace the whole document with `text`
  getText() {},             // the document's current text, exactly as Save should write it
  exportAs(format) {},      // → { text, dropped: [{ what, where }] }
  setTheme(mode) {},        // optional: "system" | "light" | "dark"
};
window.dispatchEvent(new Event("hippoviewer-ready"));
```

What each part has to do:
- **`load`**
  - Replace the whole document with `text`, through the **same path a paste or
    file-load takes**: validate, render, update the status bar.
  - Clear any undo state that would let the user "undo" back to the previous
    document.
  - Use `name` only for display; there's no file path.
  - It may tidy the text (smart paste, for instance). The host re-reads
    `getText()` afterwards and treats that as the saved state.
- **`getText`** is synchronous or a Promise, and returns a string.
  - Called right after page load, it returns what a new document starts with (an
    empty box, MarkHippo's sample). The host treats that as "unsaved changes:
    none".
- **`exportAs(format)`** works for every format in `writes`.
  - If the current text doesn't parse, **throw an `Error` whose message the user
    can act on**, for example "Line 12, column 4: …". The host shows the message.
  - `dropped` is `[]` when nothing was lost.
  - Otherwise there's one entry per kind of loss, with a location where there is
    one: `{ what: "comment", where: "line 3" }`. Keep it readable rather than
    exhaustive; the host shows the list as bullets.
- **`setTheme`** drives the viewer's own theme setting, if it has one. Leave it out
  if there's nothing to drive; the page already follows `prefers-color-scheme`,
  which ViewHippo's Appearance menu sets.
- **Ready.** Set the API only after the app has initialised, then dispatch
  `hippoviewer-ready`. The host waits 5 s for it.

Per-format duties:
- **JsonHippo:** `writes: ["json"]` only. No YAML code. ViewHippo converts
  JSON → YAML by loading the JSON text into YamlHippo.
- **YamlHippo:**
  - A **YAML emitter** (block style) from the shared tree, so `exportAs("yaml")`
    also normalises JSON that was loaded into it.
  - YAML → JSON via `exportAs("json")`, with `dropped` covering:
    - anchors/aliases (expanded);
    - comments;
    - documents after the first in a stream;
    - non-string keys (stringified);
    - custom tags;
    - anything else that doesn't survive.
- **MarkHippo:** `reads`/`writes` `["markdown"]`. `exportAs("markdown")` returns
  `{ text: getText(), dropped: [] }`. ViewHippo offers no conversion for
  Markdown; HTML/PDF exports stay MarkHippo's own feature.

### 4. Desktop-only features
ViewHippo gives the page **no bridge of its own** (no preload). If this viewer has
features that depend on its own standalone shell's bridge (MarkHippo's
`window.markhippoDesktop`: save in place, save export, print/PDF, rich copy, pasted
images into `assets/`, `/@doc/` images, user plugins):
- leave them feature-detected, so inside ViewHippo they behave exactly as in a
  browser tab;
- don't add a second copy of them that talks to ViewHippo;
- **list them in your report** as "unavailable in ViewHippo".

Whether ViewHippo grows a generic bridge is an open question in the brief. It isn't
yours to settle here.

### 5. Don't
- Don't delete or rework this repo's **standalone Electron app** (`electron/`) as
  part of this task. Retiring it is a separate, explicit decision; JsonHippo has its
  own brief for it.
- Don't add ViewHippo-specific branches beyond an optional
  `new URLSearchParams(location.search).get("host") === "viewhippo"` check, for
  example to hide an in-page "Load from file" button that duplicates the app's
  menu.
- Don't edit anything in `../hippoherd` except through `make site`. Don't commit
  or push there; that's for the user, after review.
- Don't change the viewer's features, parser, or look beyond what these tasks need.

## Verify
1. `make check` passes, with unit tests for `exportAs` / `dropped` where the logic
   is real (YamlHippo especially).
2. In a browser (`make serve`):
   - the page behaves exactly as before;
   - `window.hippoViewer` exists after load;
   - `hippoViewer.load('<sample>')` then `hippoViewer.getText()` round-trips.
3. Offline: in the DevTools Network panel, block all requests to other origins,
   reload, and check that everything still renders and works.
4. `make site`, then in `../hippoherd`:
   - `make desktop ARGS=/path/to/sample.<ext>` opens the file in this viewer.
   - Edit the document, then use **Save**, **Save As** and **Close**. Close should
     ask about unsaved changes only when there are some, and never for a fresh,
     untouched window.
   - YamlHippo: **File → Convert to JSON** shows the dropped list. JsonHippo with a
     YamlHippo bundle present: **Convert to YAML** gives block-style YAML.
   - **View → Appearance → Dark** reaches the page.
5. Report:
   - what changed;
   - the `formats` you published;
   - what's unavailable in ViewHippo (task 4);
   - anything in the brief that didn't fit this viewer;
   - the exact `git status` of `../hippoherd/website/<id>/` for the user to review
     and commit.
