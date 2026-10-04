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

/**
 * smart-paste.js — recognise escaped JSON and unescape it.
 *
 * APIs and logs hand JSON back as a string: "{\"id\":7,\"tags\":[\"a\"]}".
 * Two shapes are recognised:
 *
 *   quoted  "{\"a\":1}"    the whole input is one JSON string literal
 *   bare    {\"a\":1}      the same, copied without its outer quotes
 *
 * Either way the escapes are decoded by the tokenizer's own escape code, so
 * the escape rules are the parser's, and decoding repeats while the result is
 * itself escaped (JSON that was escaped twice, up to MAX_LEVELS).
 *
 * The decoding is forgiving about everything EXCEPT the escapes. Escaped JSON
 * is often pretty-printed before it is quoted, so its line breaks arrive raw,
 * and a hand-edited copy can carry a stray unescaped quote. A strict string
 * decoder rejects both, and the paste would fall through looking untouched.
 * Here raw characters pass through as they are, and the parser — whose job
 * that is — then reports anything that is still wrong, at its exact position.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { decodeEscapesLoosely } from "./parser/tokenizer.js";

/** Stop unescaping after this many levels. */
export const MAX_LEVELS = 5;

// An escaped quote straight after an opener or a comma (whitespace allowed):
// {\"a\"  [\"x\"  ,\"b\" — the signature of escaped JSON with no outer quotes.
// One or more backslashes, so JSON escaped twice ({\\\"a\\\") is caught too.
const BARE_SIGNATURE = /[{[,]\s*\\+"/;

function isQuotedForm(t) {
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"';
}

function isBareForm(t) {
  return (t[0] === "{" || t[0] === "[") && BARE_SIGNATURE.test(t);
}

/** True if `t` has a `"` that is not escaped by a backslash. */
function hasBareQuote(t) {
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\") i++;
    else if (t[i] === '"') return true;
  }
  return false;
}

function tryDecode(body) {
  try {
    return decodeEscapesLoosely(body);
  } catch {
    return null;
  }
}

/**
 * @returns {{ text: string, levels: number, mode: 'quoted' | 'bare' } | null}
 *   null when the input is not escaped JSON — including a plain JSON string
 *   such as "hello", which is valid JSON as it stands and is left alone.
 */
export function detectAndUnescape(text) {
  let current = text;
  let levels = 0;
  let mode = null;

  while (levels < MAX_LEVELS) {
    const t = current.trim();
    let decoded = null;
    let shape = null;
    if (isQuotedForm(t)) {
      // Everything between the outer quotes is the escaped text, raw line
      // breaks and stray quotes included.
      decoded = tryDecode(t.slice(1, -1));
      shape = "quoted";
    } else if (isBareForm(t) && !hasBareQuote(t)) {
      // Escaped JSON has every quote escaped. Normal JSON has bare quotes
      // around every key and string, so it never gets through here — even
      // {"a":"x,\"y"}, whose \" after a comma looks like the signature.
      decoded = tryDecode(t);
      shape = "bare";
    }
    if (decoded === null) break;
    current = decoded;
    levels++;
    mode ??= shape;
  }

  if (levels === 0) return null;
  const head = current.trimStart()[0];
  if (head !== "{" && head !== "[") return null;
  return { text: current, levels, mode };
}
