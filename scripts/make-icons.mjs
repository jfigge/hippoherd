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

// Regenerate the desktop app's icon rasters from the two vector sources.
// `make icons` runs it — under ELECTRON, not plain node:
//
//   cd electron && npx electron ../scripts/make-icons.mjs
//
// The same approach as Chip Hippo's scripts/make-icons.mjs, for the same
// reason: macOS' QuickLook flattens SVG transparency onto WHITE, which would
// fill the corners of every icon and the macOS safe-area margin. Drawing the
// SVG onto a canvas in a hidden Chromium window keeps the alpha channel end to
// end, so the corners stay transparent.
//
// Two sources, because macOS is special:
//   website/favicon.svg                 the app's own mark, edge to edge
//                                         → Windows .ico and the Linux set
//   electron/icons/hippoherd-mac-icon.svg the same art inside the macOS
//                                         safe area, transparent margin round it
//                                         → the macOS icon (electron-builder
//                                           turns it into the .icns)
//
// Outputs, committed and read by electron-builder:
//   electron/icons/mac.png          1024², macOS
//   electron/icons/icon.ico         Windows, PNG-encoded entries 16…256
//   electron/icons/linux/<N>x<N>.png  Linux icon set, 16…1024 (512 is also
//                                   the Windows/Linux window icon, main.js)
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(repoRoot, "electron", "icons");
const FULL_SVG = path.join(repoRoot, "website", "favicon.svg");
const MAC_SVG = path.join(ICONS, "hippoherd-mac-icon.svg");
const MAC_PNG = path.join(ICONS, "mac.png");
const ICO = path.join(ICONS, "icon.ico");
const LINUX_DIR = path.join(ICONS, "linux");

const MAC_SIZE = 1024;
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

// One hidden window draws everything; the SVG goes in as a data: URL, so each
// size is rendered straight from the vector rather than scaled from a bitmap.
let raster = null;
async function rasterWindow() {
  if (raster) return raster;
  raster = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await raster.loadURL("about:blank");
  return raster;
}

async function render(svgText, size) {
  const win = await rasterWindow();
  const b64 = Buffer.from(svgText, "utf8").toString("base64");
  const dataUrl = await win.webContents.executeJavaScript(
    `new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ${size};
        canvas.height = ${size};
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, ${size}, ${size});
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("SVG decode failed"));
      img.src = "data:image/svg+xml;base64,${b64}";
    })`,
    true,
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// A Vista-style .ico: a 6-byte header, one 16-byte directory entry per image,
// then the PNG blobs themselves.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width, 0 meaning 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2); // palette size
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

const rel = (p) => path.relative(repoRoot, p);

app.whenReady().then(async () => {
  try {
    writeFileSync(MAC_PNG, await render(readFileSync(MAC_SVG, "utf8"), MAC_SIZE));
    console.log(`  ${rel(MAC_PNG)}  ${MAC_SIZE}²`);

    const full = readFileSync(FULL_SVG, "utf8");
    const cache = new Map();
    const at = async (size) => {
      if (!cache.has(size)) cache.set(size, await render(full, size));
      return cache.get(size);
    };

    mkdirSync(LINUX_DIR, { recursive: true });
    for (const size of LINUX_SIZES) {
      writeFileSync(path.join(LINUX_DIR, `${size}x${size}.png`), await at(size));
    }
    console.log(`  ${rel(LINUX_DIR)}/  ${LINUX_SIZES.join(", ")}`);

    const entries = [];
    for (const size of ICO_SIZES) entries.push({ size, png: await at(size) });
    writeFileSync(ICO, buildIco(entries));
    console.log(`  ${rel(ICO)}  ${ICO_SIZES.join(", ")}`);

    app.exit(0);
  } catch (err) {
    console.error("make-icons failed:", err.message);
    app.exit(1);
  }
});
