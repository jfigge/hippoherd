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
 * normalize.js — the small, exact transformations the spec names: backslash
 * escapes, entity and numeric character references, link label matching and
 * URL percent-encoding.
 */

import { ENTITIES } from "./entities.js";

// ASCII punctuation: the characters a backslash may escape (spec §2.4).
export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
export const ENTITY = "&(?:#[xX][a-fA-F0-9]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});";

const reEscapable = new RegExp("^" + ESCAPABLE);
const reBackslashOrAmp = /[\\&]/;
const reEntityOrEscapedChar = new RegExp("\\\\" + ESCAPABLE + "|" + ENTITY, "g");

export function isEscapable(ch) {
  return reEscapable.test(ch);
}

// Unicode punctuation for the flanking rules: general categories P and S
// (spec §2.1, as of 0.31).
const rePunctuation = /^[\p{P}\p{S}]/u;
export function isPunctuation(ch) {
  return rePunctuation.test(ch);
}

// Unicode whitespace: Zs, plus tab, line feed, form feed and carriage return.
const reUnicodeWhitespace = /^[\p{Zs}\t\n\f\r]/u;
export function isUnicodeWhitespace(ch) {
  return reUnicodeWhitespace.test(ch);
}

// One entity or numeric reference, given with its & and ;. Answers null for
// a name HTML does not define — that stays literal text.
export function decodeEntity(ref) {
  if (ref[1] === "#") {
    const hex = ref[2] === "x" || ref[2] === "X";
    const code = parseInt(ref.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  }
  const name = ref.slice(1, -1);
  return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : null;
}

// Resolve backslash escapes and references in a link destination, title or
// info string.
export function unescapeString(s) {
  if (!reBackslashOrAmp.test(s)) return s;
  return s.replace(reEntityOrEscapedChar, (m) => {
    if (m[0] === "\\") return m[1];
    return decodeEntity(m) ?? m;
  });
}

// Link label matching (spec §6.3): strip the brackets, collapse internal
// whitespace, and Unicode case fold. toLowerCase().toUpperCase() is the fold
// commonmark.js uses; it maps ẞ and ß alike to SS.
export function normalizeLabel(label) {
  return label
    .slice(1, label.length - 1)
    .trim()
    .replace(/[ \t\r\n]+/g, " ")
    .toLowerCase()
    .toUpperCase();
}

// Percent-encode a URL the way the reference implementations do: characters
// that are legal in a URL stay as they are, an existing %XX escape is kept,
// everything else is UTF-8 percent-encoded.
const reUrlSafe = /[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]/;
const reHex2 = /^[0-9a-fA-F]{2}$/;
export function normalizeURI(uri) {
  let out = "";
  for (let i = 0; i < uri.length; i++) {
    const ch = uri[i];
    if (ch === "%" && reHex2.test(uri.slice(i + 1, i + 3))) {
      out += uri.slice(i, i + 3);
      i += 2;
    } else if (reUrlSafe.test(ch)) {
      out += ch;
    } else {
      const code = uri.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < uri.length) {
        const low = uri.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          out += encodeURIComponent(uri.slice(i, i + 2));
          i += 1;
          continue;
        }
      }
      out += code >= 0xd800 && code <= 0xdfff ? "%EF%BF%BD" : encodeURIComponent(ch);
    }
  }
  return out;
}
