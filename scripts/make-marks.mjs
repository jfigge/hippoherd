#!/usr/bin/env node
/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Hippo Herd.
 *
 * Hippo Herd is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Hippo Herd is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Hippo Herd. If not, see <https://www.gnu.org/licenses/>.
 */

// Generate website/marks/*.svg (the hippos, and ViewHippo's) and
// website/favicon.svg.
//
// The family mark is ONE piece of geometry — two ear circles, a head, a snout,
// two eyes — that every hippo shares; a hippo is that geometry, its own accent
// colour, and one motif on the snout. Those marks already exist, hand-inlined,
// in five separate repositories, and this site needs all seven of them in one
// place. Copying seven hand-written SVGs in here is how the herd's Rest Hippo ends
// up half a pixel from resthippo.com's own, so the geometry is written down once
// and the differences are written down as data.
//
//   node scripts/make-marks.mjs
//
// Re-run after editing HIPPOS. The output is committed; this is not a build
// step the site depends on at deploy time.
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "website/marks";

// The shared body: ears, head, snout. `fill` is applied by the caller's group so
// the same string serves both the white hippo and the teal halo behind it.
const BODY = [
  '<circle cx="170" cy="146" r="40"/>',
  '<circle cx="342" cy="146" r="40"/>',
  '<rect x="144" y="140" width="224" height="190" rx="74"/>',
  '<rect x="118" y="260" width="276" height="150" rx="74"/>',
].join("");

// Two nostrils on the snout — the default motif, and what Rest and Keep use.
const nostrils = (c) =>
  `<ellipse cx="210" cy="330" rx="14" ry="20" fill="${c}"/>` +
  `<ellipse cx="302" cy="330" rx="14" ry="20" fill="${c}"/>`;

// Each entry is exactly what makes this hippo different from its siblings:
// its accent, what colour its eyes take, and what sits on its snout.
//
// The four that have their own website carry the motif that site already
// publishes, character for character, so the herd's copy and the project's own
// are the same drawing. Three have no site to copy from, and they were settled
// three different ways: Roll's comes from its brand plan
// (features/20-brand-and-app-icons.md); Mind's was settled here — Go's cyan,
// with a three-node network on the snout; and Maze's is copied from the SVG in
// its own repository, which is the drawing its app icon is rasterised from. A
// published mark always wins, wherever it is published.
//
// If a sibling repo ever grows a mark for one of these, THAT becomes the
// source and this table copies it, not the other way round. This file is the
// herd's rendering of the family mark, not the authority on any hippo's brand.
const HIPPOS = {
  resthippo: {
    name: "Rest Hippo",
    color: "#6C5CE7",
    eye: "#6C5CE7",
    motif: (c) => nostrils(c),
  },
  chiphippo: {
    name: "Chip Hippo",
    color: "#2F855A",
    eye: "#1C1C1C",
    // A DIP package across the snout, with the pin-1 notch dot.
    motif: () =>
      '<rect x="186" y="320" width="140" height="52" rx="8" fill="#23272B"/>' +
      '<circle cx="186" cy="346" r="11" fill="#FFFFFF"/>' +
      '<circle cx="207" cy="361" r="5" fill="#FFFFFF" opacity="0.85"/>',
  },
  jumphippo: {
    name: "Jump Hippo",
    color: "#4785F0",
    eye: "#1C1C1C",
    // Two endpoints joined by a hop.
    motif: (c) =>
      `<line x1="210" y1="332" x2="302" y2="332" stroke="${c}" stroke-width="13" stroke-linecap="round"/>` +
      '<ellipse cx="210" cy="332" rx="18" ry="23" fill="#1C1C1C"/>' +
      '<ellipse cx="302" cy="332" rx="18" ry="23" fill="#1C1C1C"/>',
  },
  keephippo: {
    name: "Keep Hippo",
    color: "#F5A623",
    eye: "#F5A623",
    motif: (c) => nostrils(c),
  },
  mazehippo: {
    name: "Maze Hippo",
    // Hue 310 — the gap between Rest at 246 and Roll at 351. See the same
    // value, and the same note, in content/hippos.mjs.
    color: "#CA2BAF",
    eye: "#CA2BAF",
    // An arrow turning a corner: the elbow it has come along, and the head it
    // is about to leave by. Copied character for character from
    // jfigge/mazehippo's assets/mazehippo.svg, which is that project's drawing
    // of record and what its icon tool rasterises — so the mark here and the
    // app icon on the phone are the same geometry rather than two people's
    // idea of the same motif. If that file changes, this copies it.
    motif: (c) =>
      `<path d="M200 366 L200 322 L278 322" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M278 300 L278 344 L312 322 Z" fill="${c}"/>`,
  },
  mindhippo: {
    name: "Mind Hippo",
    // Go's brand cyan — see the note beside the same value in
    // content/hippos.mjs. The two must stay in step: this one paints the mark,
    // that one paints the page the mark sits on.
    color: "#00ADD8",
    eye: "#00ADD8",
    // Three connected nodes — a network small enough to still read at 16px.
    motif: (c) =>
      `<path d="M204 320 L308 320 L256 368 Z" fill="none" stroke="${c}" stroke-width="11" stroke-linejoin="round"/>` +
      `<circle cx="204" cy="320" r="15" fill="${c}"/>` +
      `<circle cx="308" cy="320" r="15" fill="${c}"/>` +
      `<circle cx="256" cy="368" r="15" fill="${c}"/>`,
  },
  rollhippo: {
    name: "Roll Hippo",
    color: "#D7263D",
    eye: "#D7263D",
    // Three pips on the diagonal, as on a die.
    motif: (c) =>
      `<circle cx="180" cy="303" r="16" fill="${c}"/>` +
      `<circle cx="256" cy="335" r="16" fill="${c}"/>` +
      `<circle cx="332" cy="367" r="16" fill="${c}"/>`,
  },
  scanhippo: {
    name: "Scan Hippo",
    // Hue 94, and arrived at the way Maze's was: the midpoint of the widest
    // arc no hippo occupies. With Keep at 37 and Chip at 150 that arc is 113
    // degrees wide, the largest gap on the wheel by a factor of two, so this
    // green-yellow is as far from every sibling as a new colour can get. Deep
    // enough to read as accent text on the page's #1c1c1c (6.5:1) while
    // leaving the white hippo legible on top of it. See the same value, and
    // the same note, in content/hippos.mjs.
    color: "#61B422",
    eye: "#61B422",
    // A square wave across the snout — the one motif in the family that is a
    // picture of a signal rather than of a thing, for the one hippo whose job
    // is reading one.
    //
    // This started as a CAN differential pair, two mirrored traces that part
    // for a dominant bit and close again, which is what the bus actually looks
    // like on a scope. Drawn, it was a mistake twice over: the two pulses share
    // their rising and falling edges, so the strokes met at the corners and
    // closed into a rectangle, and a rectangle on the snout is already Chip
    // Hippo's. One trace with three transitions cannot enclose anything, and
    // says "signal" at 16px where the pair said "box with wires".
    motif: (c) =>
      `<path d="M184 350 L214 350 L214 314 L256 314 L256 350 L298 350 L298 314 L328 314" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  jsonhippo: {
    name: "JsonHippo",
    // Hue 276 — the midpoint of the 64-degree arc between Rest at 246 and
    // Maze at 310, the widest left once Scan took 94. See the same value, and
    // the same note, in content/hippos.mjs.
    color: "#B65CF0",
    eye: "#B65CF0",
    // A pair of curly braces across the snout: { }, the one piece of syntax
    // every JSON document starts with. Copied character for character from
    // jfigge/jsonhippo's src/img/jsonhippo.svg, which is that project's
    // drawing of record (its favicon and in-app logo). If that file changes,
    // this copies it.
    motif: (c) =>
      `<path d="M222 302 C204 302 204 312 204 322 L204 328 C204 335 200 338 192 338 C200 338 204 341 204 348 L204 354 C204 364 204 374 222 374 M290 302 C308 302 308 312 308 322 L308 328 C308 335 312 338 320 338 C312 338 308 341 308 348 L308 354 C308 364 308 374 290 374" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  yamlhippo: {
    name: "YamlHippo",
    // Lemon yellow, hue 50 — see the same value, and the same note, in
    // content/hippos.mjs. White on yellow is pale, so the eyes and motif are
    // dark, as Chip's and Jump's eyes are.
    color: "#F5CC00",
    eye: "#1C1C1C",
    // Indented lines across the snout: a key, then two "- " entries under it
    // — YAML is its indentation. Copied character for character from
    // jfigge/yamlhippo's src/img/yamlhippo.svg, which is that project's
    // drawing of record (its favicon and in-app logo). If that file changes,
    // this copies it.
    motif: () =>
      '<path d="M190 304 L282 304 M218 338 L228 338 M246 338 L322 338 M218 372 L228 372 M246 372 L300 372" fill="none" stroke="#1C1C1C" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  markhippo: {
    name: "MarkHippo",
    // Orange, hue 25.7 — the colour of MarkHippo's own logo and app. See
    // the same value, and the same note, in content/hippos.mjs.
    color: "#E06000",
    eye: "#E06000",
    // The Markdown mark across the snout, as one wide M whose right stroke
    // ends in the down arrow's head. Copied character for character from
    // jfigge/markhippo's src/img/markhippo.svg, which is that project's
    // drawing of record (its favicon, in-app logo and desktop icons). If that
    // file changes, this copies it.
    motif: (c) =>
      `<path d="M200 370 L200 306 L256 346 L312 306 L312 370 M294 352 L312 370 L330 352" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
};

const HERD = "#2BC4B0";

function mark(slug, h) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${h.name}">` +
    `<rect width="512" height="512" rx="114" fill="${h.color}"/>` +
    `<g fill="#FFFFFF">${BODY}</g>` +
    `<circle cx="201" cy="198" r="17" fill="${h.eye}"/>` +
    `<circle cx="311" cy="198" r="17" fill="${h.eye}"/>` +
    h.motif(h.color) +
    "</svg>\n"
  );
}

// The herd's own mark: three of the family hippo, one in front and two behind.
//
// The two at the back are silhouettes at 50% — no eyes, no motif — because at a
// 16px favicon anything inside them is mud, and because what they need to say is
// only "there are more of us". They sit HIGH and WIDE, clear of the front
// hippo's head: the first cut had them at the same height and barely narrower,
// so all that escaped from behind was a pair of ears and the mark read as one
// hippo with wings. What has to survive the shrink is the silhouette — ears,
// head, snout — of each, so each one is given room to show it.
//
// The one in front is drawn twice: once as a thick teal stroke and again filled
// white, which cuts a ring of background between it and the pair behind.
// Without that ring the three overlap into a single white blob at small sizes,
// which is exactly the size that matters most.
function herdMark() {
  const back = (tx) =>
    `<g transform="translate(${tx} 56) scale(0.52)">${BODY}</g>`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Hippo Herd">' +
    `<rect width="512" height="512" rx="114" fill="${HERD}"/>` +
    `<g fill="#FFFFFF" opacity="0.5">${back(-23.4)}${back(269.1)}</g>` +
    '<g transform="translate(56.3 82) scale(0.78)">' +
    `<g fill="${HERD}" stroke="${HERD}" stroke-width="30" stroke-linejoin="round">${BODY}</g>` +
    `<g fill="#FFFFFF">${BODY}</g>` +
    `<circle cx="201" cy="198" r="17" fill="${HERD}"/>` +
    `<circle cx="311" cy="198" r="17" fill="${HERD}"/>` +
    nostrils(HERD) +
    "</g></svg>\n"
  );
}

// ViewHippo, the herd's desktop app (electron/): the family hippo in glasses,
// because it is the one that views, with three dots on its snout in the
// colours of the viewers it hosts — JsonHippo, YamlHippo, MarkHippo — read
// from HIPPOS so they stay in step. Deep indigo rather than a hue of its own:
// it is the container, not another hippo on the wheel, and the three dots are
// the colour. Light enough to keep its outline on a dark Dock.
//
// The glasses are rings round the eyes and a bridge, with no arms: an arm
// reaches the edge of the head, and in the background colour it reads as a
// notch cut out of the silhouette. scripts/make-icons.mjs rasterises this
// file into the app's icons.
const VIEW = "#2B3050";

function viewMark() {
  const dots = ["jsonhippo", "yamlhippo", "markhippo"]
    .map((slug, i) => `<circle cx="${198 + i * 58}" cy="334" r="19" fill="${HIPPOS[slug].color}"/>`)
    .join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="ViewHippo">' +
    `<rect width="512" height="512" rx="114" fill="${VIEW}"/>` +
    `<g fill="#FFFFFF">${BODY}</g>` +
    `<circle cx="201" cy="198" r="17" fill="${VIEW}"/>` +
    `<circle cx="311" cy="198" r="17" fill="${VIEW}"/>` +
    `<g fill="none" stroke="${VIEW}" stroke-width="12" stroke-linecap="round">` +
    '<circle cx="201" cy="198" r="38"/><circle cx="311" cy="198" r="38"/>' +
    '<path d="M239 196 Q256 184 273 196"/></g>' +
    dots +
    "</svg>\n"
  );
}

await mkdir(OUT, { recursive: true });
for (const [slug, h] of Object.entries(HIPPOS)) {
  await writeFile(`${OUT}/${slug}.svg`, mark(slug, h));
  console.log(`  ${OUT}/${slug}.svg  ${h.color}`);
}
await writeFile(`${OUT}/viewhippo.svg`, viewMark());
console.log(`  ${OUT}/viewhippo.svg  ${VIEW}`);
await writeFile("website/favicon.svg", herdMark());
console.log(`  website/favicon.svg  ${HERD}`);
