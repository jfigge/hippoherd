# Prompts: hide the header parts ViewHippo's tab strip now shows

ViewHippo now puts each viewer's logo on its tab and its theme control at the right
of its tab strip, and offers its Hippo Herd and GitHub links in the Help menu
(they started at the right of the strip, until the tabs needed the room). So each
viewer hides
those parts of its own header, which would otherwise sit under the strip as a
second header. The contract is "Host chrome" in `viewhippo-app-build-brief.md`.

**Status (2026-10-15):** done for all three, and published with `make site`.
MarkHippo got the viewer API (the integration prompt) in the same change.

There's one prompt per viewer below. Paste the part between the lines into a Claude
Code session opened in that viewer's repository. JsonHippo's and YamlHippo's are
the same change on the same header. MarkHippo's header holds more, so its prompt
says what stays.

---

## JsonHippo

You're working in **jsonhippo**. ViewHippo, the herd's desktop app (in
`../hippoherd`, `electron/`), now shows JsonHippo's logo on its tab, and JsonHippo's
Hippo Herd link, theme toggle and GitHub link in its tab strip. Make JsonHippo hide
its own copies of those inside ViewHippo, and only there. Read "Host chrome" in
`../hippoherd/features/viewhippo-app-build-brief.md` first. If it disagrees with
this prompt, the brief wins; say so in your report.

**What the host does.** It loads the page as
`index.html?desktop=<v>&host=viewhippo&chrome=tabs` while its tab strip is showing,
and with `chrome=full` when tabs are off. When the user toggles tabs, it sets
`document.documentElement.dataset.viewhippoChrome` to `"tabs"` or `"full"` on the
page that's already loaded. On the web there's no `chrome` parameter.

**Tasks**
1. **Copy the parameter to the root element before first paint.** In
   `src/js/theme.js`, the classic `<head>` script that already applies the saved
   theme, read `chrome` from `location.search`. If it's present, set
   `document.documentElement.dataset.viewhippoChrome` to it. Inline scripts are
   blocked by the page's CSP, so it goes in that file. Wrap it in the same
   try/catch style.
2. **Hide the header row in tabs mode.** In `src/css/app.css`, add
   `[data-viewhippo-chrome="tabs"] .jh-header { display: none; }`. Everything in
   `.jh-header` moves to the strip:
   - the brand (logo and name);
   - the tagline;
   - Hippo Herd;
   - the theme toggle;
   - GitHub.

   Key the rule off the attribute only, because the host flips it on a live page.
   Check nothing else depends on the header's height (sticky offsets, `calc()`
   heights, scroll containers). If something does, make it work with the header
   gone.
3. **Keep About reachable.** Clicking the brand opened the About dialog
   (`#jh-about-open`). Add `showAbout()` to `window.hippoViewer` in
   `src/js/viewhippo.js` to open that same dialog. ViewHippo offers it as
   Help → About JsonHippo.
4. **The theme.** The strip's theme control is the app's Appearance, and the host
   applies it with the existing `setTheme(mode)`. Make sure `setTheme` updates
   everything the hidden toggle would have: the stored `jsonhippo.theme`, the
   `data-theme` attribute, and the toggle's label and icon, so the toggle is right
   when the header shows again with tabs off. Don't add a second theme path.
5. **Tests.** Add a unit test for the parameter-to-attribute logic. If it's easier
   to test that way, factor it into a small function. `make check` must pass.

**Don't**
- Change anything when there's no `chrome` parameter. hippoherd.com/jsonhippo/
  must look exactly as before.
- Hide anything outside `.jh-header`. The Tree / Text / Schema / Diff tabs and the
  toolbar stay.
- Edit `../hippoherd` except through `make site`. Don't commit or push there.

**Verify**
1. `make check`.
2. `make serve`: the page is unchanged. Then open
   `/?host=viewhippo&chrome=tabs`: the header row is gone. Run
   `document.documentElement.dataset.viewhippoChrome = "full"` in the console: it
   comes back.
3. `make site`, then in `../hippoherd`, `make desktop ARGS=/path/to/sample.json`:
   - There's no JsonHippo header under the tab strip.
   - The strip's theme button changes JsonHippo's theme.
   - View → Open Documents in Tabs (off) brings the header back, with its toggle
     showing the current theme. Turning tabs back on hides it again.
   - Help → About JsonHippo opens the About dialog.
4. Report:
   - what changed;
   - anything that depended on the header's height;
   - the `git status` of `../hippoherd/website/jsonhippo/`.

---

## YamlHippo

You're working in **yamlhippo**. ViewHippo, the herd's desktop app (in
`../hippoherd`, `electron/`), now shows YamlHippo's logo on its tab, and YamlHippo's
Hippo Herd link, theme toggle and GitHub link in its tab strip. Make YamlHippo hide
its own copies of those inside ViewHippo, and only there. Read "Host chrome" in
`../hippoherd/features/viewhippo-app-build-brief.md` first. If it disagrees with
this prompt, the brief wins; say so in your report.

**What the host does.** It loads the page as
`index.html?desktop=<v>&host=viewhippo&chrome=tabs` while its tab strip is showing,
and with `chrome=full` when tabs are off. When the user toggles tabs, it sets
`document.documentElement.dataset.viewhippoChrome` to `"tabs"` or `"full"` on the
page that's already loaded. On the web there's no `chrome` parameter.

**Tasks**
1. **Copy the parameter to the root element before first paint.** In
   `src/js/theme.js`, the classic `<head>` script that already applies the saved
   theme, read `chrome` from `location.search`. If it's present, set
   `document.documentElement.dataset.viewhippoChrome` to it. Inline scripts are
   blocked by the page's CSP, so it goes in that file.
2. **Hide the header row in tabs mode.** In `src/css/app.css`, add
   `[data-viewhippo-chrome="tabs"] .yh-header { display: none; }`. Everything in
   `.yh-header` moves to the strip:
   - the brand;
   - the tagline;
   - Hippo Herd;
   - the theme toggle;
   - GitHub.

   Key the rule off the attribute only, because the host flips it on a live page.
   Check nothing else depends on the header's height. That includes the document
   switcher for multi-document streams, and the tag legend and Types panel if
   they're positioned against it.
3. **Keep About reachable.** Clicking the brand opened the About dialog. Add
   `showAbout()` to `window.hippoViewer` in `src/js/viewhippo.js` to open that same
   dialog. ViewHippo offers it as Help → About YamlHippo.
4. **The theme.** The strip's theme control is the app's Appearance, applied with
   the existing `setTheme(mode)`. Make sure `setTheme` updates everything the hidden
   toggle would have: the stored `yamlhippo.theme`, `data-theme`, and the toggle's
   label and icon. Don't add a second theme path.
5. **Tests.** Add a unit test for the parameter-to-attribute logic. `make check`
   must pass.

**Don't**
- Change anything when there's no `chrome` parameter. hippoherd.com/yamlhippo/
  must look exactly as before.
- Hide anything outside `.yh-header`.
- Edit `../hippoherd` except through `make site`. Don't commit or push there.

**Verify**
1. `make check`.
2. `make serve`: the page is unchanged. Then open
   `/?host=viewhippo&chrome=tabs`: the header row is gone. Setting the attribute to
   `"full"` in the console brings it back.
3. `make site`, then in `../hippoherd`, `make desktop ARGS=/path/to/sample.yaml`:
   - There's no YamlHippo header under the tab strip.
   - The strip's theme button changes YamlHippo's theme.
   - With tabs off, the header is back with the right theme label.
   - Help → About YamlHippo works.
   - File → Convert to JSON still works.
4. Report:
   - what changed;
   - anything that depended on the header's height;
   - the `git status` of `../hippoherd/website/yamlhippo/`.

---

## MarkHippo

You're working in **markhippo**. ViewHippo, the herd's desktop app (in
`../hippoherd`, `electron/`), now shows MarkHippo's logo on its tab, and MarkHippo's
Hippo Herd link, light/dark toggle and GitHub link in its tab strip. Make MarkHippo
hide its own copies of those inside ViewHippo, and only there. Read "Host chrome" in
`../hippoherd/features/viewhippo-app-build-brief.md` first. If it disagrees with
this prompt, the brief wins; say so in your report.

**Do the viewer integration first.** MarkHippo doesn't publish `window.hippoViewer`
yet, so ViewHippo can't hand it a file, and this task's `setTheme` and `showAbout`
need that API. If `src/js/viewhippo.js` (or equivalent) doesn't exist yet, do
`../hippoherd/features/viewhippo-viewer-integration-prompt.md` first, in this same
session, then this.

**What the host does.** It loads the page as
`index.html?desktop=<v>&host=viewhippo&chrome=tabs` while its tab strip is showing,
and with `chrome=full` when tabs are off. When the user toggles tabs, it sets
`document.documentElement.dataset.viewhippoChrome` to `"tabs"` or `"full"` on the
page that's already loaded. On the web there's no `chrome` parameter.

**Tasks**
1. **Copy the parameter to the root element before first paint.** In
   `src/js/theme.js`, the classic `<head>` script that applies the saved theme,
   read `chrome` from `location.search`. If it's present, set
   `document.documentElement.dataset.viewhippoChrome` to it. Inline scripts are
   blocked by the page's CSP, so it goes in that file.
2. **In tabs mode, hide what the strip now shows**, with rules under
   `[data-viewhippo-chrome="tabs"]`:
   - the brand (`.mh-brand`: logo and name);
   - the Hippo Herd link;
   - the light/dark mode toggle (`#mh-theme`);
   - the GitHub link.

   Give each of these a class or id you can target, rather than matching on
   `href`. Key everything off the attribute, because the host flips it on a live
   page.
3. **MarkHippo's own tools stay.** These have no place in the strip:
   - Export (print, PDF, HTML, RTF, text, copy);
   - Plugins;
   - the user guide link;
   - Themes (palettes).

   With the brand gone the header row should be short. Make it a slim toolbar
   row, or, if MarkHippo already has a toolbar row they fit into, move them there
   in tabs mode so the header row goes entirely. Use your judgement and say which
   you chose.
4. **Duplicates of the app's File menu**, in both chrome modes, whenever
   `host=viewhippo`:
   - New, Open and Save, and the file-name label (`#mh-filename`), duplicate
     ViewHippo's File menu and its tab or title. Hide them. The integration prompt
     already allows this one `host` check.
   - The file input's `accept` list can stay.
5. **Keep About reachable.** The brand opened the About dialog (`#mh-about-open`).
   Add `showAbout()` to `window.hippoViewer` to open it. ViewHippo offers it as
   Help → About MarkHippo.
6. **The theme.** The strip's control is the app's Appearance: system, light or
   dark. The host applies it with `setTheme(mode)`. Implement `setTheme` so it sets
   MarkHippo's light/dark mode exactly as the hidden `#mh-theme` toggle would (the
   stored mode, the attribute, and the toggle's label). The palette chosen in
   Themes is separate, and stays MarkHippo's.
7. **Tests.** Add unit tests for the parameter-to-attribute logic and for
   `setTheme`/`showAbout` where the logic is real. `make check` must pass.

**Don't**
- Change anything when there's no `chrome` and no `host` parameter.
  hippoherd.com/markhippo/ must look exactly as before.
- Hide Export, Plugins, the guide or Themes.
- Touch MarkHippo's own standalone Electron app (`electron/`).
- Edit `../hippoherd` except through `make site`. Don't commit or push there.

**Verify**
1. `make check`.
2. `make serve`: the page is unchanged. Then open
   `/?host=viewhippo&chrome=tabs`: brand, Hippo Herd, mode toggle, GitHub, New,
   Open, Save and the file name are gone, and the rest is still there.
3. `make site`, then in `../hippoherd`, `make desktop ARGS=/path/to/notes.md`:
   - The document opens. There's no "can't exchange documents" message.
   - The strip's theme button switches MarkHippo between light and dark.
   - With tabs off, the brand, links and toggle are back.
   - Help → About MarkHippo works.
   - Save writes the file.
4. Report:
   - what changed;
   - where Export, Plugins, the guide and Themes ended up;
   - the `git status` of `../hippoherd/website/markhippo/`.
