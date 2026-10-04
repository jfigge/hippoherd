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
 * parser.js — stage two: tokens in, AST out, or one precise error.
 *
 * Grammar (RFC 8259):
 *
 *   document := value EOF
 *   value    := object | array | STRING | NUMBER | TRUE | FALSE | NULL
 *   object   := '{' ( member ( ',' member )* )? '}'
 *   member   := STRING ':' value
 *   array    := '[' ( value ( ',' value )* )? ']'
 *
 * Hand-written descent over that grammar, with one deliberate difference from
 * the textbook shape: a nested object or array does NOT recurse through the
 * JavaScript call stack. Measured on Node 23 (V8), value → array → value
 * recursion overflows the call stack at about 3,800 levels of nesting, well
 * short of the 10,000 the depth guard promises — and a stack overflow is a
 * RangeError with no position, which is the opposite of what this parser is
 * for. So the "recursion" lives in this.stack: opening '{' or '[' pushes a
 * frame, the loop in parseValue always works on the innermost frame, and the
 * closing bracket pops it. That stack is also exactly what error reporting
 * needs: the JSON path, and the chain of containers still open.
 *
 * AST:
 *   { kind: 'object', entries: [{ key, keyToken, value }], start, end }
 *   { kind: 'array',  items: [node, …], start, end }
 *   { kind: 'string' | 'number' | 'boolean' | 'null', value, raw, start, end }
 *   start/end = { line, column, offset }; end is just past the node.
 *   Numbers keep their source text as `value` (see tokenizer.js).
 *
 * Duplicate keys are kept, in source order. Warnings — a duplicate key, a
 * number that loses precision — are the linter's (lint/linter.js), which the
 * parser calls as it reads when one is passed in: parse(text, { lint }).
 * Parsing stops at the first error: no recovery, one error per run.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { Tokenizer, TokenType as T } from "./tokenizer.js";
import { JsonHippoError, LEXICAL_CODES, describeToken, listExpected } from "./errors.js";
import { formatPath } from "../json-path.js";

/** Containers may nest this deep; one more is MAX_DEPTH. */
export const MAX_DEPTH = 10000;

const CLOSER = { object: T.RBRACE, array: T.RBRACKET };
const CLOSE_CHAR = { object: "}", array: "]" };
const OPEN_CHAR = { object: "{", array: "[" };

const KEY_HINT = "Object keys must be double-quoted strings.";

/**
 * Parse JSON text.
 * @param options { maxDepth, lint: a Linter, or null for no warnings }
 * @returns {{ ast, warnings, warningTotal, stats: { nodes, keys, depth } }}
 *          warnings is the linter's list (capped); warningTotal counts them all
 * @throws {JsonHippoError}
 */
export function parse(text, options) {
  return new Parser(text, options).parse();
}

/** start/end positions of a token, in the AST's { line, column, offset } shape. */
function startOf(token) {
  return { line: token.line, column: token.column, offset: token.offset };
}

function endOf(token) {
  return { line: token.line, column: token.column + (token.endOffset - token.offset), offset: token.endOffset };
}

/** "line 3, col 5" */
function at(pos) {
  return `line ${pos.line}, col ${pos.column}`;
}

class Parser {
  constructor(text, { maxDepth = MAX_DEPTH, lint = null } = {}) {
    this.tokens = new Tokenizer(text);
    this.maxDepth = maxDepth;
    // Open containers, outermost first. Each frame:
    //   { kind, node, open (the '{' / '[' token),
    //     key, keyToken  — the member being read (objects), or null between members
    //     index          — the item being read (arrays), or null between items }
    this.stack = [];
    this.lint = lint;
    lint?.begin(() => this.currentPath());
    this.nodeCount = 0;
    this.keyCount = 0;
    this.deepest = 0;
  }

  parse() {
    try {
      const ast = this.parseDocument();
      return {
        ast,
        warnings: this.lint?.warnings ?? [],
        warningTotal: this.lint?.total ?? 0,
        stats: { nodes: this.nodeCount, keys: this.keyCount, depth: this.deepest },
      };
    } catch (err) {
      // Lexical errors come up from the tokenizer knowing nothing about
      // structure. Give every error the path and open chain as they stood
      // when it was thrown (the stack is never unwound on the way out).
      if (err instanceof JsonHippoError) {
        if (err.path === null) err.path = this.currentPath();
        if (err.openStack.length === 0) err.openStack = this.openStack();
      }
      throw err;
    }
  }

  // ── document := value EOF ────────────────────────────────────────────────

  parseDocument() {
    const first = this.tokens.next();
    if (first.type === T.EOF) {
      throw new JsonHippoError("EMPTY_INPUT", "there is no JSON here — the input is empty", {
        line: 1,
        column: 1,
        offset: 0,
        expected: ["a value"],
        found: "end of input",
        path: "$",
      });
    }
    const root = this.parseValue(first);
    this.expectEnd();
    return root;
  }

  /** After the root value only EOF may follow. */
  expectEnd() {
    let token;
    try {
      token = this.tokens.next();
    } catch (err) {
      // `{"a":1}x` — whatever the stray text is, the problem is that it is there.
      if (err instanceof JsonHippoError && LEXICAL_CODES.has(err.code)) throw this.trailingContent(err, err.found, false, err.hint);
      throw err;
    }
    if (token.type !== T.EOF) throw this.trailingContent(token, describeToken(token), token.type === T.RBRACE || token.type === T.RBRACKET);
  }

  trailingContent(where, found, strayCloser = false, lexicalHint = null) {
    return new JsonHippoError("TRAILING_CONTENT", `unexpected ${found} after the end of the JSON value`, {
      ...startOf(where),
      endOffset: where.endOffset,
      expected: ["end of input"],
      found,
      path: "$",
      hint: strayCloser
        ? `There is an extra ${found}: the brackets do not balance.`
        : (lexicalHint ?? "Only one top-level value is allowed. Wrap several values in an array: [ … , … ]."),
    });
  }

  // ── value ────────────────────────────────────────────────────────────────

  /**
   * Read one complete value, starting with `token`, and return its node.
   *
   * Two phases alternate. "Start a value": a scalar finishes at once; an
   * opener pushes a frame and moves on to that container's first child.
   * "A value finished": hand it to the innermost container, then read what
   * follows it — ',' starts the next child, the right closer finishes the
   * container (which is itself a value that has just finished, one level up),
   * and anything else is an error. When a value finishes with no container
   * left open, it is the one this call was asked for.
   */
  parseValue(token) {
    for (;;) {
      let node = this.startValue(token);
      if (node === null) {
        token = this.beginFirstChild(this.top());
        continue;
      }
      for (;;) {
        const frame = this.top();
        if (frame === undefined) return node;
        this.addChild(frame, node);
        const after = this.nextAfterValue(frame);
        if (after.type === T.COMMA) {
          token = this.beginNextChild(frame, after);
          break;
        }
        node = this.closeContainer(frame, after);
      }
    }
  }

  /**
   * A scalar's node, an empty container's node, or null after opening a
   * container that has children to read.
   */
  startValue(token) {
    switch (token.type) {
      case T.STRING:
        return this.scalar("string", token.value, token);
      case T.NUMBER:
        return this.scalar("number", token.value, token);
      case T.TRUE:
      case T.FALSE:
        return this.scalar("boolean", token.value, token);
      case T.NULL:
        return this.scalar("null", null, token);
      case T.LBRACE:
        return this.openContainer("object", token);
      case T.LBRACKET:
        return this.openContainer("array", token);
      case T.EOF:
        throw this.unclosed();
      default:
        throw this.error("EXPECTED_VALUE", `expected a value but found ${describeToken(token)}`, token, {
          expected: ["a value"],
        });
    }
  }

  scalar(kind, value, token) {
    this.nodeCount++;
    const node = { kind, value, raw: token.raw, start: startOf(token), end: endOf(token) };
    this.lint?.value(node);
    return node;
  }

  // ── object / array ───────────────────────────────────────────────────────

  openContainer(kind, open) {
    if (this.stack.length >= this.maxDepth) {
      throw this.error("MAX_DEPTH", `nesting is deeper than ${this.maxDepth.toLocaleString("en-US")} levels`, open, {
        hint: "This many levels of nesting is almost certainly generated by mistake.",
      });
    }
    this.nodeCount++;
    const node = kind === "object" ? { kind, entries: [], start: startOf(open), end: null } : { kind, items: [], start: startOf(open), end: null };
    const frame = { kind, node, open, key: null, keyToken: null, index: kind === "array" ? 0 : null };
    this.stack.push(frame);
    if (this.stack.length > this.deepest) this.deepest = this.stack.length;
    this.lint?.open(node);

    // '{}' and '[]': close at once. A wrong closer or the end of input here
    // gets the same treatment it would get after a child.
    const next = kind === "object" ? this.peekInObject() : this.tokens.peek();
    if (next.type === CLOSER[kind]) return this.finish(frame, this.tokens.next());
    if (next.type === T.RBRACE || next.type === T.RBRACKET) throw this.mismatched(frame, next);
    if (next.type === T.EOF) throw this.unclosed();
    return null;
  }

  /** The token that starts the container's first child value. */
  beginFirstChild(frame) {
    if (frame.kind === "array") return this.tokens.next();
    return this.readMember(frame);
  }

  /** After a ',': the token that starts the next child value. */
  beginNextChild(frame, comma) {
    if (frame.kind === "array") {
      frame.index = frame.node.items.length;
      this.rejectCloserAfterComma(frame, comma, this.tokens.peek());
      return this.tokens.next();
    }
    this.rejectCloserAfterComma(frame, comma, this.peekInObject());
    return this.readMember(frame);
  }

  /** `[1,2,]` and `{"a":1,}` — and the wrong-closer and end-of-input cases. */
  rejectCloserAfterComma(frame, comma, next) {
    if (next.type === CLOSER[frame.kind]) {
      throw this.error("TRAILING_COMMA", `trailing comma before ${describeToken(next)}`, comma, {
        expected: [frame.kind === "object" ? "a string key" : "a value"],
        found: describeToken(next),
        path: this.containerPath(this.stack.length - 1),
        hint: "Remove the trailing comma. JSON does not allow one after the last item.",
      });
    }
    if (next.type === T.RBRACE || next.type === T.RBRACKET) throw this.mismatched(frame, next);
    if (next.type === T.EOF) throw this.unclosed();
  }

  /** member := STRING ':' value — reads the key and colon, returns the value's first token. */
  readMember(frame) {
    const key = this.nextInObject();
    if (key.type !== T.STRING) {
      if (key.type === T.EOF) throw this.unclosed();
      if (key.type === T.RBRACKET) throw this.mismatched(frame, key);
      throw this.error("EXPECTED_KEY", `expected a string key but found ${describeToken(key)}`, key, {
        expected: ["a string key"],
        hint: KEY_HINT,
      });
    }
    frame.key = key.value;
    frame.keyToken = key;
    this.keyCount++;
    this.lint?.key(key);

    const colon = this.tokens.next();
    if (colon.type !== T.COLON) {
      if (colon.type === T.EOF) throw this.unclosed();
      throw this.error("EXPECTED_COLON", `expected ':' after the key but found ${describeToken(colon)}`, colon, {
        expected: ["':'"],
      });
    }
    return this.tokens.next();
  }

  addChild(frame, node) {
    if (frame.kind === "object") {
      frame.node.entries.push({ key: frame.key, keyToken: frame.keyToken, value: node });
      frame.key = null;
      frame.keyToken = null;
    } else {
      frame.node.items.push(node);
      frame.index = null;
    }
  }

  /**
   * The token after a complete child value. When a string opens here and
   * never closes, the tokenizer's UNTERMINATED_STRING is right about the
   * position but its hint ("the closing quote is missing") usually is not:
   * a quote straight after a finished value — `"rate": null"` — is almost
   * always one quote too many, not one too few. Same code, same position;
   * only the hint changes.
   */
  nextAfterValue(frame) {
    try {
      return this.tokens.next();
    } catch (err) {
      if (err instanceof JsonHippoError && err.code === "UNTERMINATED_STRING") {
        err.hint = `Is this '"' stray? It comes straight after a complete value, where only ',' or '${CLOSE_CHAR[frame.kind]}' can go.`;
      }
      throw err;
    }
  }

  /** `after` followed a child and was not ','. Only the right closer is fine. */
  closeContainer(frame, after) {
    if (after.type === CLOSER[frame.kind]) return this.finish(frame, after);
    if (after.type === T.RBRACE || after.type === T.RBRACKET) throw this.mismatched(frame, after);
    if (after.type === T.EOF) throw this.unclosed();

    const close = CLOSE_CHAR[frame.kind];
    // A value or a key where a ',' should be is almost always a missing comma.
    const looksLikeNextValue = [T.STRING, T.NUMBER, T.TRUE, T.FALSE, T.NULL, T.LBRACE, T.LBRACKET].includes(after.type);
    throw this.error("EXPECTED_COMMA_OR_CLOSE", `expected ${listExpected(["','", `'${close}'`])} but found ${describeToken(after)}`, after, {
      expected: ["','", `'${close}'`],
      hint: looksLikeNextValue ? "Missing comma after the previous value?" : null,
    });
  }

  finish(frame, closeToken) {
    this.stack.pop();
    frame.node.end = endOf(closeToken);
    this.lint?.close(frame.node);
    return frame.node;
  }

  // ── error helpers ────────────────────────────────────────────────────────

  top() {
    return this.stack[this.stack.length - 1];
  }

  error(code, message, token, fields = {}) {
    return new JsonHippoError(code, message, {
      ...startOf(token),
      endOffset: token.endOffset,
      found: describeToken(token),
      ...fields,
    });
  }

  /** `[1,2}` — a closer that does not match the innermost open container. */
  mismatched(frame, closeToken) {
    const open = OPEN_CHAR[frame.kind];
    const close = CLOSE_CHAR[frame.kind];
    return this.error("MISMATCHED_CLOSE", `${describeToken(closeToken)} does not match the '${open}' opened at ${at(frame.open)}`, closeToken, {
      expected: ["','", `'${close}'`],
      path: this.containerPath(this.stack.length - 1),
      opener: startOf(frame.open),
      hint: `Opened with '${open}' at line ${frame.open.line} col ${frame.open.column}. Close it with '${close}', or add the missing '${closeToken.raw === "}" ? "{" : "["}'.`,
    });
  }

  /**
   * End of input with containers still open. Points at the OPENER of the
   * innermost one — in a 5 MB file missing its last '}', the end of the file
   * says nothing; the brace that never closed says everything.
   */
  unclosed() {
    const frame = this.top();
    const open = OPEN_CHAR[frame.kind];
    const chain = this.stack.map((f) => `'${OPEN_CHAR[f.kind]}' ${f.open.line}:${f.open.column}`);
    const shown = chain.length > 6 ? [...chain.slice(0, 2), "…", ...chain.slice(-3)] : chain;
    const count = this.stack.length;
    return this.error("UNCLOSED_CONTAINER", `'${open}' is never closed`, frame.open, {
      expected: [`'${CLOSE_CHAR[frame.kind]}'`],
      found: "end of input",
      path: this.containerPath(this.stack.length - 1),
      opener: startOf(frame.open),
      openStack: this.openStack(),
      hint:
        count === 1
          ? `The input ends before this '${open}' is closed with '${CLOSE_CHAR[frame.kind]}'.`
          : `The input ends with ${count} containers still open: ${shown.join(" → ")}.`,
    });
  }

  peekInObject() {
    try {
      return this.tokens.peek();
    } catch (err) {
      throw this.asExpectedKey(err);
    }
  }

  nextInObject() {
    try {
      return this.tokens.next();
    } catch (err) {
      throw this.asExpectedKey(err);
    }
  }

  /**
   * Where a key belongs, `{a:1}` and `{'a':1}` fail in the tokenizer (a bare
   * word, a stray quote). The real problem is the key, so say that.
   */
  asExpectedKey(err) {
    if (!(err instanceof JsonHippoError)) return err;
    if (err.code !== "BAD_LITERAL" && err.code !== "BAD_NUMBER" && err.code !== "UNEXPECTED_CHAR") return err;
    const specificHint = err.code === "UNEXPECTED_CHAR" && err.hint && err.found !== `"'"` ? err.hint : null;
    return new JsonHippoError("EXPECTED_KEY", `expected a string key but found ${err.found}`, {
      line: err.line,
      column: err.column,
      offset: err.offset,
      endOffset: err.endOffset,
      expected: ["a string key"],
      found: err.found,
      hint: specificHint ?? KEY_HINT,
    });
  }

  // ── path ─────────────────────────────────────────────────────────────────

  /** The path of whatever is being read right now. */
  currentPath() {
    return this.containerPath(this.stack.length);
  }

  /** The path of the container at stack[depth] (stack.length → the current child). */
  containerPath(depth) {
    const segments = [];
    for (let i = 0; i < depth; i++) {
      const frame = this.stack[i];
      const segment = frame.kind === "object" ? frame.key : frame.index;
      if (segment === null) break;
      segments.push(segment);
    }
    return formatPath(segments);
  }

  openStack() {
    return this.stack.map((f) => ({ kind: f.kind, line: f.open.line, column: f.open.column, offset: f.open.offset }));
  }
}
