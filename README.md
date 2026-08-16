# hippoherd.com

The umbrella site for the Hippo family — one page welcoming you to the herd,
and a dedicated page for each hippo.

**Live at [hippoherd.com](https://hippoherd.com).**

Some hippos have their own site because they are in an app store and need one.
The rest live here. This repository is what stops that from meaning "the rest
get nothing".

| Hippo | What it is | Its own site | Repo |
|---|---|---|---|
| Rest Hippo | REST API client | [resthippo.com](https://resthippo.com) | [jfigge/resthippo](https://github.com/jfigge/resthippo) |
| Chip Hippo | 74xx TTL breadboard simulator | [chiphippo.com](https://chiphippo.com) | [jfigge/chiphippo](https://github.com/jfigge/chiphippo) |
| Jump Hippo | On-demand SSH tunnels | [jumphippo.com](https://jumphippo.com) | [jfigge/jumphippo](https://github.com/jfigge/jumphippo) |
| Keep Hippo | Vault-compatible secrets manager | [keephippo.com](https://keephippo.com) | [jfigge/keephippo](https://github.com/jfigge/keephippo) |
| Maze Hippo | Tap-to-clear arrow puzzle (iOS / Android) | — | [jfigge/mazehippo](https://github.com/jfigge/mazehippo) |
| Mind Hippo | ML runtime written from scratch in Go | — | [jfigge/mindhippo](https://github.com/jfigge/mindhippo) |
| Roll Hippo | Shake-to-roll dice tray (iOS / Android) | — | [jfigge/rollhippo](https://github.com/jfigge/rollhippo) |

## What the site does

- **Detects the visitor's OS and chip** and puts a matching installer behind one
  button, per hippo, on both the index and the hippo's own page. Architecture
  comes from `navigator.userAgentData` where the browser offers it, and from the
  WebGL renderer string on Safari and Firefox — which is the only way to tell an
  Apple Silicon Mac from an Intel one, because the user-agent never has.
  When it is a guess, the page says so.
- **Shows each hippo's real website live**, in a scaled-down inert iframe.
  It reads like a screenshot and cannot go stale, because it is the site.
- **Tracks every repo's releases** — filenames, sizes and architectures come
  from the GitHub Releases API at deploy time, so no download link is ever
  hand-maintained.

Every page works with JavaScript blocked. The downloads fall back to "latest
release on GitHub", the version numbers read as an em-dash, and the detected
strip stays hidden rather than lying.

## Layout

```
content/hippos.mjs         Every user-visible word about every hippo
scripts/build-site.mjs     → website/*.html   (8 pages)
scripts/build-versions.mjs → website/versions.json  (all seven repos' releases)
scripts/make-marks.mjs     → website/marks/*.svg + favicon.svg
website/                   The site itself — committed, and served as-is
website/rollhippo/         NOT generated — Roll Hippo's own site, copied in
website/mazehippo/         NOT generated — Maze Hippo's own site, copied in
```

`website/` is generated **and** committed, so a checkout can be served with any
static server. CI regenerates it on every deploy anyway; that is what keeps the
version numbers honest between commits.

## Working on it

Everything is plain Node, no dependencies, no install step.

```sh
# Rebuild the pages after editing content/hippos.mjs
node scripts/build-site.mjs

# Refresh the release data (needs a token — any GitHub token will do)
GITHUB_TOKEN=$(gh auth token) node scripts/build-versions.mjs

# Redraw the hippo marks after editing their colours or motifs
node scripts/make-marks.mjs

# Serve it
cd website && python3 -m http.server 8791
```

**Do not hand-edit anything in `website/*.html`** — it is overwritten on the
next build. Prose lives in `content/hippos.mjs`; layout lives in
`scripts/build-site.mjs`; styling lives in `website/site.css`, which is written
by hand and is not generated.

### The exceptions: `website/rollhippo/` and `website/mazehippo/`

The two phone apps have no site of their own and are not getting one, so
`hippoherd.com/rollhippo/` and `hippoherd.com/mazehippo/` **are** their
websites — a product page and a privacy statement each, and in Roll Hippo's
case a full user guide, rather than the one-page introduction their siblings
get here. Those files are written in
[jfigge/rollhippo](https://github.com/jfigge/rollhippo) and
[jfigge/mazehippo](https://github.com/jfigge/mazehippo) under `website/`, and
land here by running `make site` in *that* repository.

`content/hippos.mjs` marks both `externalSite: true`, and the only thing the
flag does is stop `build-site.mjs` writing that one `index.html`. Everything
else still comes from the entry: the card on the index, the nav dropdown, the
footer, the 404 list, the sitemap, and its neighbours' previous/next links. So
edit its prose here and the *card* changes; the page itself does not, because
the page is not ours.

Two rules follow. Do not hand-edit `website/rollhippo/` or
`website/mazehippo/` here either — the next `make site` in the owning repo
overwrites it with `rsync --delete`. And do not give either hippo a `domain`,
which is what drives the "it has a home of its own" section and the live
iframe preview: pointed at `hippoherd.com/rollhippo` it would embed this site
inside itself.

Maze Hippo's pictures are worth one more note, because they are unusual and
they are not screenshots. `tool/website.dart` in that repository runs the
game's real painter against its real level generator and rasterises the
result, so the hero and the six boards on that page are the current game by
construction. `make site` there re-renders them before it copies, which is why
nothing here ever needs to know they exist.

### Adding a hippo

1. Add an entry to `HERD` in `content/hippos.mjs`.
2. Add its colour and snout motif to `HIPPOS` in `scripts/make-marks.mjs`.
3. Add its slug to `HERD` in `scripts/build-versions.mjs`.
4. Add it to `HIPPOS` in `website/herd.js` — `desktop: false` for a phone app,
   which is what stops the page offering a desktop installer for it.
5. Add its hostname to `ALLOWED` in `website/preview.js` if it has a site.
6. Run all three generators.

The nav dropdown, the footer, the sitemap, the 404 page, the previous/next
links and the index grid all come from that list, so none of them needs
touching.

## Known TODOs

- **Chip Hippo's Mac App Store link.** It is published there, but the
  repository does not record the listing URL and it cannot be derived from the
  bundle id — only App Store Connect knows the numeric app id. Until it is
  filled into `MAS(...)` in `content/hippos.mjs`, that page prints a sentence
  saying the app is on the store rather than a badge that goes somewhere wrong.
  Rest Hippo's is wired up and is the worked example to copy.
- **Mind Hippo's mark was settled here**, not inherited — it is the one hippo
  with no published mark of its own. Its colour is Go's brand cyan
  (`#00ADD8`), for a project that is pure Go against the standard library, and
  its snout carries a three-node network. It lives in two places that must
  agree: `content/hippos.mjs` (the page) and `scripts/make-marks.mjs` (the
  mark). If `jfigge/mindhippo` ever publishes its own mark, that becomes the
  source and this copies it.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy-site.yml`). The custom domain comes from
`website/CNAME`; Pages must be set to **Source: GitHub Actions**, which the
workflow's `configure-pages` step enables on its first run.

A scheduled run at 07:15 UTC re-reads every hippo's releases and redeploys, so a
new Rest Hippo version reaches this site without a commit here.

## Licence

Apache 2.0. Copyright &copy; 2026 Jason Figge.
