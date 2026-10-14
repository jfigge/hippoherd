/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of MarkHippo.
 *
 * MarkHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * MarkHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with MarkHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * image-import.js — a pasted or dropped image file, made ready to go in
 * the document as a data: URL (images/embed.js says where).
 *
 * An image goes in exactly as it is when it is a PNG, JPEG, GIF or WebP no
 * more than 1600 pixels wide, 3200 tall and 1.5 MB. A bigger one is scaled
 * down to fit — 1600 pixels is the widest the preview ever shows an image,
 * even on a high-density screen — and stored as PNG, or JPEG for a photo,
 * so the document stays small enough to keep in the browser. Other formats
 * the browser can read (SVG, AVIF, BMP, and on a Mac HEIC and TIFF) are
 * converted the same way: the preview shows only those four formats from
 * data: URLs, and an SVG could carry script. A GIF always goes in as it is,
 * so it keeps its animation.
 */

const KEPT = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_WIDTH = 1600;
export const MAX_HEIGHT = 3200;
export const MAX_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 0.9;

const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|heic|heif|tiff?)$/i;

export const isImage = (file) => file.type.startsWith("image/") || (!file.type && IMAGE_NAME.test(file.name));

// The image as { url, width, height }; throws an Error saying why not if
// the browser cannot read it.
export async function importImage(file) {
  if (file.type === "image/gif") return { url: await dataUrl(file) };
  const img = await decode(file);
  const width = img.naturalWidth || MAX_WIDTH;
  const height = img.naturalHeight || Math.round(MAX_WIDTH * 0.75);
  const fits = width <= MAX_WIDTH && height <= MAX_HEIGHT;
  if (KEPT.has(file.type) && fits && file.size <= MAX_BYTES) return { url: await dataUrl(file), width, height };

  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0, canvas.width, canvas.height);

  let blob = await encode(canvas, file.type === "image/jpeg" ? "image/jpeg" : "image/png");
  // A photo as PNG is large; without transparency, JPEG loses nothing seen.
  if (blob.type === "image/png" && blob.size > MAX_BYTES && opaque(g, canvas)) blob = await encode(canvas, "image/jpeg");
  // Converting did not help: the original, if the preview can show it.
  if (KEPT.has(file.type) && fits && blob.size >= file.size) blob = file;
  return { url: await dataUrl(blob), width: canvas.width, height: canvas.height };
}

// The file as a decoded <img> (which keeps its pixels once its address is
// gone).
function decode(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.src = url;
  return img.decode().then(
    () => {
      URL.revokeObjectURL(url);
      return img;
    },
    () => {
      URL.revokeObjectURL(url);
      throw new Error(`${file.name || "That file"} is not an image this browser can read.`);
    },
  );
}

function encode(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be converted."))), type, QUALITY);
  });
}

function opaque(g, canvas) {
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
  return true;
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}
