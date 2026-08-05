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
| Mind Hippo | ML runtime written from scratch in Go | — | private for now |
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
scripts/build-versions.mjs → website/versions.json  (all six repos' releases)
scripts/make-marks.mjs     → website/marks/*.svg + favicon.svg
website/                   The site itself — committed, and served as-is
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

### Adding a hippo

1. Add an entry to `HERD` in `content/hippos.mjs`.
2. Add its colour and snout motif to `HIPPOS` in `scripts/make-marks.mjs`.
3. Add its slug to `HERD` in `scripts/build-versions.mjs`.
4. Add its hostname to `ALLOWED` in `website/preview.js` if it has a site.
5. Run all three generators.

The nav dropdown, the footer, the sitemap, the 404 page, the previous/next
links and the index grid all come from that list, so none of them needs
touching.

## Known TODOs

- **Mac App Store links.** Rest Hippo and Chip Hippo are published there, but
  neither repository records the listing URL and it cannot be derived from the
  bundle id. Until the URLs are filled into `MAS(...)` in
  `content/hippos.mjs`, those pages print a sentence saying the app is on the
  store rather than a badge that goes somewhere wrong.
- **Mind Hippo's repository is private**, so its page carries no GitHub links
  at all — a public site should not hand a visitor a 404. Delete the
  `repoPrivate: true` line in `content/hippos.mjs` when it opens up.
- **Mind Hippo's brand colour** (`#D946A6`) and its three-node snout motif are
  proposed here, not inherited: it is the one hippo with no published mark of
  its own. If it gets a different one later, change it in
  `scripts/make-marks.mjs` and `content/hippos.mjs`.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy-site.yml`). The custom domain comes from
`website/CNAME`; Pages must be set to **Source: GitHub Actions**, which the
workflow's `configure-pages` step enables on its first run.

A scheduled run at 07:15 UTC re-reads every hippo's releases and redeploys, so a
new Rest Hippo version reaches this site without a commit here.

## Licence

Apache 2.0. Copyright &copy; 2026 Jason Figge.
