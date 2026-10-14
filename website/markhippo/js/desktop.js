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
 * desktop.js — the page's side of the desktop app (electron/).
 *
 * The same page runs in a browser tab and in the desktop app's window. In
 * the window, the shell's preload gives it a bridge (window.markhippoDesktop,
 * electron/preload.js) for what a page cannot do on its own: open and save
 * files in place, save exports where the user says, keep pasted pictures in
 * a folder beside the document, and load the user's own plugins. In a
 * browser there is no bridge and `desktop` is null, and everything works as
 * it always has.
 */

export const desktop = globalThis.markhippoDesktop ?? null;

// The user's plugins: each one in the shell's plugins folder, imported.
// [{ name, plugin }] for those that load, [{ name, error }] for those that
// do not — a plugin that fails stays out, with its reason in the plugin
// list, and the rest of the app carries on.
export async function loadUserPlugins(bridge = desktop) {
  if (!bridge) return [];
  let found;
  try {
    found = await bridge.plugins();
  } catch (err) {
    return [{ name: "Plugins folder", error: `could not be read: ${err?.message ?? err}` }];
  }
  return Promise.all(
    found.map(async ({ name, url }) => {
      try {
        const plugin = (await import(url)).default;
        if (!plugin || typeof plugin !== "object" || !plugin.id || typeof plugin.setup !== "function") {
          throw new Error("is not a plugin: it must `export default { id, setup(api) { … } }`");
        }
        return { name, plugin };
      } catch (err) {
        return { name, error: err?.message ?? String(err) };
      }
    }),
  );
}

// The page's address for one of the document's own images — a path
// relative to the document, or an absolute one — which the shell serves
// from beside the file (electron/policy.js, /@doc/). The address goes as
// one path segment, as the document wrote it. Web addresses, data: URLs
// and in-page links are not the document's files: null.
export function documentImageUrl(src) {
  if (!src || src.startsWith("#") || src.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  return `/@doc/${encodeURIComponent(src)}`;
}

// Image types the page shows from a file as they are; a pasted picture of
// another kind (HEIC, TIFF) is converted before it is saved.
export const SHOWN_AS_FILES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif", "image/bmp"]);
