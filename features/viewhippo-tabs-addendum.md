# ViewHippo — Addendum: tabs + title-bar settings

Two independent, app-wide (host-level) settings govern how the window frames documents
and what the title bar shows. Viewers are untouched in every combination — this is
purely host shell behaviour.

## Setting 1 — Tabs
**Default: ON.**

- **ON:** single window with a **tab strip**; each open document is a tab. Opening a
  file adds a tab (never a new window).
- **OFF:** no tab strip; **one document at a time** in whichever viewer matches the
  file type. Opening a file **replaces** what's shown.

## Setting 2 — Show full path in title
**Default: OFF.**

- **OFF:** the title bar shows the **short name** (last part of the file name, e.g.
  `fred.json`).
- **ON:** the title bar shows the **full path** (e.g. `/Users/.../fred.json`).

This setting governs the **title bar** in **both** tab modes — it applies whether tabs
are on or off.

## Constant behaviour (independent of either setting)
- A **tab always shows the short name** (the last part of the file name).
- **Hovering a tab always shows the full path** as a tooltip.

## Resulting combinations
- **Tabs ON + full path OFF (both defaults):** tab shows short name; title bar shows
  the active tab's short name; hover a tab → full path.
- **Tabs ON + full path ON:** tab shows short name; title bar shows the active tab's
  full path; hover a tab → full path.
- **Tabs OFF + full path OFF:** single document; title bar shows its short name.
- **Tabs OFF + full path ON:** single document; title bar shows its full path.

## Note
In tab mode, "the title bar" always reflects the **currently active tab** — switching
tabs updates the title to that document (short name or full path per setting 2).

## As built (2026-10-15)
Where the spec left a choice, `electron/main.js` does this:

- **Where the settings live.** View → **Open Documents in Tabs** and View → **Show
  Full Path in Title Bar**, both checkboxes, saved in `settings.json` with the
  Appearance.
- **No document open.** The window stays open and empty, with the ViewHippo mark,
  "No document open", an **Open…** button with its shortcut, and links to start a
  new JSON, YAML or Markdown document. A launch with no file shows this rather than
  an empty document, and so does closing the last tab.
- **Closing the window quits the app**, on macOS as well: its close button, Close
  Window (⇧⌘W) and Quit all end ViewHippo, after asking about any unsaved
  documents. Cancelling that question keeps the window and the app.
- **Untitled documents** have no path. The title shows their name whichever way
  setting 2 is set, and the tab's tooltip reads "Untitled.json — not saved yet".
- **Turning tabs off with several open** keeps the active tab and closes the
  others, each asking about unsaved changes first. Cancelling any of them leaves
  tabs on.
- **Tabs off: opening, New, and Convert** each replace the document on screen,
  after asking about its unsaved changes. For Convert, the source's text is taken
  first, so nothing is lost.
- **Tab keys.** ⌘W / Ctrl+W closes the tab; Ctrl+Tab and Ctrl+Shift+Tab move
  between tabs; a middle-click closes a tab.
- **The strip carries the viewers' headers.** Each tab shows its viewer's logo,
  and the right of the strip has the theme (the app's Appearance). The viewers'
  Hippo Herd and GitHub links are in the Help menu, which leaves the strip its
  room for tabs. The viewers hide those parts of their own header while the
  strip shows ("Host chrome" in the brief).
- **How it's built.** Each document is a `WebContentsView` laid out below the
  strip. The strip is the window's own page (`electron/chrome/`), the only page
  with a preload. The viewers' only part in it is hiding the header pieces the
  strip shows.
