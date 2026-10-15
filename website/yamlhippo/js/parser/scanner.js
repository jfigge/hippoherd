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
 * scanner.js — stage one: characters in, tokens out.
 *
 * Walks the input one character code at a time (charCodeAt; no regular
 * expressions in the scan loop) and keeps the line and the start of the line,
 * so every token knows its line, column and offset exactly.
 *
 * YAML's structure is in its indentation, so the scanner keeps an
 * INDENTATION STACK, not just a bracket depth. A line indented deeper than
 * the open block starts a new block (BLOCK_MAPPING_START /
 * BLOCK_SEQUENCE_START); a dedent closes blocks, one BLOCK_END each, until
 * the indentation matches an open block again. A dedent that lands BETWEEN
 * two open blocks matches neither, and is the headline error:
 *
 *   Line 3, col 3: indented 2 spaces but siblings use 4
 *
 * The token stream is the one libyaml and PyYAML produce (the YAML spec's
 * reference shape), including their "simple key" bookkeeping: a plain or
 * quoted scalar might turn out to be a mapping key, and only the ':' after
 * it says so, so the scanner remembers where each possible key began and
 * inserts KEY (and BLOCK_MAPPING_START) in front of it when the ':' comes.
 *
 * Scalar resolution follows YAML 1.2 (see resolve.js); the token stream also
 * follows 1.2 where it differs from 1.1: tabs are fine as separation, `#`
 * only starts a comment after whitespace, and in a flow collection a ':'
 * straight after a quoted key ({"a":1}) is a value indicator, so JSON is YAML.
 *
 * Tokens: { type, start, end, value?, style?, raw?, … }
 *   start/end = { line, column, offset } (1-based line/column, 0-based UTF-16
 *   offset; end is just past the token).
 *
 * Comments are not tokens; they are collected in scanner.comments, in order,
 * for the formatter: { text, line, column, offset, endOffset, ownLine }.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { YamlHippoError, clip, describeChar, spaces } from "./errors.js";

export const TokenType = Object.freeze({
  STREAM_END: "STREAM_END",
  DIRECTIVE: "DIRECTIVE",
  DOC_START: "DOC_START",
  DOC_END: "DOC_END",
  BLOCK_SEQUENCE_START: "BLOCK_SEQUENCE_START",
  BLOCK_MAPPING_START: "BLOCK_MAPPING_START",
  BLOCK_END: "BLOCK_END",
  FLOW_SEQUENCE_START: "FLOW_SEQUENCE_START",
  FLOW_SEQUENCE_END: "FLOW_SEQUENCE_END",
  FLOW_MAPPING_START: "FLOW_MAPPING_START",
  FLOW_MAPPING_END: "FLOW_MAPPING_END",
  BLOCK_ENTRY: "BLOCK_ENTRY",
  FLOW_ENTRY: "FLOW_ENTRY",
  KEY: "KEY",
  VALUE: "VALUE",
  ALIAS: "ALIAS",
  ANCHOR: "ANCHOR",
  TAG: "TAG",
  SCALAR: "SCALAR",
});

const T = TokenType;

// Character codes.
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BOM = 0xfeff;
const EOF = -1;

const isBreak = (c) => c === LF || c === CR;
const isBlank = (c) => c === SPACE || c === TAB;
const isWsOrEnd = (c) => c === EOF || c === SPACE || c === TAB || c === LF || c === CR;
// , [ ] { }
const isFlowIndicator = (c) => c === 0x2c || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d;
const isDigit = (c) => c >= 0x30 && c <= 0x39;
const isHex = (c) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isWordChar = (c) => isDigit(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2d || c === 0x5f;

// Characters a plain scalar may not start with: - ? : , [ ] { } # & * ! | > ' " % @ `
// ('-', '?' and ':' may, when a non-space follows; see checkPlain).
const INDICATORS = new Set([..."-?:,[]{}#&*!|>'\"%@`"].map((c) => c.charCodeAt(0)));

// Characters allowed in a tag's URI part (YAML 1.2 ns-uri-char, plus '!').
const URI_CHARS = new Set([..."-;/?:@&=+$,_.!~*'()[]#%"].map((c) => c.charCodeAt(0)));

// Double-quoted escapes with a fixed replacement.
const ESCAPES = {
  0x30: "\0", // 0
  0x61: "\x07", // a
  0x62: "\b", // b
  0x74: "\t", // t
  0x09: "\t", // a literal tab after the backslash
  0x6e: "\n", // n
  0x76: "\v", // v
  0x66: "\f", // f
  0x72: "\r", // r
  0x65: "\x1b", // e
  0x20: " ", // space
  0x22: '"',
  0x2f: "/",
  0x5c: "\\",
  0x4e: "\x85", // N
  0x5f: "\xa0", // _
  0x4c: "\u2028", // L
  0x50: "\u2029", // P
};
// Escapes followed by hex digits: \xXX, \uXXXX, \UXXXXXXXX.
const ESCAPE_DIGITS = { 0x78: 2, 0x75: 4, 0x55: 8 };

// An implicit key may be at most this many characters long (YAML 1.2, 7.4.2).
const MAX_SIMPLE_KEY = 1024;

export class Scanner {
  constructor(text) {
    this.src = text;
    this.len = text.length;
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0;
    if (text.charCodeAt(0) === BOM) {
      this.pos = 1;
      this.lineStart = 1;
    }

    this.tokens = [];
    this.tokensTaken = 0;
    this.done = false;

    // Open flow collections: their opening tokens, innermost last.
    this.flowLevel = 0;

    // The indentation stack. `indent` is the column (0-based) of the
    // innermost open block, -1 at the top level; `indents` holds the outer
    // ones. Each level remembers where its block began, for error messages.
    this.indent = -1;
    this.indentMark = null;
    this.indents = [];

    // May a simple key start here? True at the start of a line and after
    // '[', '{', ',', '?', '- ' (and ':' in block context).
    this.allowSimpleKey = true;
    // Possible simple keys, one per flow level: { tokenNumber, required, offset, line, col, mark }.
    this.simpleKeys = new Map();

    // In a flow collection, a ':' right after a quoted scalar or a closing
    // bracket is a value indicator even with no space after it ({"a":1}),
    // and even on the next line.
    this.jsonLike = false;

    // The type of the last token produced, and where a tab was used in the
    // current line's indentation (or after a block indicator on it).
    this.lastType = null;
    this.lastLine = 0;
    this.tabAt = null;

    // Has a token been read on the current line yet? Indentation only
    // matters for the first one.
    this.lineFirst = true;

    // The last scalar read, for messages about the ':' that follows it.
    this.lastScalar = null;

    this.comments = [];
  }

  // ── public: the token stream ─────────────────────────────────────────────

  /** True if the next token is one of `types` (or, with none given, if there is a next token). */
  check(...types) {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    if (this.tokens.length === 0) return false;
    if (types.length === 0) return true;
    return types.includes(this.tokens[0].type);
  }

  peek() {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    return this.tokens[0];
  }

  /** The token after the next one, if it has been scanned already (for messages). */
  peekSecond() {
    return this.tokens[1] ?? null;
  }

  next() {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    this.tokensTaken++;
    return this.tokens.shift();
  }

  // ── positions ────────────────────────────────────────────────────────────

  code(k = 0) {
    const i = this.pos + k;
    return i < this.len ? this.src.charCodeAt(i) : EOF;
  }

  /** 0-based column, which is what indentation is measured in. */
  col() {
    return this.pos - this.lineStart;
  }

  mark() {
    return { line: this.line, column: this.pos - this.lineStart + 1, offset: this.pos };
  }

  /** Consume one line break (CR, LF or CRLF), which is read as "\n". */
  scanLineBreak() {
    this.tabAt = null;
    if (this.code() === CR && this.code(1) === LF) this.pos += 2;
    else this.pos += 1;
    this.line++;
    this.lineStart = this.pos;
    return "\n";
  }

  /** '---' or '...' at the start of a line, followed by whitespace or the end. */
  atDocumentMarker() {
    if (this.pos !== this.lineStart) return false;
    const c = this.code();
    if (c !== 0x2d && c !== 0x2e) return false;
    return this.code(1) === c && this.code(2) === c && isWsOrEnd(this.code(3));
  }

  token(type, start, extra = {}) {
    return { type, start, end: this.mark(), ...extra };
  }

  error(code, message, fields = {}) {
    const here = this.mark();
    return new YamlHippoError(code, message, {
      ...here,
      endOffset: Math.min(here.offset + 1, this.len),
      found: describeChar(this.pos < this.len ? String.fromCodePoint(this.src.codePointAt(this.pos)) : ""),
      ...fields,
    });
  }

  // ── simple keys ──────────────────────────────────────────────────────────

  needMoreTokens() {
    if (this.done) return false;
    if (this.tokens.length === 0) return true;
    // A token that may yet turn out to be a key cannot be handed out until
    // the scanner has seen whether a ':' follows it.
    this.staleSimpleKeys();
    return this.nextPossibleSimpleKey() === this.tokensTaken;
  }

  nextPossibleSimpleKey() {
    let min = null;
    for (const key of this.simpleKeys.values()) {
      if (min === null || key.tokenNumber < min) min = key.tokenNumber;
    }
    return min;
  }

  /** A possible key stops being possible at the end of its line, or past 1024 characters. */
  staleSimpleKeys() {
    if (this.simpleKeys.size === 0) return;
    for (const [level, key] of this.simpleKeys) {
      if (key.line !== this.line || this.pos - key.offset > MAX_SIMPLE_KEY) {
        if (key.required) throw this.expectedColon(key);
        this.simpleKeys.delete(level);
      }
    }
  }

  saveSimpleKey() {
    // In block context, a token at the block's own indentation MUST be a
    // key: the block is a mapping, and there is nothing else it could be.
    const required = this.flowLevel === 0 && this.indent === this.col();
    if (!this.allowSimpleKey) return;
    this.removeSimpleKey();
    this.simpleKeys.set(this.flowLevel, {
      tokenNumber: this.tokensTaken + this.tokens.length,
      required,
      offset: this.pos,
      line: this.line,
      col: this.col(),
      mark: this.mark(),
    });
  }

  removeSimpleKey() {
    const key = this.simpleKeys.get(this.flowLevel);
    if (key === undefined) return;
    if (key.required) throw this.expectedColon(key);
    this.simpleKeys.delete(this.flowLevel);
  }

  /** A line at a mapping's indentation that never reached its ':'. */
  expectedColon(key) {
    const token = this.tokens[key.tokenNumber - this.tokensTaken];
    const what = token && token.type === T.SCALAR ? `'${clip(firstLine(token.raw))}'` : "this entry";
    const lineEnd = lineEndOf(this.src, key.offset);
    return new YamlHippoError("EXPECTED_COLON", `expected ':' after ${what}`, {
      ...key.mark,
      endOffset: token ? token.end.offset : lineEnd,
      expected: ["':'"],
      found: "end of line",
      hint:
        "This line is at the mapping's indentation, so it must be a 'key: value' entry. " +
        "Add the ':' — or, if it continues the value above, indent it further.",
    });
  }

  // ── indentation ──────────────────────────────────────────────────────────

  /** Close every block indented deeper than `col`; returns the closed levels, innermost first. */
  unwindIndent(col) {
    const popped = [];
    if (this.flowLevel > 0) return popped;
    while (this.indent > col) {
      popped.push({ indent: this.indent, mark: this.indentMark });
      const here = this.mark();
      this.tokens.push({ type: T.BLOCK_END, start: here, end: here });
      const outer = this.indents.pop();
      this.indent = outer.indent;
      this.indentMark = outer.mark;
    }
    return popped;
  }

  addIndent(col, mark) {
    if (this.indent >= col) return false;
    this.indents.push({ indent: this.indent, mark: this.indentMark });
    this.indent = col;
    this.indentMark = mark;
    return true;
  }

  /**
   * A dedent closed blocks but did not land on an open one:
   *
   *   a:
   *       b: 1
   *     c: 2      ← 2 spaces; the blocks open are at 4 and 0
   *
   * Names the nearest open level (the deeper one on a tie: the line is most
   * likely meant as a sibling of the line above it).
   */
  indentMismatch(col, popped) {
    const levels = popped.map((p) => ({ indent: p.indent, mark: p.mark }));
    if (this.indent >= 0) levels.push({ indent: this.indent, mark: this.indentMark });
    let best = levels[0];
    for (const level of levels) {
      if (Math.abs(level.indent - col) < Math.abs(best.indent - col)) best = level;
    }
    const others = levels.filter((l) => l !== best).map((l) => l.indent);
    const here = this.mark();
    const where = best.mark ? ` (line ${best.mark.line})` : "";
    return new YamlHippoError("INDENT_MISMATCH", `indented ${spaces(col)} but siblings use ${best.indent}`, {
      ...here,
      offset: this.lineStart,
      column: 1,
      endOffset: this.pos,
      expected: levels.map((l) => `${l.indent}`),
      found: spaces(col),
      opener: best.mark,
      indent: { found: col, expected: levels.map((l) => l.indent) },
      hint:
        `No open block is indented ${spaces(col)}. The nearest starts at ${spaces(best.indent)}${where}` +
        (others.length ? `; the others open here use ${others.join(" and ")}.` : ".") +
        " Line this up with the entries it belongs with.",
    });
  }

  /**
   * A line indented deeper than the block it is in, which YAML reads as part
   * of the previous line's value — found when its ':' turns up:
   *
   *   a: 1
   *     b: 2      ← "1 b" would be the key
   */
  overIndented(lineIndent, line) {
    const block = this.indentMark;
    return new YamlHippoError("INDENT_MISMATCH", `indented ${spaces(lineIndent)} but siblings use ${this.indent}`, {
      line,
      column: 1,
      offset: this.lineStart,
      endOffset: this.lineStart + lineIndent,
      expected: [`${this.indent}`],
      found: spaces(lineIndent),
      opener: block,
      indent: { found: lineIndent, expected: [this.indent] },
      hint:
        `This line is indented deeper than its siblings${block ? ` (line ${block.line})` : ""}, so YAML reads it ` +
        "as the continuation of the value on the line above. Indent it to match its siblings — or, if it " +
        "belongs under the line above, give that line a ':' with nothing after it.",
    });
  }

  // ── the dispatcher ───────────────────────────────────────────────────────

  fetchMoreTokens() {
    this.scanToNextToken();
    this.staleSimpleKeys();

    const first = this.lineFirst;
    this.lineFirst = false;
    this.afterJson = this.jsonLike;
    this.jsonLike = false;
    const col = this.col();
    const c = this.code();

    if (this.flowLevel === 0 && first) {
      const popped = this.unwindIndent(col);
      if (popped.length > 0 && col > this.indent && c !== EOF && !this.atDocumentMarker()) {
        if (this.tabAt && this.tabAt.line === this.line) throw this.tabIndent();
        throw this.indentMismatch(col, popped);
      }
    } else {
      this.unwindIndent(col);
    }
    this.dispatch(c, col, first);
    const last = this.tokens[this.tokens.length - 1];
    if (last) {
      this.lastType = last.type;
      this.lastLine = last.end.line;
    }
  }

  dispatch(c, col, first) {
    if (c === EOF) return this.fetchStreamEnd();
    if (c === 0x25 /* % */ && col === 0) return this.fetchDirective();
    if (this.atDocumentMarker()) return this.fetchDocumentIndicator(c === 0x2d ? T.DOC_START : T.DOC_END);

    const next = this.code(1);
    switch (c) {
      case 0x5b: // [
        return this.fetchFlowCollectionStart(T.FLOW_SEQUENCE_START);
      case 0x7b: // {
        return this.fetchFlowCollectionStart(T.FLOW_MAPPING_START);
      case 0x5d: // ]
        return this.fetchFlowCollectionEnd(T.FLOW_SEQUENCE_END);
      case 0x7d: // }
        return this.fetchFlowCollectionEnd(T.FLOW_MAPPING_END);
      case 0x2c: // ,
        return this.fetchFlowEntry();
      case 0x2d: // -
        if (isWsOrEnd(next)) return this.fetchBlockEntry();
        break;
      case 0x3f: // ?
        if (isWsOrEnd(next)) return this.fetchKey();
        break;
      case 0x3a: // :
        if (this.checkValue()) return this.fetchValue(first);
        break;
      case 0x2a: // *
        return this.fetchAnchor(T.ALIAS);
      case 0x26: // &
        return this.fetchAnchor(T.ANCHOR);
      case 0x21: // !
        return this.fetchTag();
      case 0x7c: // |
      case 0x3e: // >
        if (this.flowLevel === 0) return this.fetchBlockScalar(c);
        throw this.error("BLOCK_IN_FLOW", `a block scalar ('${String.fromCharCode(c)}') can't go inside a flow collection`, {
          hint: "Inside [ ] and { } every value is written inline. Quote the text instead.",
        });
      case 0x27: // '
      case 0x22: // "
        return this.fetchFlowScalar(c === 0x22);
      default:
    }
    if (this.checkPlain(c, next)) return this.fetchPlain();
    throw this.unexpectedChar(c);
  }

  unexpectedChar(c) {
    const ch = String.fromCharCode(c);
    if (c === 0x40 || c === 0x60) {
      return this.error("RESERVED_CHAR", `'${ch}' is reserved in YAML and can't start a value`, {
        hint: `Quote the value: "${ch}…".`,
      });
    }
    if (c === 0x25) {
      return this.error("UNEXPECTED_CHAR", "'%' can't start a value", {
        hint: "'%' starts a directive only at the start of a line before '---'. Quote the value if '%' is part of it.",
      });
    }
    if (c === 0x3a || c === 0x3f || c === 0x2d) {
      return this.error("UNEXPECTED_CHAR", `unexpected '${ch}'`, {
        hint: `Quote the value if '${ch}' is part of it.`,
      });
    }
    return this.error("UNEXPECTED_CHAR", `unexpected ${describeChar(ch)}`);
  }

  // ── whitespace and comments ──────────────────────────────────────────────

  scanToNextToken() {
    for (;;) {
      let c = this.code();
      while (isBlank(c)) {
        if (c === TAB && this.flowLevel === 0 && this.tabAt?.line !== this.line && (this.lineFirst || this.afterBlockIndicator())) {
          this.tabAt = this.mark();
        }
        this.pos++;
        c = this.code();
      }
      if (c === 0x23 /* # */) {
        if (this.pos > this.lineStart && !isBlank(this.src.charCodeAt(this.pos - 1))) {
          throw this.error("UNEXPECTED_CHAR", "'#' straight after a value", {
            hint: "A comment needs a space before its '#'. Add one, or quote the value if '#' is part of it.",
          });
        }
        this.scanComment();
        c = this.code();
      }
      if (isBreak(c)) {
        this.scanLineBreak();
        if (this.flowLevel === 0) this.allowSimpleKey = true;
        this.lineFirst = true;
        continue;
      }
      return;
    }
  }

  /** After '- ', '? ' or ': ' in block context, whitespace is (compact) indentation too. */
  afterBlockIndicator() {
    const t = this.lastType;
    return (t === T.BLOCK_ENTRY || t === T.KEY || t === T.VALUE) && this.lastLine === this.line;
  }

  /**
   * A tab in the indentation is only an error once block structure depends
   * on it: when a '- ' entry, a '? ' key or an implicit key starts after it.
   * Blank and comment lines, flow collections (JSON indented with tabs is
   * valid YAML) and a value that merely continues are all fine.
   */
  checkTab(offset) {
    if (this.flowLevel === 0 && this.tabAt && this.tabAt.line === this.line && this.tabAt.offset < offset) throw this.tabIndent();
  }

  tabIndent() {
    const at = this.tabAt;
    return new YamlHippoError("TAB_INDENT", "a tab is used for indentation", {
      ...at,
      endOffset: at.offset + 1,
      found: "a tab",
      expected: ["spaces"],
      hint: "YAML indentation must be spaces; a tab here is not allowed. Replace it with spaces (Fix paste does this for the whole document).",
    });
  }

  scanComment() {
    const start = this.mark();
    const ownLine = this.lineFirst;
    let end = this.pos;
    while (end < this.len && !isBreak(this.src.charCodeAt(end))) end++;
    this.comments.push({
      text: this.src.slice(this.pos + 1, end),
      line: start.line,
      column: start.column,
      offset: start.offset,
      endOffset: end,
      ownLine,
    });
    this.pos = end;
  }

  // ── fetchers ─────────────────────────────────────────────────────────────

  fetchStreamEnd() {
    this.unwindIndent(-1);
    this.removeSimpleKey();
    this.allowSimpleKey = false;
    this.simpleKeys.clear();
    const here = this.mark();
    this.tokens.push({ type: T.STREAM_END, start: here, end: here });
    this.done = true;
  }

  fetchDirective() {
    this.unwindIndent(-1);
    this.removeSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanDirective());
  }

  fetchDocumentIndicator(type) {
    this.unwindIndent(-1);
    this.removeSimpleKey();
    this.allowSimpleKey = false;
    const start = this.mark();
    this.pos += 3;
    this.tokens.push(this.token(type, start, { raw: type === T.DOC_START ? "---" : "..." }));
    if (type === T.DOC_END) {
      while (isBlank(this.code())) this.pos++;
      const c = this.code();
      if (c !== EOF && !isBreak(c) && c !== 0x23) {
        throw this.error("TRAILING_CONTENT", "unexpected text after '...'", {
          hint: "'...' ends a document and must be alone on its line (a comment may follow).",
        });
      }
    }
  }

  fetchFlowCollectionStart(type) {
    this.saveSimpleKey();
    this.flowLevel++;
    this.allowSimpleKey = true;
    const start = this.mark();
    this.pos++;
    this.tokens.push(this.token(type, start, { raw: type === T.FLOW_SEQUENCE_START ? "[" : "{" }));
  }

  fetchFlowCollectionEnd(type) {
    const raw = type === T.FLOW_SEQUENCE_END ? "]" : "}";
    if (this.flowLevel === 0) {
      throw this.error("MISMATCHED_CLOSE", `'${raw}' has no matching '${raw === "]" ? "[" : "{"}'`, {
        hint: `There is no open ${raw === "]" ? "[ list" : "{ mapping"} for it to close. Quote the value if '${raw}' is part of it.`,
      });
    }
    this.removeSimpleKey();
    this.flowLevel--;
    this.allowSimpleKey = false;
    const start = this.mark();
    this.pos++;
    this.tokens.push(this.token(type, start, { raw }));
    if (this.flowLevel > 0) this.jsonLike = true;
  }

  fetchFlowEntry() {
    if (this.flowLevel === 0) {
      throw this.error("UNEXPECTED_CHAR", "unexpected ','", {
        hint: "',' only separates items inside [ ] or { }. Quote the value if the comma is part of it.",
      });
    }
    this.allowSimpleKey = true;
    this.removeSimpleKey();
    const start = this.mark();
    this.pos++;
    this.tokens.push(this.token(T.FLOW_ENTRY, start, { raw: "," }));
  }

  fetchBlockEntry() {
    const start = this.mark();
    if (this.flowLevel > 0) {
      throw this.error("BLOCK_IN_FLOW", "a '- ' list entry can't go inside a flow collection", {
        hint: "Inside [ ] items are separated by commas: [a, b]. Quote the value if '-' is part of it.",
      });
    }
    this.checkTab(this.pos);
    if (!this.allowSimpleKey) {
      throw this.error("ENTRY_NOT_ALLOWED", "a '- ' list entry can't start here", {
        expected: ["a value"],
        found: "'- '",
        hint: "A block list starts on its own line, indented under its key:\n  key:\n    - item",
      });
    }
    if (this.addIndent(this.col(), start)) this.tokens.push({ type: T.BLOCK_SEQUENCE_START, start, end: start });
    this.allowSimpleKey = true;
    this.removeSimpleKey();
    this.pos++;
    this.tokens.push(this.token(T.BLOCK_ENTRY, start, { raw: "-" }));
  }

  fetchKey() {
    const start = this.mark();
    if (this.flowLevel === 0) {
      this.checkTab(this.pos);
      if (!this.allowSimpleKey) {
        throw this.error("MAPPING_VALUE_NOT_ALLOWED", "a '? ' mapping key can't start here", {
          hint: "An explicit '? ' key starts its own line. Quote the value if '?' is part of it.",
        });
      }
      if (this.addIndent(this.col(), start)) this.tokens.push({ type: T.BLOCK_MAPPING_START, start, end: start });
    }
    this.allowSimpleKey = this.flowLevel === 0;
    this.removeSimpleKey();
    this.pos++;
    this.tokens.push(this.token(T.KEY, start, { raw: "?" }));
  }

  /** ':' followed by whitespace — or, in a flow collection, by a flow indicator or after a JSON-like key. */
  checkValue() {
    const next = this.code(1);
    if (isWsOrEnd(next)) return true;
    if (this.flowLevel === 0) return false;
    return isFlowIndicator(next) || this.afterJson;
  }

  fetchValue(first) {
    const start = this.mark();
    const key = this.simpleKeys.get(this.flowLevel);
    if (key !== undefined) {
      // The possible key was one: put KEY (and, for a new block mapping,
      // BLOCK_MAPPING_START) in front of it.
      this.simpleKeys.delete(this.flowLevel);
      if (this.flowLevel === 0 && this.tabAt && this.tabAt.line === key.line && this.tabAt.offset < key.offset) throw this.tabIndent();
      const at = key.tokenNumber - this.tokensTaken;
      this.tokens.splice(at, 0, { type: T.KEY, start: key.mark, end: key.mark });
      if (this.flowLevel === 0 && this.addIndent(key.col, key.mark)) {
        this.tokens.splice(at, 0, { type: T.BLOCK_MAPPING_START, start: key.mark, end: key.mark });
      }
      this.allowSimpleKey = false;
    } else {
      if (this.flowLevel === 0) {
        // A ':' with no key before it is only fine at the start of a line
        // (an empty key, or the value of an explicit '? ' key), or straight
        // after '- ' or '? ' (an entry, or a key, that is a mapping with an
        // empty key).
        const afterIndicator = this.allowSimpleKey && (this.lastType === T.BLOCK_ENTRY || this.lastType === T.KEY);
        if (!first && !afterIndicator) throw this.valueNotAllowed();
        this.checkTab(this.pos);
        if (this.addIndent(this.col(), start)) this.tokens.push({ type: T.BLOCK_MAPPING_START, start, end: start });
      }
      this.allowSimpleKey = this.flowLevel === 0;
      this.removeSimpleKey();
    }
    this.pos++;
    this.tokens.push(this.token(T.VALUE, start, { raw: ":" }));
  }

  /**
   * A ': ' where no key can be: after a value on the same line (a: b: c), or
   * after a plain value that ran on from the line above — which is how an
   * over-indented line reads, and gets the indentation message.
   */
  valueNotAllowed() {
    const scalar = this.lastScalar;
    const lineIndent = leadingSpaces(this.src, this.lineStart);
    if (scalar && scalar.start.line < this.line && scalar.end.line === this.line) {
      if (this.indent >= 0 && lineIndent > this.indent) throw this.overIndented(lineIndent, this.line);
      return this.error("MAPPING_VALUE_NOT_ALLOWED", "an implicit key can't span lines", {
        found: "':'",
        opener: scalar.start,
        hint:
          `The text from line ${scalar.start.line} runs on to this line, so it can't be a key. ` +
          "Put the key on one line, or start it with '? ' for a multi-line key.",
      });
    }
    const what = scalar && scalar.end.line === this.line ? `'${clip(firstLine(scalar.raw))}'` : "the value before it";
    return this.error("MAPPING_VALUE_NOT_ALLOWED", `a ':' here would make ${what} a key, but it is already a value`, {
      found: "':'",
      hint:
        "A nested mapping can't start on the same line as its key. Move it to its own line, indented under " +
        "the key — or, if the ':' is part of the text, quote the whole value.",
    });
  }

  fetchAnchor(type) {
    this.saveSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanAnchor(type));
  }

  fetchTag() {
    this.saveSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanTag());
  }

  fetchBlockScalar(c) {
    this.allowSimpleKey = true;
    this.removeSimpleKey();
    this.tokens.push(this.scanBlockScalar(c === 0x3e));
  }

  fetchFlowScalar(double) {
    this.saveSimpleKey();
    this.allowSimpleKey = false;
    const token = this.scanFlowScalar(double);
    this.lastScalar = token;
    this.tokens.push(token);
    if (this.flowLevel > 0) this.jsonLike = true;
  }

  checkPlain(c, next) {
    if (!INDICATORS.has(c)) return true;
    if (c === 0x2d) return !isWsOrEnd(next) && (this.flowLevel === 0 || !isFlowIndicator(next));
    if (c === 0x3f || c === 0x3a) return !isWsOrEnd(next) && (this.flowLevel === 0 || !isFlowIndicator(next));
    return false;
  }

  fetchPlain() {
    this.saveSimpleKey();
    this.allowSimpleKey = false;
    const token = this.scanPlain();
    this.lastScalar = token;
    this.tokens.push(token);
  }

  // ── scalars ──────────────────────────────────────────────────────────────

  /**
   * A plain (unquoted) scalar. Ends at ': ', ' #', a flow indicator inside a
   * flow collection, or a line that is not indented deeper than the block it
   * is in. Line breaks inside it fold: one break is a space, n breaks are
   * n−1 newlines.
   */
  scanPlain() {
    const start = this.mark();
    let end = start;
    const minCol = this.indent + 1;
    const flow = this.flowLevel > 0;
    let out = "";
    let pending = "";
    for (;;) {
      if (this.code() === 0x23) break;
      let length = 0;
      for (;;) {
        const c = this.code(length);
        if (c === EOF || isBlank(c) || isBreak(c)) break;
        if (c === 0x3a) {
          const n = this.code(length + 1);
          if (isWsOrEnd(n) || (flow && isFlowIndicator(n))) break;
        }
        if (flow && isFlowIndicator(c)) break;
        length++;
      }
      if (length === 0) break;
      this.allowSimpleKey = false;
      this.lineFirst = false;
      out += pending + this.src.slice(this.pos, this.pos + length);
      this.pos += length;
      end = this.mark();
      pending = this.scanPlainSpaces();
      if (pending === null || this.code() === 0x23 || (!flow && this.col() < minCol)) break;
    }
    return { type: T.SCALAR, start, end, value: out, style: "plain", raw: this.src.slice(start.offset, end.offset) };
  }

  /** The whitespace after a run of plain text: what it folds to, or null if the scalar must end. */
  scanPlainSpaces() {
    const from = this.pos;
    while (isBlank(this.code())) this.pos++;
    const whitespace = this.src.slice(from, this.pos);
    if (!isBreak(this.code())) return whitespace === "" ? null : whitespace;

    this.scanLineBreak();
    this.allowSimpleKey = true;
    this.lineFirst = true;
    if (this.atDocumentMarker()) return null;
    let breaks = "";
    for (;;) {
      const c = this.code();
      if (c === SPACE) this.pos++;
      else if (c === TAB) {
        if (this.flowLevel === 0 && this.tabAt?.line !== this.line) this.tabAt = this.mark();
        this.pos++;
      } else if (isBreak(c)) {
        this.scanLineBreak();
        breaks += "\n";
        if (this.atDocumentMarker()) return null;
      } else break;
    }
    return breaks === "" ? " " : breaks;
  }

  /** A single- or double-quoted scalar. */
  scanFlowScalar(double) {
    const start = this.mark();
    const quote = double ? 0x22 : 0x27;
    this.pos++;
    let out = this.scanFlowNonSpaces(double, start);
    while (this.code() !== quote) {
      out += this.scanFlowSpaces(double, start);
      out += this.scanFlowNonSpaces(double, start);
    }
    this.pos++;
    const end = this.mark();
    return { type: T.SCALAR, start, end, value: out, style: double ? "double" : "single", raw: this.src.slice(start.offset, end.offset) };
  }

  scanFlowNonSpaces(double, start) {
    let out = "";
    for (;;) {
      let length = 0;
      for (;;) {
        const c = this.code(length);
        if (c === EOF || c === 0x27 || c === 0x22 || c === 0x5c || isBlank(c) || isBreak(c)) break;
        length++;
      }
      if (length > 0) {
        out += this.src.slice(this.pos, this.pos + length);
        this.pos += length;
      }
      const c = this.code();
      if (!double && c === 0x27 && this.code(1) === 0x27) {
        out += "'";
        this.pos += 2;
      } else if ((double && c === 0x27) || (!double && (c === 0x22 || c === 0x5c))) {
        out += String.fromCharCode(c);
        this.pos++;
      } else if (double && c === 0x5c) {
        out += this.scanEscape(start);
      } else {
        return out;
      }
    }
  }

  scanEscape(start) {
    const at = this.mark();
    this.pos++;
    const e = this.code();
    const fixed = ESCAPES[e];
    if (fixed !== undefined) {
      this.pos++;
      return fixed;
    }
    const digits = ESCAPE_DIGITS[e];
    if (digits !== undefined) {
      this.pos++;
      for (let k = 0; k < digits; k++) {
        if (!isHex(this.code(k))) {
          throw new YamlHippoError("BAD_ESCAPE", `'\\${String.fromCharCode(e)}' needs ${digits} hex digits`, {
            ...at,
            endOffset: this.pos + k + 1,
            found: describeChar(this.pos + k < this.len ? this.src[this.pos + k] : ""),
            expected: ["a hex digit"],
            opener: start,
            hint: 'For a literal backslash write \\\\ (or use single quotes, where \\ is just a backslash).',
          });
        }
      }
      const cp = parseInt(this.src.slice(this.pos, this.pos + digits), 16);
      this.pos += digits;
      if (digits === 8 && cp > 0x10ffff) {
        throw new YamlHippoError("BAD_ESCAPE", "'\\U' escape is past the last Unicode code point", { ...at, endOffset: this.pos });
      }
      return digits === 8 ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    }
    if (isBreak(e)) {
      // An escaped line break: the string continues on the next line with no space.
      this.scanLineBreak();
      return this.scanFlowBreaks(start);
    }
    const ch = e === EOF ? "" : String.fromCharCode(e);
    throw new YamlHippoError("BAD_ESCAPE", `'\\${ch}' is not a valid escape`, {
      ...at,
      endOffset: Math.min(this.pos + 1, this.len),
      found: describeChar(ch),
      opener: start,
      hint: 'Valid escapes include \\" \\\\ \\n \\t \\xXX \\uXXXX. For a literal backslash write \\\\, or use single quotes.',
    });
  }

  scanFlowSpaces(double, start) {
    const from = this.pos;
    while (isBlank(this.code())) this.pos++;
    const whitespace = this.src.slice(from, this.pos);
    const c = this.code();
    if (c === EOF) throw this.unterminated(double, start);
    if (isBreak(c)) {
      this.scanLineBreak();
      const breaks = this.scanFlowBreaks(start, double);
      return breaks === "" ? " " : breaks;
    }
    return whitespace;
  }

  scanFlowBreaks(start, double = true) {
    let out = "";
    for (;;) {
      if (this.atDocumentMarker()) throw this.unterminated(double, start);
      while (this.code() === SPACE) this.pos++;
      const indented = this.col();
      while (isBlank(this.code())) this.pos++;
      if (this.flowLevel === 0 && indented <= this.indent && !isBreak(this.code()) && this.code() !== EOF) {
        // No closing quote anywhere ahead: that, not the indentation, is the problem.
        if (this.src.indexOf(double ? '"' : "'", this.pos) === -1) throw this.unterminated(double, start, true);
        throw new YamlHippoError("INDENT_MISMATCH", `indented ${spaces(indented)} but this string's lines need more than ${this.indent}`, {
          line: this.line,
          column: 1,
          offset: this.lineStart,
          endOffset: this.pos,
          found: spaces(indented),
          expected: [`${this.indent + 1}`],
          opener: start,
          indent: { found: indented, expected: [this.indent + 1] },
          hint: `The string opened at line ${start.line} col ${start.column} continues here. Indent its continuation lines deeper than its key — or check for a missing closing quote above.`,
        });
      }
      if (isBreak(this.code())) {
        this.scanLineBreak();
        out += "\n";
      } else return out;
    }
  }

  unterminated(double, start, toEnd = false) {
    const q = double ? '"' : "'";
    if (toEnd) this.pos = this.len;
    return new YamlHippoError("UNTERMINATED_STRING", `the ${q} string is never closed`, {
      ...start,
      endOffset: start.offset + 1,
      expected: [`a closing ${q}`],
      found: this.pos >= this.len ? "end of input" : "'---' or '...'",
      opener: start,
      hint: `The ${q} at line ${start.line} col ${start.column} opens a string that runs to the end of the ${this.pos >= this.len ? "input" : "document"}. Add the closing ${q}${double ? "" : " (inside '…' a single quote is written '')"}.`,
    });
  }

  /** A literal (|) or folded (>) block scalar, with its chomping and indentation indicators. */
  scanBlockScalar(folded) {
    const start = this.mark();
    this.pos++;

    // Header: an optional chomping indicator (+ keep, - strip) and an
    // optional indentation indicator (1–9), in either order.
    let chomping = null;
    let increment = null;
    const readChomp = () => {
      const c = this.code();
      if (c === 0x2b || c === 0x2d) {
        chomping = c === 0x2b;
        this.pos++;
        return true;
      }
      return false;
    };
    const readIncrement = () => {
      const c = this.code();
      if (!isDigit(c)) return false;
      if (c === 0x30) {
        throw this.error("BAD_BLOCK_HEADER", "the indentation indicator must be 1–9, not 0", { expected: ["1–9"] });
      }
      increment = c - 0x30;
      this.pos++;
      return true;
    };
    if (readChomp()) readIncrement();
    else if (readIncrement()) readChomp();
    if (!isWsOrEnd(this.code())) {
      throw this.error("BAD_BLOCK_HEADER", `unexpected ${describeChar(this.src[this.pos])} after '${folded ? ">" : "|"}'`, {
        expected: ["'+'", "'-'", "1–9", "end of line"],
        hint: "After | or > only a chomping indicator (+ or -), an indentation digit (1–9) and a comment may follow on that line.",
      });
    }
    while (isBlank(this.code())) this.pos++;
    if (this.code() === 0x23) this.scanComment();
    if (!isBreak(this.code()) && this.code() !== EOF) {
      throw this.error("BAD_BLOCK_HEADER", "expected a comment or the end of the line after the block scalar header");
    }
    const headerEnd = this.mark();
    if (isBreak(this.code())) this.scanLineBreak();

    const minIndent = this.indent + 1;
    let indent;
    let breaks;
    if (increment === null) {
      let maxIndent = 0;
      breaks = "";
      for (;;) {
        const c = this.code();
        if (c === SPACE) {
          this.pos++;
          if (this.col() > maxIndent) maxIndent = this.col();
        } else if (isBreak(c)) {
          breaks += this.scanLineBreak();
        } else break;
      }
      indent = Math.max(minIndent, maxIndent);
      // On a content line, only the spaces up to the indent were consumed
      // above if the line is the most indented so far; that is the line
      // whose indentation sets the block's.
    } else {
      indent = Math.max(this.indent, 0) + increment;
      if (this.indent < 0) indent = increment;
      breaks = this.scanBlockBreaks(indent);
    }

    let out = "";
    let lineBreak = "";
    let end = headerEnd;
    while (this.col() === indent && this.code() !== EOF && !this.atDocumentMarker()) {
      out += breaks;
      const leadingNonSpace = !isBlank(this.code());
      let length = 0;
      while (this.pos + length < this.len && !isBreak(this.src.charCodeAt(this.pos + length))) length++;
      out += this.src.slice(this.pos, this.pos + length);
      this.pos += length;
      end = this.mark();
      // A last line with no line break still ends like one.
      lineBreak = isBreak(this.code()) ? this.scanLineBreak() : "\n";
      breaks = this.scanBlockBreaks(indent);
      if (this.col() === indent && this.code() !== EOF && !this.atDocumentMarker()) {
        if (folded && lineBreak === "\n" && leadingNonSpace && !isBlank(this.code())) {
          if (breaks === "") out += " ";
        } else {
          out += lineBreak;
        }
      } else break;
    }
    if (chomping !== false) out += lineBreak;
    if (chomping === true) out += breaks;
    this.lineFirst = true;
    return {
      type: T.SCALAR,
      start,
      end,
      value: out,
      style: folded ? "folded" : "literal",
      raw: this.src.slice(start.offset, end.offset),
      chomping: chomping === null ? "clip" : chomping ? "keep" : "strip",
      blockIndent: indent,
    };
  }

  scanBlockBreaks(indent) {
    let breaks = "";
    while (this.col() < indent && this.code() === SPACE) this.pos++;
    while (isBreak(this.code())) {
      breaks += this.scanLineBreak();
      while (this.col() < indent && this.code() === SPACE) this.pos++;
    }
    return breaks;
  }

  // ── anchors, aliases, tags, directives ───────────────────────────────────

  scanAnchor(type) {
    const start = this.mark();
    const sigil = type === T.ALIAS ? "*" : "&";
    this.pos++;
    let length = 0;
    for (;;) {
      const c = this.code(length);
      if (isWsOrEnd(c) || isFlowIndicator(c)) break;
      length++;
    }
    if (length === 0) {
      throw this.error("BAD_ANCHOR", `expected ${type === T.ALIAS ? "an alias" : "an anchor"} name after '${sigil}'`, {
        expected: ["a name"],
        hint: `Write ${sigil}name, with no space. Quote the value if '${sigil}' is part of it.`,
      });
    }
    const name = this.src.slice(this.pos, this.pos + length);
    this.pos += length;
    return this.token(type, start, { value: name, raw: sigil + name });
  }

  scanTag() {
    const start = this.mark();
    const flow = this.flowLevel > 0;
    const ends = (c) => isWsOrEnd(c) || (flow && isFlowIndicator(c));
    let handle;
    let suffix;
    let verbatim = false;
    if (this.code(1) === 0x3c /* < */) {
      this.pos += 2;
      suffix = this.scanTagUri(start, false);
      if (this.code() !== 0x3e) throw this.error("BAD_TAG", "expected '>' to close the verbatim tag", { expected: ["'>'"] });
      this.pos++;
      handle = null;
      verbatim = true;
    } else if (ends(this.code(1))) {
      // The non-specific tag "!": "this is a string, don't resolve it".
      this.pos++;
      handle = null;
      suffix = "!";
    } else {
      let length = 1;
      let useHandle = false;
      for (;;) {
        const c = this.code(length);
        if (ends(c)) break;
        if (c === 0x21) {
          useHandle = true;
          break;
        }
        length++;
      }
      if (useHandle) handle = this.scanTagHandle(start);
      else {
        handle = "!";
        this.pos++;
      }
      suffix = this.scanTagUri(start, true);
    }
    if (!ends(this.code())) {
      throw this.error("BAD_TAG", `expected a space after the tag but found ${describeChar(this.src[this.pos])}`, {
        expected: ["a space"],
      });
    }
    return this.token(T.TAG, start, { handle, suffix, verbatim, raw: this.src.slice(start.offset, this.pos) });
  }

  scanTagHandle(start) {
    if (this.code() !== 0x21) throw this.error("BAD_TAG", "expected '!' to start a tag handle", { opener: start });
    let length = 1;
    if (this.code(1) !== SPACE) {
      while (isWordChar(this.code(length))) length++;
      if (this.code(length) !== 0x21) {
        this.pos += length;
        throw this.error("BAD_TAG", "expected '!' to end the tag handle", { opener: start, expected: ["'!'"] });
      }
      length++;
    }
    const handle = this.src.slice(this.pos, this.pos + length);
    this.pos += length;
    return handle;
  }

  scanTagUri(start, flow) {
    let out = "";
    let from = this.pos;
    for (;;) {
      const c = this.code();
      if (c === 0x25 /* % */) {
        out += this.src.slice(from, this.pos);
        out += this.scanUriEscapes(start);
        from = this.pos;
        continue;
      }
      if (!(isWordChar(c) || URI_CHARS.has(c)) || (flow && isFlowIndicator(c))) break;
      this.pos++;
    }
    out += this.src.slice(from, this.pos);
    if (out === "") throw this.error("BAD_TAG", "expected a tag name", { opener: start, expected: ["a tag name"] });
    return out;
  }

  scanUriEscapes(start) {
    const bytes = [];
    while (this.code() === 0x25) {
      if (!isHex(this.code(1)) || !isHex(this.code(2))) {
        throw this.error("BAD_TAG", "a '%' in a tag must be followed by two hex digits", { opener: start });
      }
      bytes.push(parseInt(this.src.slice(this.pos + 1, this.pos + 3), 16));
      this.pos += 3;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    } catch {
      throw this.error("BAD_TAG", "the %-escapes in this tag are not valid UTF-8", { opener: start });
    }
  }

  scanDirective() {
    const start = this.mark();
    this.pos++;
    let length = 0;
    while (isWordChar(this.code(length))) length++;
    const name = this.src.slice(this.pos, this.pos + length);
    this.pos += length;
    if (name === "") throw this.error("BAD_DIRECTIVE", "expected a directive name after '%'", { expected: ["YAML", "TAG"] });
    let value = null;
    if (name === "YAML") {
      this.skipBlanksRequired("the version");
      const from = this.pos;
      while (isDigit(this.code())) this.pos++;
      const major = this.src.slice(from, this.pos);
      if (major === "" || this.code() !== 0x2e) throw this.error("BAD_DIRECTIVE", "expected a version like 1.2 after %YAML");
      this.pos++;
      const from2 = this.pos;
      while (isDigit(this.code())) this.pos++;
      const minor = this.src.slice(from2, this.pos);
      if (minor === "") throw this.error("BAD_DIRECTIVE", "expected a version like 1.2 after %YAML");
      value = [Number(major), Number(minor)];
    } else if (name === "TAG") {
      this.skipBlanksRequired("a tag handle");
      const handle = this.scanTagHandle(start);
      this.skipBlanksRequired("a tag prefix");
      const prefix = this.scanTagUri(start, false);
      value = [handle, prefix];
    } else {
      while (this.pos < this.len && !isBreak(this.code()) && this.code() !== 0x23) this.pos++;
    }
    const end = this.mark();
    while (isBlank(this.code())) this.pos++;
    if (this.code() === 0x23 && isBlank(this.src.charCodeAt(this.pos - 1))) this.scanComment();
    if (!isBreak(this.code()) && this.code() !== EOF) {
      throw this.error("BAD_DIRECTIVE", `unexpected ${describeChar(this.src[this.pos])} after the %${name} directive`);
    }
    return { type: T.DIRECTIVE, start, end, name, value, raw: this.src.slice(start.offset, end.offset) };
  }

  skipBlanksRequired(what) {
    if (!isBlank(this.code())) throw this.error("BAD_DIRECTIVE", `expected a space before ${what}`);
    while (isBlank(this.code())) this.pos++;
  }
}

/** The first line of some text, for quoting in a message. */
export function firstLine(text) {
  const i = text.search(/[\r\n]/);
  return i === -1 ? text : `${text.slice(0, i)}…`;
}

function lineEndOf(src, offset) {
  let i = offset;
  while (i < src.length && !isBreak(src.charCodeAt(i))) i++;
  return i;
}

function leadingSpaces(src, lineStart) {
  let i = lineStart;
  while (i < src.length && src.charCodeAt(i) === SPACE) i++;
  return i - lineStart;
}
