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
    domain: null,
    docs: null,
    stack: "Flutter · Dart",
    license: "Apache-2.0",
    platforms: ["iOS", "Android"],
    status: "planned",
    stores: [],

    lead: "The herd's first mobile app. Set your dice up once, and after that the phone is the tray — hold it upright, shake it, set it down, read the result.",

    blurb:
      "Roll Hippo is a dice tray for tabletop play, and the interaction is deliberately physical: you build your dice groups once on the Setup screen, and from then on the phone <em>is</em> the tray. Hold it upright, shake, set it down. The dice tumble on a 60fps accelerometer-driven rigid-body simulation and settle where they settle. Two screens, no account, no network call, no analytics, no ads — it works with the SIM removed, and the tray shows nothing but dice.",

    callout: {
      title: "The honesty rule",
      body: "The tumbling is <strong>presentation</strong>. The values are drawn from a uniform random number generator at settle time and are never derived from the physics state. A dice app that is coy about its randomness has no business asking for your trust, so this is said in the app, the guide, and here.",
    },

    features: [
      {
        icon: "move",
        title: "Shake to roll",
        body: "The accelerometer drives a real rigid-body simulation at 60fps. Hold the phone upright, shake it, and set it down — no button, no gesture to learn.",
      },
      {
        icon: "dice",
        title: "Dice groups, set once",
        body: "Build the sets you actually roll on the Setup screen. The tray then holds exactly those, and nothing else: no log, no running total, no re-roll button.",
      },
      {
        icon: "phone",
        title: "One codebase, both stores",
        body: "Flutter and Dart, shipping to the App Store and Google Play from a single source tree — the family's first mobile application.",
      },
      {
        icon: "offline",
        title: "Completely offline",
        body: "No account, no network call, no telemetry. Nothing the app knows about you ever leaves the device, because nothing ever leaves the device.",
      },
      {
        icon: "shuffle",
        title: "Honest randomness",
        body: "Values come from a uniform RNG at settle time. The simulation decides how the dice look, never what they say.",
      },
      {
        icon: "shield",
        title: "Not a gambling app",
        body: "A utility that produces uniform random integers with a physical interaction. No wagering, no casino, no simulated stakes.",
      },
    ],
  },
];

export const BY_SLUG = Object.fromEntries(HERD.map((h) => [h.slug, h]));
