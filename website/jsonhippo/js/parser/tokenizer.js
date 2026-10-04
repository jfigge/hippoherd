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
 * tokenizer.js — stage one of the parser: raw text in, tokens out.
 *
 * Strict RFC 8259. Walks the input one character at a time (no regex in the
 * scan loop, so it can be followed line by line in a debugger) and stamps
 * every token with where it started, so any later error can point at the
 * exact line and column.
 *
 * Token shape:
 *   { type, value, raw, line, column, offset, endOffset }
 *
 * - line and column are 1-based; offset and endOffset are 0-based indices into
 *   the input string (UTF-16 code units — the same units a <textarea>'s
 *   selectionStart uses, so an offset can be handed straight to the editor).
 * - STRING: value is the decoded string, raw is the source including quotes.
 * - NUMBER: value is the raw numeric text, unconverted, so a 20-digit integer
 *   keeps every digit. Turning it into a JS number is the view's business.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { JsonHippoError, codePointLabel, describeChar } from "./errors.js";

export const TokenType = Object.freeze({
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  COLON: "COLON",
  COMMA: "COMMA",
  STRING: "STRING",
  NUMBER: "NUMBER",
  TRUE: "TRUE",
  FALSE: "FALSE",
  NULL: "NULL",
  EOF: "EOF",
});

// Character codes the scanner compares against, named so the loops read.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const UNDERSCORE = 0x5f;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const DOLLAR = 0x24;

// Single-character tokens.
const PUNCTUATION = new Map([
  [LBRACE, TokenType.LBRACE],
  [RBRACE, TokenType.RBRACE],
  [LBRACKET, TokenType.LBRACKET],
  [RBRACKET, TokenType.RBRACKET],
  [COLON, TokenType.COLON],
  [COMMA, TokenType.COMMA],
]);

// The escapes RFC 8259 allows after a backslash, other than \uXXXX.
const SIMPLE_ESCAPES = new Map([
  [QUOTE, '"'],
  [BACKSLASH, "\\"],
  [SLASH, "/"],
  [0x62, "\b"], // b
  [0x66, "\f"], // f
  [0x6e, "\n"], // n
  [0x72, "\r"], // r
  [0x74, "\t"], // t
]);

const LITERALS = new Map([
  ["true", TokenType.TRUE],
  ["false", TokenType.FALSE],
  ["null", TokenType.NULL],
]);

// The number grammar, applied to a run the scanner has already cut out. The
// spec allows a small regex here, after the scan, and nowhere in the loop.
//   -? (0 | [1-9][0-9]*) (\.[0-9]+)? ([eE][+-]?[0-9]+)?
const NUMBER_SYNTAX = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

const VALID_ESCAPES = '\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX';

function isDigit(c) {
  return c >= ZERO && c <= NINE;
}

function isLetter(c) {
  return (c >= LOWER_A && c <= LOWER_Z) || (c >= UPPER_A && c <= UPPER_Z);
}

// A "word" is how a bare literal (or a mistake shaped like one) is cut out:
// true, nul, True, undefined, NaN, someKey.
function isWordChar(c) {
  return isLetter(c) || isDigit(c) || c === UNDERSCORE || c === DOLLAR;
}

// Everything that could plausibly be part of a number someone typed, right or
// wrong: digits, sign, point, exponent — and letters, so 12abc and 0x1F are
// reported whole as one bad number rather than as a number then a word.
function isNumberRunChar(c) {
  return isWordChar(c) || c === MINUS || c === PLUS || c === DOT;
}

/** Value of one hex digit, or -1. */
function hexValue(c) {
  if (c >= ZERO && c <= NINE) return c - ZERO;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
  return -1;
}

export class Tokenizer {
  constructor(text) {
    this.text = String(text);
    this.pos = 0; // offset of the next unread character
    this.line = 1; // line that this.pos is on
    this.lineStart = 0; // offset where this.line begins
    this.lookahead = null; // a token peek() has read but next() has not handed out
  }

  /** The next token; throws JsonHippoError on a lexical error. */
  next() {
    if (this.lookahead !== null) {
      const token = this.lookahead;
      this.lookahead = null;
      return token;
    }
    return this.scan();
  }

  /** The next token, without consuming it. */
  peek() {
    if (this.lookahead === null) this.lookahead = this.scan();
    return this.lookahead;
  }

  /** Every token up to and including EOF. */
  *[Symbol.iterator]() {
    for (;;) {
      const token = this.next();
      yield token;
      if (token.type === TokenType.EOF) return;
    }
  }

  // ── Position tracking ────────────────────────────────────────────────────

  /** The character code `ahead` places past the cursor (NaN past the end). */
  peekChar(ahead = 0) {
    return this.text.charCodeAt(this.pos + ahead);
  }

  /**
   * Consume one character, keeping line and lineStart in step. \n ends a line;
   * so does a lone \r; \r\n is one line ending, counted at the \n.
   */
  advance() {
    const c = this.text.charCodeAt(this.pos++);
    if (c === LF || (c === CR && this.text.charCodeAt(this.pos) !== LF)) {
      this.line++;
      this.lineStart = this.pos;
    }
    return c;
  }

  /**
   * { line, column, offset } for an offset on the current line. Columns are
   * derived rather than counted: column = offset - lineStart + 1. Tokens never
   * span lines (a raw line break inside a string is an error), so every token
   * and every error position is on the line the cursor is on.
   */
  position(offset = this.pos) {
    return { line: this.line, column: offset - this.lineStart + 1, offset };
  }

  token(type, value, raw, start) {
    return {
      type,
      value,
      raw,
      line: this.line,
      column: start - this.lineStart + 1,
      offset: start,
      endOffset: start + raw.length,
    };
  }

  error(code, message, start, end, fields = {}) {
    return new JsonHippoError(code, message, { ...this.position(start), endOffset: end, ...fields });
  }

  // ── Scanning ─────────────────────────────────────────────────────────────

  skipWhitespace() {
    for (;;) {
      const c = this.peekChar();
      if (c === SPACE || c === TAB) this.pos++;
      else if (c === LF || c === CR) this.advance();
      else return;
    }
  }

  scan() {
    this.skipWhitespace();
    const start = this.pos;
    if (start >= this.text.length) return this.token(TokenType.EOF, null, "", start);

    const c = this.peekChar();
    const punctuation = PUNCTUATION.get(c);
    if (punctuation !== undefined) {
      this.pos++;
      const ch = this.text[start];
      return this.token(punctuation, ch, ch, start);
    }
    if (c === QUOTE) return this.scanString();
    if (c === MINUS || isDigit(c)) return this.scanNumber();
    if (isLetter(c) || c === UNDERSCORE || c === DOLLAR) return this.scanWord();
    throw this.unexpectedChar(start);
  }

  /**
   * STRING. The value is built from slices between escapes rather than one
   * character at a time, so a megabyte string without escapes is one slice.
   */
  scanString() {
    const text = this.text;
    const start = this.pos;
    let i = start + 1; // past the opening quote
    let chunkStart = i; // first character not yet copied into value
    let value = "";

    for (;;) {
      if (i >= text.length) throw this.unterminatedString(start);
      const c = text.charCodeAt(i);

      if (c === QUOTE) break;

      if (c === BACKSLASH) {
        value += text.slice(chunkStart, i);
        i = this.scanEscape(i, start);
        value += this.escapeValue;
        chunkStart = i;
        continue;
      }

      if (c < SPACE) {
        if (c === LF || c === CR) throw this.lineBreakInString(start, i);
        throw this.error(
          "CONTROL_CHAR_IN_STRING",
          `raw control character ${codePointLabel(c)} inside a string`,
          i,
          i + 1,
          { found: codePointLabel(c), hint: controlCharHint(c) },
        );
      }
      i++;
    }

    value += text.slice(chunkStart, i);
    this.pos = i + 1;
    return this.token(TokenType.STRING, value, text.slice(start, i + 1), start);
  }

  /**
   * Decode the escape whose backslash is at `i`. Leaves the decoded text in
   * this.escapeValue and returns the offset just past the escape.
   */
  scanEscape(i, stringStart) {
    const text = this.text;
    if (i + 1 >= text.length) throw this.unterminatedString(stringStart);
    const e = text.charCodeAt(i + 1);

    const simple = SIMPLE_ESCAPES.get(e);
    if (simple !== undefined) {
      this.escapeValue = simple;
      return i + 2;
    }

    if (e === 0x75 /* u */) {
      const unit = this.readHex4(i);
      // A high surrogate followed by an escaped low surrogate is one
      // character (U+10000 and up), written in JSON as two \u escapes.
      if (unit >= 0xd800 && unit <= 0xdbff && text.charCodeAt(i + 6) === BACKSLASH && text.charCodeAt(i + 7) === 0x75) {
        const low = this.readHex4(i + 6);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.escapeValue = String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00));
          return i + 12;
        }
      }
      // Anything else, lone surrogates included, is kept as the code unit it
      // names — exactly what JSON.parse does.
      this.escapeValue = String.fromCharCode(unit);
      return i + 6;
    }

    if (e === LF || e === CR) throw this.lineBreakInString(stringStart, i + 1);
    const shown = e < SPACE ? codePointLabel(e) : text[i + 1];
    throw this.error("BAD_ESCAPE", `invalid escape '\\${shown}' in string`, i, i + 2, {
      found: `'\\${shown}'`,
      hint: `The escapes JSON allows are ${VALID_ESCAPES}. A literal backslash is written \\\\.`,
    });
  }

  /** The four hex digits after the \u whose backslash is at `i`. */
  readHex4(i) {
    let unit = 0;
    for (let k = 2; k < 6; k++) {
      const c = this.text.charCodeAt(i + k);
      const h = hexValue(c);
      if (h < 0) {
        const shown = this.text.slice(i, Math.min(i + 6, this.text.length)).replace(/[\r\n].*$/s, "");
        throw this.error("BAD_UNICODE_ESCAPE", `invalid unicode escape '${shown}'`, i, i + k + 1, {
          found: `'${shown}'`,
          hint: "\\u must be followed by exactly four hex digits (0-9, a-f), e.g. \\u00e9.",
        });
      }
      unit = unit * 16 + h;
    }
    return unit;
  }

  /**
   * A raw line break inside a string is one of two mistakes, and they need
   * different messages:
   *
   *   {"a": "abc,            ← the closing quote is missing: UNTERMINATED_STRING,
   *    "b": 2}                 reported at the OPENING quote
   *
   *   {"a": "line one        ← a closed string with a literal newline in it:
   *   line two"}               CONTROL_CHAR_IN_STRING, at the newline
   *
   * Tell them apart by looking ahead for the next unescaped quote. If it is
   * followed by something that may follow a string (, } ] : or the end), the
   * string does close and only the newline is wrong. Otherwise that quote
   * belongs to the next token and this string never closed.
   */
  lineBreakInString(stringStart, at) {
    const text = this.text;
    let j = at;
    while (j < text.length) {
      const c = text.charCodeAt(j);
      if (c === BACKSLASH) j += 2;
      else if (c === QUOTE) break;
      else j++;
    }
    if (j < text.length) {
      let k = j + 1;
      while (k < text.length && isJsonWhitespace(text.charCodeAt(k))) k++;
      const after = text.charCodeAt(k);
      if (k >= text.length || after === COMMA || after === RBRACE || after === RBRACKET || after === COLON) {
        const c = text.charCodeAt(at);
        return this.error("CONTROL_CHAR_IN_STRING", `raw line break (${codePointLabel(c)}) inside a string`, at, at + 1, {
          found: codePointLabel(c),
          hint: "Strings cannot span lines. Write the line break as \\n.",
        });
      }
    }
    return this.unterminatedString(stringStart, "The closing quote is missing before the end of this line.");
  }

  unterminatedString(start, hint = "The closing quote is missing.") {
    return this.error("UNTERMINATED_STRING", "string is never closed", start, start + 1, {
      found: "end of input",
      expected: ["'\"'"],
      hint,
    });
  }

  /** NUMBER: cut out the whole run, then judge it against the grammar. */
  scanNumber() {
    const text = this.text;
    const start = this.pos;
    let i = start;
    while (i < text.length && isNumberRunChar(text.charCodeAt(i))) i++;
    const raw = text.slice(start, i);
    if (!NUMBER_SYNTAX.test(raw)) {
      throw this.error("BAD_NUMBER", `invalid number '${raw}'`, start, i, {
        found: `'${raw}'`,
        hint: numberHint(raw),
      });
    }
    this.pos = i;
    return this.token(TokenType.NUMBER, raw, raw, start);
  }

  /** TRUE / FALSE / NULL — or BAD_LITERAL for any other bare word. */
  scanWord() {
    const text = this.text;
    const start = this.pos;
    let i = start;
    while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
    const word = text.slice(start, i);
    const type = LITERALS.get(word);
    if (type === undefined) {
      throw this.error("BAD_LITERAL", `unknown word '${word}'`, start, i, {
        found: `'${word}'`,
        hint: literalHint(word),
      });
    }
    this.pos = i;
    const value = type === TokenType.NULL ? null : type === TokenType.TRUE;
    return this.token(type, value, word, start);
  }

  unexpectedChar(start) {
    const ch = String.fromCodePoint(this.text.codePointAt(start));
    return this.error("UNEXPECTED_CHAR", `unexpected character ${describeChar(ch)}`, start, start + ch.length, {
      found: describeChar(ch),
      hint: unexpectedCharHint(ch, this.text.charCodeAt(start + 1)),
    });
  }
}

function isJsonWhitespace(c) {
  return c === SPACE || c === TAB || c === LF || c === CR;
}

// ── Hints: plain-English guesses at what went wrong ─────────────────────────

function controlCharHint(c) {
  if (c === TAB) return "Write a tab inside a string as \\t.";
  return `Control characters must be escaped, e.g. \\u${c.toString(16).padStart(4, "0")}.`;
}

function numberHint(raw) {
  const digits = raw.startsWith("-") ? raw.slice(1) : raw;
  if (/^(?:Infinity|NaN)$/i.test(digits)) return "NaN and Infinity are not valid JSON numbers.";
  if (digits === "") return "'-' must be followed by a digit.";
  if (/^0[xX]/.test(digits)) return "Hexadecimal numbers are not allowed in JSON.";
  if (/^0[0-9]/.test(digits)) return "Numbers cannot have leading zeros.";
  if (/\.(?![0-9])/.test(digits)) return "A decimal point must be followed by at least one digit.";
  if (/[eE][+-]?$/.test(digits)) return "An exponent needs at least one digit, e.g. 1e5.";
  if (/[+-]/.test(digits.replace(/[eE][+-]/, ""))) return "A number can only have a sign at the start and in its exponent.";
  if (/[A-Za-z_$]/.test(digits.replace(/[eE]/, ""))) return "Numbers cannot contain letters. Text values need double quotes.";
  return null;
}

function literalHint(word) {
  const lower = word.toLowerCase();
  if (LITERALS.has(lower)) return `JSON literals are lower-case: ${lower}.`;
  if (lower === "undefined") return "JSON has no undefined. Use null.";
  if (lower === "nan" || lower === "infinity") return "NaN and Infinity are not valid JSON numbers.";
  for (const literal of LITERALS.keys()) {
    if (literal.startsWith(lower)) return `Did you mean ${literal}?`;
  }
  return "Text values must be in double quotes.";
}

function unexpectedCharHint(ch, nextCode) {
  switch (ch) {
    case "'":
      return 'Strings and keys must use double quotes ("), not single quotes.';
    case "“":
    case "”":
    case "‘":
    case "’":
      return 'Curly quotes, usually from a word processor. JSON needs straight double quotes (").';
    case "/":
      if (nextCode === SLASH || nextCode === 0x2a) return "JSON does not allow comments.";
      return null;
    case "#":
      return "JSON does not allow comments.";
    case "+":
      return "Numbers cannot start with '+'.";
    case ".":
      return "Numbers need a digit before the decimal point, e.g. 0.5.";
    case "=":
      return "Use ':' between a key and its value.";
    case ";":
      return "Use ',' between values.";
    case "\\":
      return "This looks like escaped JSON. Try the Unescape button.";
    case " ":
    case "​":
    case "‌":
    case "‍":
    case "⁠":
    case "　":
    case "­":
    case " ":
    case " ":
      return "An invisible character, often picked up when copying from a web page or chat. Delete it and type a plain space.";
    case "﻿":
      return "A byte order mark. Some editors add one to the start of a file. Remove it.";
    default:
      return null;
  }
}

/**
 * Decode one complete JSON string literal ("…" including the quotes) with the
 * same rules the tokenizer applies inside a document. Throws JsonHippoError
 * if `literal` is not exactly one string token. Smart paste uses this so
 * escaped JSON is unescaped by the parser's own rules, not by a second set.
 */
export function decodeStringLiteral(literal) {
  const tokens = new Tokenizer(literal);
  const token = tokens.next();
  if (token.type !== TokenType.STRING) {
    throw new JsonHippoError("EXPECTED_VALUE", "not a string literal", { line: token.line, column: token.column, offset: token.offset });
  }
  const end = tokens.next();
  if (end.type !== TokenType.EOF) {
    throw new JsonHippoError("TRAILING_CONTENT", "text after the string literal", { line: end.line, column: end.column, offset: end.offset });
  }
  return token.value;
}

/**
 * Decode the escapes in `body` — the inside of a string literal, without its
 * quotes — with the tokenizer's own escape code (scanEscape), but copy every
 * other character through as it is: raw line breaks, tabs and unescaped
 * quotes included, where a real string literal would reject them.
 *
 * Smart paste needs this for escaped JSON copied out of logs and source code,
 * which was often pretty-printed before it was quoted, so its line breaks were
 * never escaped. The escapes themselves are still held to the full rules: an
 * invalid one (\x, \u12G4, a backslash at the very end) throws JsonHippoError.
 */
export function decodeEscapesLoosely(body) {
  const tokens = new Tokenizer(body);
  let out = "";
  let chunkStart = 0;
  for (let i = body.indexOf("\\"); i !== -1; i = body.indexOf("\\", i)) {
    out += body.slice(chunkStart, i);
    i = tokens.scanEscape(i, i);
    out += tokens.escapeValue;
    chunkStart = i;
  }
  return out + body.slice(chunkStart);
}
