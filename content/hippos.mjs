/*
 * Copyright 2026 Jason Figge
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The herd, as content. scripts/build-site.mjs turns this into website/.
//
// EVERY user-visible word about a hippo lives here and nowhere else. The
// alternative — prose in seven hand-written HTML files — is how the card on
// the index ends up describing a version of the app that the dedicated page
// contradicts.
//
// `blurb` and `lead` are two different jobs and are deliberately not the same
// sentence: `lead` is the card on the index, read in a grid beside five
// others, and `blurb` is the hero of the hippo's own page, read alone.
//
// Values are inserted as HTML, so anything here may carry inline markup
// (<strong>, <code>, <em>) — and must therefore be trusted, which it is: this
// file is the source, not user input.
//
// OPTIONAL FLAGS a hippo may carry:
//
//   repoPrivate: true   Its GitHub repository is not public yet, so the
//                       generator omits every link to it rather than putting a
//                       404 in front of a visitor who clicks. Mind Hippo was
//                       built this way and went public on 5 August 2026; the
//                       flag stays supported because a hippo tends to start
//                       closed and open up later. Delete the line when it does
//                       — the links come back on their own.
//
//   externalSite: true  Its page under website/ is written by the project
//                       itself, not by scripts/build-site.mjs, and is copied
//                       in from that repository. The generator skips only the
//                       WRITE — the card on the index, the nav dropdown, the
//                       footer, the 404 list, the sitemap and the neighbours'
//                       previous/next links still come from this entry. Roll
//                       Hippo is the one: it has no site of its own, so
//                       hippoherd.com/rollhippo IS its site, guide and all.
//                       Do not set this and expect `node scripts/build-site.mjs`
//                       to produce the page — nothing here will.
//
//   webApp: true        The hippo IS a web page: website/<slug>/ holds the app
//                       itself, not a page about it. Its card says "Runs in
//                       your browser" instead of a version (there is nothing to
//                       download, so no release to count), and its buttons
//                       open the app and its source instead of "Learn more"
//                       and a release. Always paired with externalSite: the
//                       app is copied in from its own repository. JsonHippo is
//                       the first.

export const OWNER = "jfigge";
export const HERD_COLOR = "#2BC4B0";

// Where a store listing exists, it outranks a raw GitHub asset for the
// platform it covers, so it gets a badge above the download grid.
//
// `?mt=12` is Apple's "this is Mac software" flag and belongs on every one of
// these — without it the link can land on the iOS storefront's idea of the app.
//
// TODO(jason): Chip Hippo's Mac App Store URL. It is published there, but the
// repository does not record the listing URL and it cannot be derived from the
// bundle id — an Apple listing is apps.apple.com/<cc>/app/<slug>/id<numeric>,
// and only App Store Connect knows the numeric. Passing `null` renders NO badge
// at all, and the page prints a sentence saying the app is on the store
// instead: a "Download on the Mac App Store" button that lands somewhere wrong
// is worse than no button.
const MAS = (url) => ({
  store: "mac",
  name: "Mac App Store",
  sub: "Download on the",
  url: url,
});

// The iOS storefront. No `?mt=12` here — that flag is what sends a link to the
// Mac side, and this one has to land on the phone listing. For a phone app the
// listing IS the release: there is no GitHub build to hand anyone, so the card
// on the index links here instead of to a releases page.
const APP_STORE = (url) => ({
  store: "ios",
  name: "App Store",
  sub: "Download on the",
  url: url,
});

export const HERD = [
  {
    slug: "resthippo",
    name: "Rest Hippo",
    color: "#6C5CE7",
    tagline: "REST API client",
    domain: "resthippo.com",
    docs: "https://resthippo.com/docs/",
    stack: "Electron · Vanilla JS",
    license: "Apache-2.0",
    platforms: ["macOS", "Windows", "Linux"],
    status: "released",
    stores: [MAS("https://apps.apple.com/us/app/rest-hippo/id6784875828?mt=12")],

    lead: "A free, offline alternative to Postman and Insomnia. Collections are plain files on your disk, HTTP runs outside the browser so nothing is subject to CORS, and there is no account to make.",

    blurb:
      "Rest Hippo is a desktop API client that never phones home. Send a request the moment it installs — no sign-in, no workspace to create, no cloud sync waiting to be configured. Requests run natively in the main process rather than in a renderer, so <strong>CORS never applies</strong> and the response you see is the response the server sent. Collections, environments and history are files in a directory you choose, which means they diff, they back up, and they go in git if you want them to.",

    features: [
      {
        icon: "send",
        title: "Every method, every body",
        body: "GET through PATCH, JSON, form and raw bodies, file uploads, and full control of headers and query parameters — with a response viewer that pretty-prints, searches, and renders images inline.",
      },
      {
        icon: "folder",
        title: "Collections in plain files",
        body: "A tree of requests you can favourite, reorder, and search. Everything is stored as readable files on disk, so a collection is something you can commit, diff, and hand to someone else.",
      },
      {
        icon: "layers",
        title: "Variables & environments",
        body: "Collection and environment variables with typeahead, so <code>{{baseUrl}}</code> resolves per environment and switching from staging to production is one dropdown, not a find-and-replace.",
      },
      {
        icon: "code",
        title: "GraphQL & WebSocket",
        body: "A validated GraphQL editor with schema introspection, and a WebSocket client that holds a connection open and logs the traffic in both directions.",
      },
      {
        icon: "shield",
        title: "Auth that works",
        body: "Bearer tokens, basic auth, API keys, and a real OAuth 2 flow that completes the round trip and stores the result with the request rather than in your clipboard.",
      },
      {
        icon: "activity",
        title: "Scripts & tests",
        body: "Pre-request and post-response scripting, plus assertions that turn a request into a check you can re-run — with a timeline showing exactly where the time went.",
      },
    ],
  },

  {
    slug: "chiphippo",
    name: "Chip Hippo",
    color: "#2F855A",
    tagline: "TTL breadboard simulator",
    domain: "chiphippo.com",
    docs: "https://chiphippo.com/docs/",
    stack: "Electron · Vanilla JS",
    license: "Apache-2.0",
    platforms: ["macOS", "Windows", "Linux"],
    status: "released",
    stores: [MAS(null)],

    lead: "A desktop playground for 74xx TTL logic. Drop chips on an infinite breadboard, wire them up, hit Run — and watch electricity ripple through every net until the circuit settles.",

    blurb:
      "Chip Hippo is a real bench without the wire mess. Place 74-series chips on an endlessly pannable breadboard desk, wire them with a click, and press Run: the simulator traces power from the supplies, resolves every electrical net, computes each chip's outputs, and ripples the change through until the whole circuit settles. LEDs light, counters count, and feeding a 74LS00 twelve volts still releases the magic smoke — which is, after all, how the real ones behave.",

    features: [
      {
        icon: "grid",
        title: "Infinite breadboard desk",
        body: "A pannable, zoomable workspace. Full 830, Half 400 and Tiny 170 boards drop in and snap together at the power rails, exactly like the real things do.",
      },
      {
        icon: "chip",
        title: "50+ 74xx chips",
        body: "Gates, flip-flops, counters, decoders, multiplexers, shift registers, comparators and bus drivers — a data-driven catalog with datasheet-exact pinouts. Adding a chip is adding data.",
      },
      {
        icon: "zap",
        title: "Live simulation",
        body: "Not a truth-table lookup: power is traced from the supplies through every net, and outputs ripple until the circuit reaches a stable state. Switches act live while it runs.",
      },
      {
        icon: "clock",
        title: "Sequential logic & clocking",
        body: "Edge-triggered flip-flops, counters and shift registers step correctly on every edge, driven by a clock source with Run, Pause, single-step and speed control.",
      },
      {
        icon: "database",
        title: "Memory chips",
        body: "Address-indexed ROM, SRAM and EEPROM on wide DIP packages. Drive the address bus and the stored byte appears on the data pins; write it back on a <code>/WE</code> pulse.",
      },
      {
        icon: "search",
        title: "Net probe & logic analyzer",
        body: "Hover any hole to light up its entire electrical net across every board and wire, with a live readout of what is connected and what level it is carrying.",
      },
    ],
  },

  {
    slug: "jumphippo",
    name: "Jump Hippo",
    color: "#4785F0",
    tagline: "On-demand SSH tunnels",
    domain: "jumphippo.com",
    docs: "https://jumphippo.com/docs/",
    stack: "Electron · Vanilla JS",
    license: "Apache-2.0",
    platforms: ["macOS", "Windows", "Linux"],
    status: "released",
    stores: [],

    lead: "Bind a local port and the SSH tunnel opens the moment something touches it — through a chain of jump hosts if you need one — then tears itself down once the port goes idle.",

    blurb:
      "Jump Hippo turns an SSH tunnel into something you stop thinking about. Bind a local port; the tunnel is <strong>not</strong> opened until something actually connects to it, and it closes again once traffic stops. The local listener stays bound the whole time, so the next connection simply re-opens it. It lives in the system tray, reaches destinations several hops away through jump-host chains, holds credentials encrypted at rest, and never phones home.",

    features: [
      {
        icon: "zap",
        title: "Tunnels that open themselves",
        body: "Connect lazily on first access and idle out on a timer you set. The listener never goes away, so nothing in your workflow has to know a tunnel was ever closed.",
      },
      {
        icon: "network",
        title: "Jump-host chains",
        body: "Reach a destination several SSH hops away by describing the chain once. Each hop is authenticated on its own terms.",
      },
      {
        icon: "key",
        title: "Flexible authentication",
        body: "SSH agent, private keys with passphrases, or passwords — stored encrypted at rest, never in a plaintext config file beside the app.",
      },
      {
        icon: "shield",
        title: "Host-key verification",
        body: "Trust on first use with an explicit prompt, and a changed host key is refused rather than shrugged at. The check that protects the tunnel is not optional.",
      },
      {
        icon: "activity",
        title: "Live monitoring",
        body: "Per-tunnel state, byte rates and connection counts, in a card view or a sortable list — so a tunnel that is quietly failing looks different from one that is quietly idle.",
      },
      {
        icon: "offline",
        title: "Nothing leaves the machine",
        body: "No telemetry, no account, no update beacon. The only network traffic Jump Hippo makes is the SSH you asked it for.",
      },
    ],
  },

  {
    slug: "keephippo",
    name: "Keep Hippo",
    color: "#F5A623",
    tagline: "Vault-compatible secrets manager",
    domain: "keephippo.com",
    docs: "https://keephippo.com/docs/",
    stack: "Go · single binary",
    license: "MPL-2.0",
    platforms: ["macOS", "Linux", "Windows"],
    status: "prerelease",
    stores: [],

    lead: "A from-scratch secrets manager that speaks HashiCorp Vault's HTTP API, so the Vault clients you already have keep working. Server, CLI and web console in one Go binary.",

    blurb:
      "Keep Hippo replicates Vault's <strong>wire protocol</strong>, not just its ideas: the <code>/v1/</code> path model, the <code>X-Vault-Token</code> header, port 8200, and the <code>VAULT_ADDR</code> and <code>VAULT_TOKEN</code> environment variables. Point the real <code>vault</code> CLI at it and the commands work. Underneath is a first-party implementation of the parts that matter — a sealed storage barrier, Shamir unseal, secrets engines, auth methods, ACL policies, tokens and leases — shipped as a single Go binary with its own console and its own branding.",

    callout: {
      title: "Not audited",
      body: 'Keep Hippo is an educational implementation of a secrets manager and has <strong>not</strong> undergone a security audit. Do not use it to protect real secrets until a release says otherwise — see <a href="https://github.com/jfigge/keephippo/blob/main/SECURITY.md" rel="noopener noreferrer">SECURITY.md</a>.',
    },

    features: [
      {
        icon: "terminal",
        title: "Vault CLI parity",
        body: "Every verb, <code>--format=json</code> included. Scripts written against <code>vault</code> run against <code>keephippo</code> without a diff.",
      },
      {
        icon: "lock",
        title: "Barrier & Shamir seal",
        body: "Storage sits behind an encrypted barrier that starts sealed. Unsealing takes a threshold of key shares, exactly as it should.",
      },
      {
        icon: "database",
        title: "KV v1 and v2",
        body: "Both engines, with versioning, soft delete and check-and-set on v2 — mounted at whatever path you choose.",
      },
      {
        icon: "key",
        title: "Auth methods",
        body: "Token, userpass and approle, with the full token lifecycle: creation, renewal, revocation and orphaning.",
      },
      {
        icon: "shield",
        title: "ACL policies",
        body: "Path-based policies with capability lists, attached to tokens at login and enforced on every request.",
      },
      {
        icon: "clock",
        title: "Leases & transit",
        body: "A real expiration manager that revokes on schedule, plus a transit engine for encryption-as-a-service against named keys.",
      },
    ],
  },

  {
    slug: "mazehippo",
    name: "Maze Hippo",
    // Hue 310, which was the only gap left in the herd's one-colour-per-app
    // system between Rest at 246 and Roll at 351. Written down in three places
    // in jfigge/mazehippo as well — the icon tool, the SVG of record and
    // Android's adaptive-icon background resource — and in make-marks.mjs
    // beside this. That repository is the authority; this copies it.
    color: "#CA2BAF",
    tagline: "Tap-to-clear arrow puzzle",

    // Maze Hippo has no site of its own and is not getting one: the page at
    // hippoherd.com/mazehippo IS its site, which is why this generator does
    // not write it. The files live in jfigge/mazehippo under website/ and
    // arrive here by `make site` in that repository. Everything else about
    // this entry still does its job — the card on the index, the nav
    // dropdown, the footer, the 404 list and the previous/next links are all
    // generated from it as usual.
    //
    // `domain` stays null even though the hippo has a website, because what
    // `domain` drives is the "it has a home of its own" section and the live
    // iframe preview — and pointing those at hippoherd.com/mazehippo would
    // embed this site inside itself. Same reasoning as Roll Hippo's entry.
    externalSite: true,

    domain: null,
    docs: null,
    stack: "Flutter · Dart",
    license: "Apache-2.0",
    platforms: ["iOS", "Android"],
    // "development" rather than "planned": the game is written — a hundred
    // levels, both platforms, tests green — and what is outstanding is the
    // App Store listing rather than the app. "Planned" reads as not started.
    // Not "prerelease" either, which in STATUS_LABEL sits beside `shipped()`
    // and means there is something to download; there are no releases on the
    // repo, so that would point at a grid with nothing in it.
    status: "development",
    stores: [],

    lead: "A small tap-to-clear puzzle, built mostly for the fun of building it. Tap an arrow and it threads itself off the board — unless something is in the way. A hundred levels, three lives, and no advertising anywhere in it.",

    blurb:
      "Maze Hippo is a grid of dots with arrows wound through it, and one rule: tap an arrow and it threads itself off the board the way it points, or it runs into another arrow's body, stops, turns red and costs one of three lives. It exists because the version of this on the app stores is usually buried in advertising — so this one has <strong>no ads, no accounts, no analytics and no network connection at all</strong>. The interesting part is underneath: there is no level data in it and no solver, because every level is computed from its number and generated along its own solution.",

    callout: {
      title: "You can never be stuck, and that is a theorem",
      body: 'Removing an arrow can only ever free others, so an arrow that is free stays free. Whatever order the player taps in, the latest-placed arrow still standing was free when it was placed onto a board holding <em>more</em> than the one in front of them — so it is free now. <strong>There is always a legal move</strong>, a life is only ever lost to a wrong tap, and the game needs no undo button to be fair.',
    },

    features: [
      {
        icon: "zap",
        title: "One rule, and it is visible",
        body: "An arrow moves like a snake: the head steps and the body threads up behind it along the line the head already took. So whether it can leave depends on one straight line of dots and nothing else — its own bends cost it nothing — and the thing to check before tapping is a thing you can actually see.",
      },
      {
        icon: "grid",
        title: "No level data, and no solver",
        body: "All hundred levels are computed from their number in a few milliseconds on the phone. Arrows are placed one at a time with a clear run to the edge, which makes <em>the reverse of the placement order a solution</em> — the level is generated along its own answer, so an unfinishable one is not something the generator can produce.",
      },
      {
        icon: "layers",
        title: "Difficulty is one number",
        body: "Not size, but how many arrows can leave at once: at four there is nearly always an obvious move, at one there is never a choice. Ten levels at four, fifteen at three, twenty at two, and the last fifty-five at one.",
      },
      {
        icon: "heart",
        title: "Three lives, and a clock that waits",
        body: "A wrong tap costs a life and leaves the board exactly as it was. The clock starts when you first touch an arrow rather than when the level appears — a board is read before it is played, and on a hard one for a good while.",
      },
      {
        icon: "activity",
        title: "A bed that does not repeat",
        body: "Two synthesised loops, one of 97 seconds and one of 71. They share no factors, so the pair line up again only every hour and fifty-five minutes — two files under half a megabyte doing the work of a generative engine.",
      },
      {
        icon: "offline",
        title: "Nothing leaves the phone",
        body: "No account, no network call, no telemetry, no advertising identifier, and no permission prompt of any kind. The Android package ships without the <code>INTERNET</code> permission, so the OS itself would refuse a connection the game tried to open.",
      },
    ],
  },

  {
    slug: "mindhippo",
    name: "Mind Hippo",
    // Go's own brand cyan. Mind Hippo is pure Go against the standard library
    // with no framework under it, so the language IS the identity here in a
    // way it is not for Keep Hippo (also Go, but amber — what that one is
    // about is Vault compatibility, not the language it happens to be in).
    color: "#00ADD8",
    tagline: "ML runtime, from scratch",
    domain: null,
    docs: null,
    stack: "Go · no dependencies",
    license: "Apache-2.0",
    platforms: ["macOS", "Linux", "Windows"],
    status: "development",
    stores: [],

    lead: "Tensors, autodiff, neural networks and an inference server — written in pure Go against the standard library. No framework, no GPU, no cgo, and no hosted model behind any of it.",

    blurb:
      "Mind Hippo is a machine-learning runtime with nothing underneath it. Every tensor operation, every derivative, every layer, every optimiser is first-party code written against the Go standard library — no PyTorch, no TensorFlow, no BLAS binding, no cgo, and <strong>no model provider anywhere in it</strong>. It trains its own small models on a laptop CPU and serves them over HTTP with an embedded console: draw a digit with the mouse and watch the network decide what it is. When it answers <em>“that's a 7”</em>, you can follow the arithmetic that produced the answer all the way down — through the softmax, through the matrix multiplications, to the 784 pixel values you drew.",

    callout: {
      title: "In development",
      body: "Mind Hippo is being built in stages and has no tagged release yet. The point is not to beat anyone's benchmark — it will be slower than PyTorch by a wide margin, on purpose. Clarity is the design goal.",
    },

    features: [
      {
        icon: "layers",
        title: "Tensors & autodiff",
        body: "An n-dimensional array type with broadcasting, and reverse-mode automatic differentiation built on it — the graph, the backward pass, and the chain rule, written out.",
      },
      {
        icon: "network",
        title: "Networks & optimisers",
        body: "Dense layers, activations, losses and the optimisers that train them, composed the way the maths composes rather than the way a framework's API does.",
      },
      {
        icon: "cpu",
        title: "CPU only, on purpose",
        body: "No GPU and no accelerator. Models small enough to train on a laptop are models small enough to understand, which is the entire argument.",
      },
      {
        icon: "eye",
        title: "Inference server & console",
        body: "Trained models are served over HTTP with an embedded web console. Draw a digit; watch the probabilities move as you draw it.",
      },
      {
        icon: "search",
        title: "Nothing hidden",
        body: "No hosted model is called at any point. Whatever it answers, it computed — and the computation is in the repository.",
      },
      {
        icon: "book",
        title: "Honest about the limits",
        body: "The small transformer produces text that is grammatically shaped and semantically thin, and the docs show real, unretouched samples of exactly that.",
      },
    ],
  },

  {
    slug: "rollhippo",
    name: "Roll Hippo",
    color: "#D7263D",
    tagline: "Shake-to-roll dice tray",

    // Roll Hippo has no site of its own and is not getting one: this page IS
    // its site, which is why it is the only hippo whose page this generator
    // does not write. The file lives in jfigge/rollhippo under website/ and
    // arrives here by `make site` in that repository. Everything else about
    // this entry still does its job — the card on the index, the nav
    // dropdown, the footer, the 404 list and the previous/next links are all
    // generated from it as usual.
    //
    // `domain` stays null even though the hippo now has a website, because
    // what `domain` drives is the "it has a home of its own" section and the
    // live iframe preview — and pointing those at hippoherd.com/rollhippo
    // would embed this site inside itself.
    externalSite: true,

    domain: null,
    docs: "https://hippoherd.com/rollhippo/docs/",
    stack: "Flutter · Dart",
    license: "Apache-2.0",
    platforms: ["iOS", "Android"],
    status: "released",
    // On the App Store since August 2026. Google Play has no listing yet; add
    // its entry here when it does, not before — a badge that lands on a store
    // search is worse than no badge.
    stores: [APP_STORE("https://apps.apple.com/us/app/roll-hippo/id6798933169")],

    lead: "The herd's first mobile app. Set your dice up once, and after that the phone is the tray — hold it upright, shake it, set it down, read the result.",

    blurb:
      "Roll Hippo is a dice tray for tabletop play, and the interaction is deliberately physical: you build your set of dice once on the picker, and from then on the phone <em>is</em> the tray. Hold it upright, shake, set it down. The dice tumble on a 60fps accelerometer-driven rigid-body simulation and settle where they settle. No account, no network call, no analytics, no ads — it works with the SIM removed, and the tray shows nothing but dice.",

    callout: {
      title: "The number is landed on, not chosen",
      body: 'Roll Hippo does not pick a result and animate towards it. Each die is thrown with a uniformly random orientation and speed, it tumbles as a rigid body, and the value you read is read <strong>off that die\'s own orientation</strong> once it has stopped — the face that finished pointing up, or, on the D4, the face it came to rest on. Every solid is isohedral and each one\'s inertia tensor is computed from its own geometry rather than copied from a table, because a die whose inertia is wrong is a loaded die.',
    },

    features: [
      {
        icon: "move",
        title: "Shake to roll",
        body: "The accelerometer and gyroscope drive a real rigid-body simulation at 60fps, in the phone's own frame of reference — so tilting pours the dice down the screen and a wrist flick turns into a tumble rather than a slide. No shake threshold, no gesture to learn.",
      },
      {
        icon: "dice",
        title: "Six solids, ten dice, your colours",
        body: "D4 through D20, each a real polyhedron whose faces, numbering, volume and inertia are found from its vertices. Ten in the tray at once in any mixture, each picked out in a colour of its own.",
      },
      {
        icon: "layers",
        title: "Three sets, kept apart",
        body: "Up to three separate groups, swiped between. A group you are not looking at is not simulated at all, so the numbers it rolled stay the numbers it rolled — a swipe cannot shake them.",
      },
      {
        icon: "shuffle",
        title: "The same dice, dealt as cards",
        body: "A shoe holding every <em>ordered</em> outcome of your dice, because 1-2 and 2-1 are two ways for a pair to land and a deck holding each pair once would quietly halve the odds of every double. Cut it where you like.",
      },
      {
        icon: "grid",
        title: "Saved set-ups, shared as a square",
        body: "Keep the games you actually play under names you choose. A profile turns into a QR code carrying the whole thing — every die, its kind and colour, the mode and the shoe — so the next player points a camera at your screen and has it too.",
      },
      {
        icon: "offline",
        title: "Completely offline",
        body: "No account, no network call, no telemetry. The camera is used for one thing, reading a QR code you point it at, and nothing is stored or sent. Prefer the dice without the shaking? Motion control switches off and the buttons are the whole interface.",
      },
    ],
  },
  {
    slug: "scanhippo",
    name: "Scan Hippo",
    // Hue 94, chosen the way Maze's was: the midpoint of the widest arc no
    // hippo occupies. Keep sits at 37 and Chip at 150, and that 113-degree gap
    // is the largest on the wheel by a factor of two — so this green-yellow is
    // as far from every sibling as a new colour can get, and it clears Chip's
    // blue-green by 56 degrees. It must stay in step with the same value in
    // scripts/make-marks.mjs: that one paints the mark, this one paints the
    // page the mark sits on.
    color: "#61B422",
    tagline: "OBD-II tester on a salvaged connector",

    // Scan Hippo has no site of its own and is not getting one: the page at
    // website/scanhippo IS its site, which is why this generator does not
    // write it. The file lives in jfigge/scanhippo under website/ and arrives
    // here by `make site` in that repository. Everything else about this entry
    // still does its job — the card on the index, the nav dropdown, the
    // footer, the 404 list and the previous/next links are all generated from
    // it as usual.
    //
    // `domain` stays null for the reason Roll Hippo's does: what `domain`
    // drives is the "it has a home of its own" section and the live iframe
    // preview, and pointing those at hippoherd.com/scanhippo would embed this
    // site inside itself.
    externalSite: true,

    domain: null,
    docs: null,
    stack: "Arduino · C++ · MCP2515",
    license: "Apache-2.0",
    platforms: ["Arduino Nano ESP32"],
    status: "development",

    // No stores, and this empty array is not waiting on a review queue the way
    // Roll Hippo's once was. The phone app is not going to be published: the
    // hardware half only exists on one car, so there is nothing an installed
    // app could usefully talk to. See the "Not a product" section on its page.
    stores: [],

    lead: "An OBD-II tester built on the connector a dead Subaru StarLink module left behind. An Arduino Nano ESP32 on the car's CAN bus, speaking ISO 15765-4 — and the story of the repair that produced it.",

    blurb:
      "A 2016 Outback's StarLink module outlived the 3G network it needed, and scanned for it until the battery went flat. Removing the head unit that had been silencing it broke the stereo as well, because the module sits <em>inline</em> in the front speaker and microphone paths. Fixing that meant desoldering the module's connector — and the half left over carried two CAN buses, three power rails, two buttons and two LEDs, already wired into the dash. Scan Hippo is what got built on it.",

    callout: {
      title: "Every command is a transaction, not a frame fired into the dark",
      body: 'Each request carries a reply and a deadline, so an unplugged node reads as <strong>no response</strong> rather than looking identical to success. Eight independent reassembly channels — one per possible ECU — keep two segmented replies to the same broadcast from splicing into nonsense, and the MCP2515\'s acceptance filters are set up correctly rather than left in the state where asking for a mask of <code>0x7FF</code> quietly writes a mask of zero.',
    },

    features: [
      {
        icon: "activity",
        title: "Standard ISO 15765-4",
        body: "500 kbit/s, 11-bit identifiers, every frame padded to DLC 8 — so nothing changes between the bench and the driveway. <code>0x7DF</code> reaches every ECU, <code>0x7E0</code>+n addresses one, <code>0x7E8</code>+n is how it answers.",
      },
      {
        icon: "layers",
        title: "ISO-TP done properly",
        body: "Segmented transfers with flow control, block size and STmin pacing, and the timeout paths that matter when a node stops answering half-way through a reply.",
      },
      {
        icon: "network",
        title: "Eight reassembly channels",
        body: "One per possible ECU. A single broadcast can put two segmented replies on the wire at once, and one shared buffer would interleave them into something that parses but is not true.",
      },
      {
        icon: "shield",
        title: "Filters that actually filter",
        body: "Three separate traps in the MCP2515 driver make acceptance filters fail <em>silently</em>, including one where the obvious call accepts every frame on the bus. All three are handled in one place, and written down.",
      },
      {
        icon: "terminal",
        title: "126 checks, no hardware",
        body: "Frame bytes, pacing, timeouts, DTC and PID codecs and the filter register encoding — plus an integration suite that compiles the three real sketches unmodified and runs them against each other on a simulated bus.",
      },
      {
        icon: "phone",
        title: "A seam where the app goes",
        body: "Everything the tester prints goes through a single <code>Print *</code>, so moving the console to a Bluetooth LE characteristic is a one-line change. The app is not built yet, and is not going to a store when it is.",
      },
    ],
  },
  {
    slug: "jsonhippo",
    name: "JsonHippo",
    // Hue 276, found the way Maze's and Scan's were: the midpoint of the
    // widest arc still free once Scan took 94 — the 64 degrees between Rest at
    // 246 and Maze at 310. Readable as accent text on #1c1c1c (4.69:1) with the
    // white hippo still clear on top of it (3.63:1). It must stay in step with
    // the same value in scripts/make-marks.mjs: that one paints the mark, this
    // one paints the page the mark sits on.
    color: "#B65CF0",
    tagline: "JSON viewer with pinpoint errors",

    // JsonHippo is a static web app, and hippoherd.com/jsonhippo/ is where it
    // runs: the index card is its advertisement, and clicking it opens the app
    // itself, not a page about it. The files are built in jfigge/jsonhippo and
    // arrive here by `make site` in that repository (an rsync --delete of its
    // dist/), which is why the generator must never write this directory.
    // Everything else about this entry still does its job: the card, the nav
    // dropdown, the footer, the 404 list, the sitemap and the previous/next
    // links — all of which now lead straight into the app.
    externalSite: true,
    webApp: true,

    // `domain` stays null: the app's home IS this site. If jsonhippo.com is
    // bought later, set it here and add the host to ALLOWED in
    // website/preview.js.
    domain: null,
    docs: null,
    stack: "HTML · vanilla JS · jQuery",
    license: "Apache-2.0",
    platforms: ["Any modern browser"],
    // Live at hippoherd.com/jsonhippo/. A web app has no GitHub release to
    // track; with webApp set, "released" only means "no status chip".
    status: "released",
    stores: [],

    lead: "Pinpoint errors for JSON that will not parse — line, column, what was expected and the path to it — plus smart paste of escaped JSON and a tree you can filter. A static page: nothing is uploaded.",

    blurb:
      "“Invalid JSON” is useless when the input is five megabytes long. JsonHippo's tokenizer and parser are written by hand, character by character, so when a document fails it says <em>where</em>: <code>Line 123982, col 9: expected ',' or '}' but found string \"zip\" (in $.people[4321].address)</code> — and one click puts the caret on the bad character. It also recognises the JSON that APIs and logs hand back as an escaped string and unescapes it on paste, and its tree can be filtered by key, value, regex or path. Inspired by jsonviewer.stack.hu, which its author has used for years.",

    features: [
      {
        icon: "alert",
        title: "Says where it broke",
        body: "Line, column, expected and found, and the JSON path — for every one of seventeen error codes. A file missing its last <code>}</code> points at the brace that never closed, not at the end of the file.",
      },
      {
        icon: "code",
        title: "Smart paste",
        body: "Escaped JSON — <code>\"{\\\"id\\\":7}\"</code> — is unescaped on paste, as many times as it was escaped, with an Undo. Ordinary JSON with escaped quotes inside its strings is never touched.",
      },
      {
        icon: "search",
        title: "A tree you can filter",
        body: "Narrow the tree to the keys or values that match — plain text, regex, or a path like <code>$.items[*].name</code> — with each match's ancestors kept so you can see where it sits.",
      },
      {
        icon: "layers",
        title: "Built for big files",
        body: "A 5 MB document parses in under a tenth of a second; the tree draws only what is open; the filter searches every node, drawn or not.",
      },
      {
        icon: "terminal",
        title: "Every digit kept",
        body: "Format and minify are written from the parse tree, so <code>12345678901234567890</code> keeps its digits and keys keep their order, duplicates included and flagged.",
      },
      {
        icon: "lock",
        title: "Nothing leaves the browser",
        body: "No server, no account, no tracking. Files are read locally and never uploaded.",
      },
    ],
  },
];

export const BY_SLUG = Object.fromEntries(HERD.map((h) => [h.slug, h]));
