#!/usr/bin/env node
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

// Generate website/marks/*.svg and website/favicon.svg.
//
// The family mark is ONE piece of geometry — two ear circles, a head, a snout,
// two eyes — that every hippo shares; a hippo is that geometry, its own accent
// colour, and one motif on the snout. Those marks already exist, hand-inlined,
// in five separate repositories, and this site needs all six of them in one
// place. Copying six hand-written SVGs in here is how the herd's Rest Hippo ends
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
// are the same drawing. Mind and Roll are the two without a live site: Roll's
// comes from its brand plan (features/20-brand-and-app-icons.md), and Mind's
// was settled here — Go's cyan, with a three-node network on the snout.
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

await mkdir(OUT, { recursive: true });
for (const [slug, h] of Object.entries(HIPPOS)) {
  await writeFile(`${OUT}/${slug}.svg`, mark(slug, h));
  console.log(`  ${OUT}/${slug}.svg  ${h.color}`);
}
await writeFile("website/favicon.svg", herdMark());
console.log(`  website/favicon.svg  ${HERD}`);
