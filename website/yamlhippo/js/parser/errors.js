/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of YamlHippo.
 *
 * YamlHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * YamlHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with YamlHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * errors.js — YamlHippoError, and the wording the scanner, parser and
 * composer share when they describe what they found.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/**
 * The one error type the parser throws. Everything a view needs to point at
 * the problem is on the instance: where it is (line/column/offset, and
 * endOffset so the bad text can be selected), what was expected and found,
 * the path, and the collections still open at that moment.
 *
 * Indentation errors also carry `indent`: { found, expected: [columns…] },
 * in spaces, so a view can say "indented 3 spaces but siblings use 2".
 *
 * `message` is the bare description; toString() adds the position and path.
 */
export class YamlHippoError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "YamlHippoError";
    this.code = code;
    this.line = fields.line ?? 1;
    this.column = fields.column ?? 1;
    this.offset = fields.offset ?? 0;
    this.endOffset = fields.endOffset ?? this.offset;
    this.expected = fields.expected ?? [];
    this.found = fields.found ?? null;
    this.path = fields.path ?? null;
    this.openStack = fields.openStack ?? [];
    // Where the related opener sits — the '[' or '{' never closed, the quote
    // that never ends, the sibling the indentation disagrees with. The view
    // offers a second "go to" jump to it.
    this.opener = fields.opener ?? null;
    this.indent = fields.indent ?? null;
    this.hint = fields.hint ?? null;
  }

  /** "Line 7, col 4: indented 3 spaces but siblings use 2 (in $.spec.ports)" */
  toString() {
    const where = this.path ? ` (in ${clipPath(this.path)})` : "";
    return `Line ${this.line}, col ${this.column}: ${this.message}${where}`;
  }
}

/** Every error code, in the order the docs' error reference lists them. */
export const ERROR_CODES = Object.freeze([
  "INDENT_MISMATCH",
  "TAB_INDENT",
  "MAPPING_VALUE_NOT_ALLOWED",
  "EXPECTED_COLON",
  "EXPECTED_KEY",
  "EXPECTED_ENTRY",
  "ENTRY_NOT_ALLOWED",
  "EXPECTED_VALUE",
  "UNTERMINATED_STRING",
  "BAD_ESCAPE",
  "EXPECTED_COMMA_OR_CLOSE",
  "MISMATCHED_CLOSE",
  "UNCLOSED_CONTAINER",
  "BLOCK_IN_FLOW",
  "RESERVED_CHAR",
  "UNEXPECTED_CHAR",
  "BAD_BLOCK_HEADER",
  "BAD_ANCHOR",
  "UNKNOWN_ALIAS",
  "BAD_TAG",
  "BAD_DIRECTIVE",
  "TRAILING_CONTENT",
  "EMPTY_INPUT",
  "MAX_DEPTH",
]);

// Longest piece of source text quoted back in a message. Errors in huge
// inputs often land on huge strings, and the status bar is one line.
const MAX_QUOTE = 40;

/** Shorten `text` to MAX_QUOTE characters, marking the cut with an ellipsis. */
export function clip(text, max = MAX_QUOTE) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** "1 space", "3 spaces" */
export function spaces(n) {
  return n === 1 ? "1 space" : `${n} spaces`;
}

// Invisible and look-alike characters people paste by accident, named so the
// message says what the character is rather than showing a blank.
const CHAR_NAMES = {
  0x0009: "tab",
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
  if (ch === "") return "end of input";
  const cp = ch.codePointAt(0);
  const name = CHAR_NAMES[cp];
  if (name) return `${codePointLabel(cp)} (${name})`;
  if (cp === 0x0a || cp === 0x0d) return "end of line";
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return codePointLabel(cp);
  if (ch === "'") return `"'"`;
  return `'${ch}'`;
}

/** ["','", "']'"] → "',' or ']'"; three or more get commas. */
export function listExpected(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
