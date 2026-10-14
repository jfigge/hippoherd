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
 * embed.js — where a pasted or dropped image goes in the markdown.
 *
 * On the web there is no folder beside the document to put an image in, so
 * the image goes in the document itself, as a data: URL. To keep the text
 * readable, the URL is not written where the image is but in a reference
 * definition at the end, with the others:
 *
 *   The login screen: ![login screen][image-1]
 *   …
 *
 *   [image-1]: data:image/png;base64,iVBORw0KGgo…
 *
 * The document stays one self-contained file that any CommonMark reader
 * shows the same way.
 */

const reImageDefinition = /^\[image-(\d+)\]: /;

// The label for a new image: image-N, one past the highest the text
// already defines. Labels match whatever their case, as CommonMark's do.
export function nextImageLabel(text) {
  let max = 0;
  for (const m of text.matchAll(/^ {0,3}\[image-(\d+)\]:/gim)) max = Math.max(max, Number(m[1]));
  return `image-${max + 1}`;
}

// Where the image definitions at the end of `text` start — after them is
// only blank lines — or -1 if it does not end with any.
export function trailingDefinitions(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") end--;
  let start = -1;
  while (end > 0) {
    const lineStart = text.lastIndexOf("\n", end - 1) + 1;
    if (!reImageDefinition.test(text.slice(lineStart, lineStart + 24))) break;
    start = lineStart;
    end = lineStart - 1;
    if (end < 0) break;
  }
  return start;
}

// Alt text from a file's name: "login-screen.png" → "login screen", with
// what would end the brackets early escaped.
export function altFromName(name) {
  const base = (name ?? "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "image").replace(/[\\[\]]/g, "\\$&");
}

// How to put an image in `text`, replacing [from, to] (the selection):
//
//   { from, to, insert, append, select: [start, end] }
//
// — `insert` replaces [from, to], `append` goes on the end, and `select`
// is the alt text in the result, to type over. `defined(text, label)`
// says whether a parse of the result defines `label`: if something left
// open at the end of the document (a code fence, say) would swallow the
// definition, the URL goes inline instead.
export function placeImage(text, from, to, { alt, url }, defined) {
  const label = nextImageLabel(text);
  // Not inside the definitions themselves: before them, as a paragraph.
  const definitions = trailingDefinitions(text);
  let after = "";
  if (definitions !== -1 && to >= definitions) {
    from = to = definitions;
    after = "\n\n";
  }
  const insert = `![${alt}][${label}]${after}`;
  const result = text.slice(0, from) + insert + text.slice(to);
  const trailing = result.length - result.replace(/\n+$/, "").length;
  // A definition cannot interrupt a paragraph: a blank line before the
  // first, a line break between the rest.
  const needed = trailingDefinitions(result) === -1 ? 2 : 1;
  const append = "\n".repeat(Math.max(0, needed - trailing)) + `[${label}]: ${url}\n`;
  const select = [from + 2, from + 2 + alt.length];
  if (defined && !defined(result + append, label)) {
    return { from, to, insert: `![${alt}](${url})${after}`, append: "", select };
  }
  return { from, to, insert, append, select };
}
