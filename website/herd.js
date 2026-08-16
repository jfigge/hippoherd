/* Hippo Herd — platform detection and download wiring.
 *
 * Progressive enhancement, throughout. Every page ships static markup that
 * works with this script blocked: the download rows fall back to "Latest
 * release on GitHub", the version numbers read as an em-dash, and the
 * detected-platform strip stays hidden. Nothing below removes a working link
 * to replace it with a broken one — a renderer that produces nothing leaves
 * what was already there.
 *
 * Data comes from ./versions.json, generated at deploy time from the GitHub
 * Releases API for all seven repos at once (scripts/build-versions.mjs). The
 * browser never talks to api.github.com: seven unauthenticated calls per page
 * load would spend a third of a visitor's 60/hr rate limit, shared across
 * every site they visit that day, to render a download button.
 */
(function () {
  "use strict";

  // ── The herd ──────────────────────────────────────────────────────────────
  //
  // Only what the SCRIPT needs. Everything a reader needs — the blurbs, the
  // features, the taglines — is in the HTML, where it is visible to a visitor
  // with JS off and to a crawler that never runs it.
  var HIPPOS = {
    resthippo: { name: "Rest Hippo", desktop: true },
    chiphippo: { name: "Chip Hippo", desktop: true },
    jumphippo: { name: "Jump Hippo", desktop: true },
    keephippo: { name: "Keep Hippo", desktop: true },
    mazehippo: { name: "Maze Hippo", desktop: false }, // iOS / Android
    mindhippo: { name: "Mind Hippo", desktop: true },
    rollhippo: { name: "Roll Hippo", desktop: false }, // iOS / Android
  };

  var DL_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  // ── Small helpers ─────────────────────────────────────────────────────────

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return [].slice.call((root || document).querySelectorAll(sel));
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function mb(bytes) {
    return bytes || bytes === 0 ? (bytes / 1048576).toFixed(1) + " MB" : "";
  }

  // versions.json is generated in trusted CI, but never navigate to a URL it
  // didn't expect: constrain every href to a GitHub-owned https host, falling
  // back to the repo's releases page if anything looks off (a tampered
  // manifest, a javascript: URL, an unexpected host).
  function safeUrl(u, fallback) {
    try {
      var p = new URL(u, location.href);
      if (p.protocol !== "https:") return fallback;
      var h = p.hostname.toLowerCase();
      var ok =
        h === "github.com" ||
        h === "objects.githubusercontent.com" ||
        h.endsWith(".github.com") ||
        h.endsWith(".githubusercontent.com");
      return ok ? p.href : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // ── Platform detection ────────────────────────────────────────────────────
  //
  // Two sources, in order of how much they actually know:
  //
  // 1. navigator.userAgentData.getHighEntropyValues — Chromium only, but it
  //    answers the architecture question DIRECTLY and correctly, including the
  //    one that matters most: Apple Silicon versus Intel on macOS, which the
  //    user-agent string has never distinguished and never will (Apple froze
  //    it at "Intel Mac OS X" on purpose).
  //
  // 2. The user-agent string, plus one WebGL probe. Safari and Firefox on
  //    macOS reach here, and for them the GPU renderer string is the only
  //    signal available: an Apple Silicon Mac reports a renderer containing
  //    "Apple", an Intel one reports Intel or AMD. It is a heuristic and it is
  //    labelled as one — see `exact` below.
  //
  // `exact` is the honest part of this. When it is false the page still offers
  // a one-click download, but it says "we think" rather than "you are", and
  // the full per-architecture list sits right underneath, unhidden. Guessing
  // silently is how someone ends up with an x64 build on an M3.
  function detect() {
    var uad = navigator.userAgentData;
    if (uad && typeof uad.getHighEntropyValues === "function") {
      return uad
        .getHighEntropyValues(["platform", "architecture", "bitness"])
        .then(function (v) {
          var os = osFromName(v.platform) || osFromUA();
          if (!os) return null;
          var arch = null;
          if (v.architecture === "arm") {
            arch = v.bitness === "32" ? "armv7l" : "arm64";
          } else if (v.architecture === "x86") {
            arch = v.bitness === "32" ? "ia32" : "x64";
          }
          return arch ? { os: os, arch: arch, exact: true } : guess();
        })
        .catch(guess);
    }
    return Promise.resolve(guess());
  }

  function osFromName(name) {
    var n = String(name || "").toLowerCase();
    if (n.indexOf("mac") === 0) return "mac";
    if (n.indexOf("win") === 0) return "win";
    if (n === "android") return "android";
    if (n.indexOf("linux") === 0 || n === "chrome os" || n === "chromium os") {
      return "linux";
    }
    return null;
  }

  function osFromUA() {
    var ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; the touch-point count is what gives it
    // away, and getting this wrong would offer a .dmg to an iPad.
    if (/iPhone|iPod/.test(ua)) return "ios";
    if (/iPad/.test(ua)) return "ios";
    if (/Macintosh|Mac OS X/.test(ua)) {
      return navigator.maxTouchPoints > 2 ? "ios" : "mac";
    }
    if (/Android/.test(ua)) return "android";
    if (/Windows/.test(ua)) return "win";
    if (/Linux|X11|CrOS/.test(ua)) return "linux";
    return null;
  }

  function guess() {
    var os = osFromUA();
    if (!os) return null;
    var ua = navigator.userAgent;
    var arch = null;
    var exact = false;

    if (os === "mac") {
      arch = appleSilicon() ? "arm64" : "x64";
    } else if (/aarch64|arm64/i.test(ua)) {
      arch = "arm64";
    } else if (/armv7|armhf|\barm\b/i.test(ua)) {
      arch = "armv7l";
    } else if (os === "win" || os === "linux") {
      // Not read off anything — it is what all but a rounding error of desktop
      // Windows and Linux run, and the alternative is offering no button at
      // all to the majority of visitors. Flagged inexact, which is what puts
      // the "not right?" escape hatch beside it.
      arch = "x64";
    }
    return { os: os, arch: arch, exact: exact };
  }

  // The GPU is the tell. On Apple Silicon every renderer string names Apple
  // ("Apple GPU" in Safari, "ANGLE (Apple, ANGLE Metal Renderer: Apple M2…)"
  // in Chromium); on an Intel Mac it names Intel, AMD or NVIDIA. The context
  // is created and immediately discarded.
  function appleSilicon() {
    try {
      var c = document.createElement("canvas");
      var gl =
        c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return false;
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      var r = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      var lost = gl.getExtension("WEBGL_lose_context");
      if (lost) lost.loseContext();
      return /apple/i.test(String(r || ""));
    } catch (e) {
      return false;
    }
  }

  var OS_NAMES = {
    mac: "macOS",
    win: "Windows",
    linux: "Linux",
    ios: "iOS",
    android: "Android",
  };

  var ARCH_NAMES = {
    arm64: "Apple Silicon",
    x64: "Intel",
    ia32: "32-bit",
    armv7l: "ARM 32-bit",
    universal: "Universal",
  };

  // The same architecture is called different things on different platforms,
  // and calling an x64 Windows machine "Intel" is only right by accident —
  // half of them are AMD.
  function archName(os, arch) {
    if (!arch) return "";
    if (os === "mac") return ARCH_NAMES[arch] || arch;
    if (arch === "arm64") return "ARM64";
    if (arch === "x64") return "64-bit";
    return ARCH_NAMES[arch] || arch;
  }

  function platformLabel(p) {
    if (!p || !p.os) return "";
    var a = archName(p.os, p.arch);
    return OS_NAMES[p.os] + (a ? " · " + a : "");
  }

  // ── Choosing the one-click asset ──────────────────────────────────────────

  // Recommended installer first, archives last — the same order the sibling
  // sites use, and the reason the big button never lands on a loose .zip when
  // a .dmg for the same machine is sitting beside it.
  var KIND_RANK = {
    dmg: 0,
    pkg: 0,
    exe: 0,
    msi: 0,
    appimage: 0,
    deb: 1,
    rpm: 1,
    snap: 1,
    tarball: 2,
    portable: 3,
    zip: 4,
  };

  function rank(kind) {
    return KIND_RANK[kind] != null ? KIND_RANK[kind] : 9;
  }

  function byPreferred(a, b) {
    return rank(a.kind) - rank(b.kind);
  }

  // The best asset for a platform, or null. An exact architecture match wins;
  // a universal build is accepted for any architecture on the same OS, because
  // that is what universal means. Nothing else is substituted — handing an
  // arm64 machine an x64 build because it was the only one left is precisely
  // the failure this whole file exists to avoid.
  function pick(assets, p) {
    if (!p || !p.os) return null;
    var mine = assets.filter(function (a) {
      return a.platform === p.os;
    });
    if (!mine.length) return null;

    var exact = mine.filter(function (a) {
      return a.arch === p.arch;
    });
    var universal = mine.filter(function (a) {
      return a.arch === "universal";
    });

    var pool = exact.length ? exact : universal;
    if (!pool.length) return null;
    return pool.slice().sort(byPreferred)[0];
  }

  // ── Rendering: download rows ──────────────────────────────────────────────

  function row(asset, fallback) {
    var a = el(
      '<a class="dl-row"><span class="dl-icon">' +
        DL_ICON +
        '</span><div class="dl-info"><div class="dl-label"></div><div class="dl-meta"></div></div><span class="dl-arch"></span></a>',
    );
    a.href = safeUrl(asset.url, fallback);
    a.rel = "noopener noreferrer";
    $(".dl-label", a).textContent = asset.label;
    $(".dl-meta", a).textContent =
      asset.name + (asset.size ? " · " + mb(asset.size) : "");
    // build-versions.mjs answers null for an architecture it cannot name
    // rather than guessing one; an empty badge is a styled grey pill with
    // nothing in it, so drop the element instead of printing the absence.
    var badge = $(".dl-arch", a);
    if (asset.arch) badge.textContent = asset.arch;
    else badge.remove();
    return a;
  }

  function sep(text) {
    var d = el('<div class="dl-sep"></div>');
    d.textContent = text;
    return d;
  }

  var INTEL_64 = "Intel / AMD (64-bit)";
  var ARM_64 = "ARM (arm64)";

  // A mac universal build is the ONLY build when it exists, so it leads. The
  // Windows and Linux combined installers are not: they ship beside the
  // per-arch ones and are roughly twice the size because they hold both, so
  // they go last, where they read as the fallback for someone unsure which
  // machine they have rather than as the recommended download.
  var GROUPS = {
    mac: [
      { arch: "universal", label: "Apple Silicon & Intel (universal)" },
      { arch: "arm64", label: "Apple Silicon (M1 / M2 / M3 / M4)" },
      { arch: "x64", label: "Intel" },
    ],
    win: [
      { arch: "x64", label: INTEL_64 },
      { arch: "arm64", label: ARM_64 },
      { arch: "universal", label: "Combined (x64 + ARM)" },
    ],
    linux: [
      { arch: "x64", label: INTEL_64 },
      { arch: "arm64", label: ARM_64 },
      { arch: "universal", label: "Combined (x64 + ARM)" },
    ],
  };

  var OTHER_ARCH = "Other architectures";

  // Anything whose architecture is not named still gets a row, under a generic
  // heading, rather than being dropped: a build the release published and the
  // site silently never offered is the worse failure.
  function renderCard(list, assets, os, fallback) {
    var groups = GROUPS[os] || [];
    var named = function (a) {
      return groups.some(function (g) {
        return g.arch === a.arch;
      });
    };
    var frag = document.createDocumentFragment();
    var placed = 0;

    var emit = function (label, items) {
      if (!items.length) return;
      frag.appendChild(sep(label));
      items.sort(byPreferred).forEach(function (a) {
        frag.appendChild(row(a, fallback));
        placed++;
      });
    };

    groups.forEach(function (g) {
      emit(
        g.label,
        assets.filter(function (a) {
          return a.arch === g.arch;
        }),
      );
    });
    emit(
      OTHER_ARCH,
      assets.filter(function (a) {
        return !named(a);
      }),
    );

    // Render into a fragment and only swap it in once something came of it.
    // Clearing the card first would destroy the static "Latest release on
    // GitHub" fallback whenever a card's assets all fall outside its groups.
    if (!placed) return;
    list.textContent = "";
    list.appendChild(frag);
  }

  // ── Rendering: the detected-platform strip ────────────────────────────────

  function fillDetected(strip, p, hippo, data) {
    var labelEl = $("[data-detected-label]", strip);
    var btn = $("[data-detected-dl]", strip);
    var note = $("[data-detected-note]", strip);

    if (!p || !p.os) return; // stays hidden — see .detected in site.css
    if (labelEl) labelEl.textContent = platformLabel(p);

    // A phone or tablet. Roll Hippo is the only hippo it could ever run, and
    // it isn't out yet, so say that instead of offering a desktop installer.
    if (p.os === "ios" || p.os === "android") {
      if (btn) btn.remove();
      if (note) {
        note.textContent =
          hippo && !HIPPOS[hippo].desktop
            ? "It isn't in the stores yet — the repo is the place to watch."
            : "The rest of the herd is desktop software; Roll Hippo is the one built for a phone.";
      }
      strip.setAttribute("data-resolved", "true");
      return;
    }

    if (btn) {
      var entry = hippo && data && data.hippos ? data.hippos[hippo] : null;
      var asset = entry ? pick(entry.assets || [], p) : null;
      if (!asset) {
        btn.remove();
        if (note && entry && !entry.latest) {
          note.textContent = "No release yet.";
        } else if (note) {
          note.textContent = "No build published for this machine yet.";
        }
      } else {
        btn.href = safeUrl(asset.url, entry.url);
        btn.rel = "noopener noreferrer";
        var text = $("[data-detected-dl-label]", btn);
        if (text) {
          text.textContent =
            "Download for " + OS_NAMES[p.os] + " · " + asset.label;
        }
      }
    }

    // Say so when the architecture was inferred rather than reported. The full
    // per-architecture list is on the same page either way; this is what tells
    // someone on Safari that it is worth a glance.
    if (note && !note.textContent && !p.exact) {
      note.textContent = "Best guess — the full list is below.";
    }
    strip.setAttribute("data-resolved", "true");
  }

  // ── Rendering: the index cards ────────────────────────────────────────────

  function fillCards(p, data) {
    $$("[data-hippo]").forEach(function (card) {
      var slug = card.getAttribute("data-hippo");
      var entry = data.hippos ? data.hippos[slug] : null;
      if (!entry) return;

      var chip = $("[data-version-chip]", card);
      if (chip) {
        chip.textContent = entry.latest ? "v" + entry.latest : "No release yet";
      }

      var dl = $("[data-card-dl]", card);
      if (!dl) return;

      var asset = pick(entry.assets || [], p);
      var label = $("[data-card-dl-label]", dl);
      if (!asset) {
        // Leave the static markup alone — it already points at the repo's
        // releases page, which is the right destination when there is nothing
        // to hand this particular machine.
        if (!entry.latest) dl.setAttribute("data-empty", "true");
        return;
      }
      dl.href = safeUrl(asset.url, entry.url);
      dl.rel = "noopener noreferrer";
      if (label) {
        label.textContent = "Download for " + OS_NAMES[p.os];
      }
      dl.setAttribute(
        "title",
        asset.name + (asset.size ? " · " + mb(asset.size) : ""),
      );
    });
  }

  // ── Rendering: a hippo page ───────────────────────────────────────────────

  function fillHippoPage(slug, p, data) {
    var entry = data.hippos ? data.hippos[slug] : null;
    if (!entry) return;

    $$("[data-version]").forEach(function (n) {
      n.textContent = entry.latest ? entry.latest : "unreleased";
    });
    $$("[data-version-tag]").forEach(function (n) {
      n.textContent = entry.latest ? "v" + entry.latest : "No release yet";
    });
    $$("[data-release-link]").forEach(function (n) {
      n.href = safeUrl(entry.url, "https://github.com/" + entry.repo);
    });

    var assets = entry.assets || [];
    ["mac", "win", "linux"].forEach(function (os) {
      var list = $('[data-dl-list="' + os + '"]');
      if (!list) return;
      var mine = assets.filter(function (a) {
        return a.platform === os;
      });
      if (mine.length) renderCard(list, mine, os, entry.url);

      var card = list.closest(".os-card");
      if (card && p && p.os === os) card.setAttribute("data-current", "true");
    });
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  //
  // versions.json sits behind a CDN (GitHub Pages / Fastly); a single
  // transient blip would otherwise strand the page on the static fallback.
  // Retry a few times with a short backoff, and let the final attempt accept a
  // cached copy, before giving up.
  //
  // ONLY THE FETCH IS RETRIED. apply() runs after the data has arrived, so a
  // throw in there is not a transient anything — re-fetching would hand the
  // same bad payload to the same code and render it a SECOND time on top of
  // the first attempt's output.
  function load(attempt) {
    return fetch(versionsUrl(), {
      cache: attempt < 3 ? "no-cache" : "force-cache",
    })
      .then(function (r) {
        if (!r.ok) throw new Error("versions.json " + r.status);
        return r.json();
      })
      .catch(function (err) {
        if (attempt < 3) {
          return new Promise(function (resolve) {
            setTimeout(resolve, 300 * (attempt + 1));
          }).then(function () {
            return load(attempt + 1);
          });
        }
        throw err;
      });
  }

  // The hippo pages live one directory down (/chiphippo/), so a relative
  // "versions.json" would resolve to /chiphippo/versions.json and 404 into the
  // static fallback on every page but the index.
  function versionsUrl() {
    return new URL("/versions.json", location.href).href;
  }

  function init() {
    var slug = document.body.getAttribute("data-hippo-page");
    var platform = null;

    detect()
      .then(function (p) {
        platform = p;
        if (p && p.os) {
          document.documentElement.setAttribute("data-os", p.os);
          if (p.arch) document.documentElement.setAttribute("data-arch", p.arch);
        }
        return load(0);
      })
      .then(function (data) {
        if (slug) fillHippoPage(slug, platform, data);
        else fillCards(platform, data);
        $$("[data-detected]").forEach(function (strip) {
          fillDetected(strip, platform, slug, data);
        });
      })
      .catch(function (err) {
        // Whatever landed before the throw stays on screen; everything else
        // keeps the static fallback it shipped with.
        if (window.console && window.console.warn) {
          window.console.warn("versions.json could not be applied", err);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
