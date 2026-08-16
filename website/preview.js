/* Hippo Herd — live site previews.
 *
 * A hippo page shows the hippo's REAL site, in an iframe, drawn at desktop
 * width and scaled down to fit. It reads like a screenshot and can never go
 * stale, because it is not a picture of the site — it is the site.
 *
 * Why an iframe and not a PNG: the alternative is a screenshot per hippo
 * committed here, re-captured by hand every time one of those repositories changes
 * its hero. That is a maintenance debt that gets paid in the form of a herd
 * page showing a version of Rest Hippo that shipped eight months ago.
 *
 * Three things make the embed behave:
 *
 *   - It is INERT. .preview-cover is an anchor covering the whole frame, so a
 *     click goes to the real site and a scroll scrolls THIS page; the iframe
 *     also carries pointer-events:none and its contents are hidden from the
 *     accessibility tree. Nothing inside it is a tab stop, so a keyboard
 *     visitor never falls into a second page's navigation.
 *   - It is LAZY. The frame is only created when it comes near the viewport,
 *     and each one is a whole other website — scripts, fonts, hero images.
 *     Loading it on page load would make a link to chiphippo.com cost as much
 *     as visiting chiphippo.com.
 *   - It is SANDBOXED. allow-scripts because the sibling sites render their
 *     download rows with JS and a preview with a permanent "Latest release on
 *     GitHub" fallback would misrepresent them; allow-same-origin because
 *     WITHOUT it the framed document gets an opaque origin, and every one of
 *     these sites ships a `default-src 'self'` CSP, which under an opaque
 *     origin matches nothing at all — no stylesheet, no image, no script. The
 *     preview would be a page of unstyled text. It grants the frame nothing
 *     against us: same-origin here means the framed site is same-origin with
 *     ITSELF, and it is a different origin from hippoherd.com either way.
 */
(function () {
  "use strict";

  var WIDTH = 1440; // the width the framed site is rendered at

  // Every host this site will ever put in an iframe. Mirrors the frame-src
  // list in each page's Content-Security-Policy; a hippo that gets a site
  // later is added in both places.
  var ALLOWED = [
    "resthippo.com",
    "chiphippo.com",
    "jumphippo.com",
    "keephippo.com",
    "mindhippo.com",
    "rollhippo.com",
  ];

  var previews = [].slice.call(document.querySelectorAll("[data-preview-src]"));
  if (!previews.length) return;

  // The frame is 1440px wide whatever the column is, so the scale is whatever
  // makes it fit. Written as a CSS variable rather than applied directly so
  // the transform stays in the stylesheet with the rest of the geometry.
  function rescale(preview) {
    var viewport = preview.querySelector(".preview-viewport");
    if (!viewport) return;
    var w = viewport.clientWidth;
    if (!w) return;
    viewport.style.setProperty("--preview-scale", w / WIDTH);
  }

  function mount(preview) {
    if (preview.getAttribute("data-preview-loaded")) return;
    preview.setAttribute("data-preview-loaded", "true");

    var viewport = preview.querySelector(".preview-viewport");
    var src = preview.getAttribute("data-preview-src");
    if (!viewport || !src) return;

    // Only ever frame one of our own sites, over https. The attribute is set
    // in our own markup, but this is the single place on the site where a URL
    // becomes a live executing document, so it is checked against a list
    // rather than a pattern — and the same list is what index.html's CSP
    // frame-src names, so the two cannot drift into disagreeing.
    var url;
    try {
      url = new URL(src);
    } catch (e) {
      return;
    }
    if (url.protocol !== "https:" || ALLOWED.indexOf(url.hostname) === -1) {
      return;
    }

    var frame = document.createElement("iframe");
    frame.src = url.href;
    frame.title = preview.getAttribute("data-preview-title") || url.hostname;
    frame.loading = "lazy";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("tabindex", "-1");
    // The cover anchor is the accessible name for this whole region; the
    // framed document must not add a second copy of another site's nav to the
    // reading order.
    frame.setAttribute("aria-hidden", "true");

    var placeholder = preview.querySelector(".preview-placeholder");
    frame.addEventListener("load", function () {
      if (placeholder) placeholder.remove();
      rescale(preview);
    });

    // Insert BEFORE the cover so the cover stays on top without needing a
    // z-index, and before the placeholder is removed so there is never a frame
    // of empty box between the two.
    viewport.insertBefore(frame, viewport.firstChild);
    rescale(preview);
  }

  // Mount when the preview gets within a screen and a half of the viewport.
  // IntersectionObserver is ancient by now, but if it is missing, mount
  // everything rather than showing an empty frame forever.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          mount(e.target);
        });
      },
      { rootMargin: "150% 0px" },
    );
    previews.forEach(function (p) {
      io.observe(p);
    });
  } else {
    previews.forEach(mount);
  }

  // Keep the scale honest through window resizes and orientation changes.
  if ("ResizeObserver" in window) {
    var ro = new ResizeObserver(function (entries) {
      entries.forEach(function (e) {
        var p = e.target.closest("[data-preview-src]");
        if (p) rescale(p);
      });
    });
    previews.forEach(function (p) {
      var v = p.querySelector(".preview-viewport");
      if (v) ro.observe(v);
    });
  } else {
    window.addEventListener("resize", function () {
      previews.forEach(rescale);
    });
  }
})();
