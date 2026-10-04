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
 * errors.js — JsonHippoError, and the wording the tokenizer and parser share
 * when they describe what they found.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/**
 * The one error type the tokenizer and parser throw. Everything a view needs
 * to point at the problem is on the instance: where it is (line/column/offset,
 * and endOffset so the bad token can be selected), what was expected and
 * found, the JSON path, and the containers still open at that moment.
 *
 * `message` is the bare description ("expected ',' or '}' but found …");
 * toString() adds the position and path in front and behind it.
 */
export class JsonHippoError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "JsonHippoError";
    this.code = code;
    this.line = fields.line ?? 1;
    this.column = fields.column ?? 1;
    this.offset = fields.offset ?? 0;
    this.endOffset = fields.endOffset ?? this.offset;
    this.expected = fields.expected ?? [];
    this.found = fields.found ?? null;
    this.path = fields.path ?? null;
    this.openStack = fields.openStack ?? [];
    // Where the related '{' or '[' sits, for MISMATCHED_CLOSE and
    // UNCLOSED_CONTAINER: the view offers a second "go to opener" jump.
    this.opener = fields.opener ?? null;
    this.hint = fields.hint ?? null;
  }

  /** "Line 42, col 8: expected ',' or '}' but found string "name" (in $.items[3])" */
  toString() {
    const where = this.path ? ` (in ${clipPath(this.path)})` : "";
    return `Line ${this.line}, col ${this.column}: ${this.message}${where}`;
  }
}

/** True for the error codes the tokenizer raises (as opposed to the parser). */
export const LEXICAL_CODES = new Set([
  "UNTERMINATED_STRING",
  "BAD_ESCAPE",
  "BAD_UNICODE_ESCAPE",
  "CONTROL_CHAR_IN_STRING",
  "BAD_NUMBER",
  "BAD_LITERAL",
  "UNEXPECTED_CHAR",
]);

// Longest piece of source text quoted back in a message. Errors in huge
// inputs often land on huge strings, and the status bar is one line.
const MAX_QUOTE = 40;

/** Shorten `text` to MAX_QUOTE characters, marking the cut with an ellipsis. */
export function clip(text, max = MAX_QUOTE) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * How a token reads in an error message: `string "name"`, `number 12`,
 * `true`, `'}'`, `end of input`.
 */
export function describeToken(token) {
  switch (token.type) {
    case "STRING":
      return `string ${clip(token.raw)}`;
    case "NUMBER":
      return `number ${clip(token.raw)}`;
    case "TRUE":
    case "FALSE":
    case "NULL":
      return token.raw;
    case "EOF":
      return "end of input";
    default:
      return `'${token.raw}'`;
  }
}

// Invisible and look-alike characters people paste by accident, named so the
// message says what the character is rather than showing a blank.
const CHAR_NAMES = {
  0x00a0: "no-break space",
  0x00ad: "soft hyphen",
  0x200b: "zero-width space",
  0x200c: "zero-width non-joiner",
  0x200d: "zero-width joiner",
  0x2028: "line separator",
  0x2029: "paragraph separator",
  0x2060: "word joiner",
  0x3000: "ideographic space",
  0xfeff: "byte order mark",
  0x201c: "left curly quote",
  0x201d: "right curly quote",
  0x2018: "left single curly quote",
  0x2019: "right single curly quote",
};

/**
 * A path short enough for one line of a status bar. Ten thousand levels of
 * nesting is a 40,000-character path; keep its head and its tail, where the
 * interesting parts are. The full path stays on error.path.
 */
export function clipPath(path, max = 160) {
  if (path.length <= max) return path;
  const head = Math.floor(max / 3);
  return `${path.slice(0, head)}…${path.slice(path.length - (max - head - 1))}`;
}

/** "U+00A0" for a code point. */
export function codePointLabel(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * How a single character reads in a message: `'@'` for anything visible,
 * `U+00A0 (no-break space)` for anything that would print as nothing.
 */
export function describeChar(ch) {
  const cp = ch.codePointAt(0);
  const name = CHAR_NAMES[cp];
  if (name) return `${codePointLabel(cp)} (${name})`;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return codePointLabel(cp);
  if (ch === "'") return `"'"`;
  return `'${ch}'`;
}

/** ["','", "'}'"] → "',' or '}'"; three or more get commas. */
export function listExpected(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
