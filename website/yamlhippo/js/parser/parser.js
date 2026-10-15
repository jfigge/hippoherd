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
 * parser.js — stage two: tokens in, one tree per document out, or one
 * precise error.
 *
 * The grammar is YAML's, driven the way libyaml drives it: a state machine
 * with an explicit stack of states to return to, never the JavaScript call
 * stack, so a document nested 10,000 deep parses instead of overflowing
 * (see JsonHippo's parser.js for the measurement). The tree is built as the
 * machine runs, with a second explicit stack of open collections, which is
 * also what error reporting needs: the path, and what is still open.
 *
 * The tree has JsonHippo's shape, so its tree view, search, schema and diff
 * work on it, plus YAML's extras:
 *
 *   { kind: 'object', entries: [{ key, keyToken, keyNode, value }], start, end, style, tag?, anchor? }
 *   { kind: 'array',  items: [node, …], start, end, style, tag?, anchor? }
 *   { kind: 'string' | 'number' | 'boolean' | 'null', value, raw, start, end, style, tag?, anchor?, json? }
 *   { kind: 'alias', name, target, raw, start, end }
 *
 *   start/end   { line, column, offset }; end is just past the node
 *   style       'block' | 'flow' for collections;
 *               'plain' | 'single' | 'double' | 'literal' | 'folded' for scalars
 *   key         the key as a string (what a path and the tree show)
 *   keyToken    { value, raw, line, column, offset, endOffset } — the key's text
 *   keyNode     the key's own node (keys can be numbers, or even collections)
 *   tag         { name: '!Ref' | '!!str' (as written), full, custom, token }
 *   anchor      the &name on the node, if any
 *   raw         a scalar's source text (quotes included); numbers also keep
 *               it as `value`, and `json` is the number written as JSON
 *   target      an alias's anchored node — the same object, not a copy
 *
 * parse() returns { documents: [{ ast, start, end, explicitStart,
 * explicitEnd, version, tags }], ast (the first document's), comments,
 * warnings, warningTotal, stats: { nodes, keys, depth, documents } }.
 *
 * Duplicate keys are kept, in source order; the linter flags them. Parsing
 * stops at the first error: no recovery, one error per run.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { Scanner, TokenType as T, firstLine } from "./scanner.js";
import { YamlHippoError, clip, listExpected, spaces } from "./errors.js";
import { STD, YAML_TAG, isBool, isFloat, isInt, isNull, isStandardTag, jsonNumber, resolvePlain } from "./resolve.js";
import { formatPath } from "../json-path.js";

/** Collections may nest this deep; one more is MAX_DEPTH. */
export const MAX_DEPTH = 10000;

const DEFAULT_TAGS = Object.freeze({ "!": "!", "!!": YAML_TAG });

// States. Each names what the machine expects next.
const S = {
  IMPLICIT_DOC_START: 0,
  DOC_START: 1,
  DOC_END: 2,
  DOC_CONTENT: 3,
  BLOCK_NODE: 4,
  BLOCK_SEQ_FIRST: 5,
  BLOCK_SEQ_ENTRY: 6,
  INDENTLESS_ENTRY: 7,
  BLOCK_MAP_FIRST_KEY: 8,
  BLOCK_MAP_KEY: 9,
  BLOCK_MAP_VALUE: 10,
  FLOW_SEQ_FIRST: 11,
  FLOW_SEQ_ENTRY: 12,
  FLOW_SEQ_ENTRY_NEXT: 13,
  FLOW_PAIR_KEY: 14,
  FLOW_PAIR_VALUE: 15,
  FLOW_PAIR_END: 16,
  FLOW_MAP_FIRST_KEY: 17,
  FLOW_MAP_KEY: 18,
  FLOW_MAP_KEY_NEXT: 19,
  FLOW_MAP_VALUE: 20,
  END: 21,
};

const OPEN_CHAR = { object: "{", array: "[" };
const CLOSE_CHAR = { object: "}", array: "]" };

/**
 * Parse YAML text.
 * @param options { maxDepth, lint: a Linter, or null for no warnings }
 * @throws {YamlHippoError}
 */
export function parse(text, options) {
  return new Parser(text, options).parse();
}

/** How a token reads in an error message. */
export function describeToken(token) {
  switch (token.type) {
    case T.SCALAR:
      if (token.style === "plain") return `'${clip(firstLine(token.raw))}'`;
      if (token.style === "literal" || token.style === "folded") return `a block scalar`;
      return `string ${clip(firstLine(token.raw))}`;
    case T.STREAM_END:
      return "end of input";
    case T.BLOCK_END:
      return "the end of the block";
    case T.BLOCK_MAPPING_START:
      return "a new mapping";
    case T.BLOCK_SEQUENCE_START:
      return "a new '- ' list";
    case T.BLOCK_ENTRY:
      return "'- '";
    case T.KEY:
      return token.raw ? "'?'" : "a mapping key";
    case T.ALIAS:
      return `alias ${token.raw}`;
    case T.ANCHOR:
      return `anchor ${token.raw}`;
    case T.TAG:
      return `tag ${token.raw}`;
    case T.DIRECTIVE:
      return `directive %${token.name}`;
    default:
      return `'${token.raw}'`;
  }
}

function endOf(token) {
  return token.end;
}

class Parser {
  constructor(text, { maxDepth = MAX_DEPTH, lint = null } = {}) {
    this.sc = new Scanner(text);
    this.text = text;
    this.maxDepth = maxDepth;
    this.lint = lint;
    lint?.begin(() => this.currentPath());

    this.state = S.IMPLICIT_DOC_START;
    this.states = [];
    this.tagHandles = DEFAULT_TAGS;

    // The tree being built: open collections, outermost first. Each frame:
    //   { node, kind, key — the entry key being read (objects), or null }
    this.frames = [];
    this.documents = [];
    this.doc = null;
    this.anchors = new Map();
    this.earlierAnchors = new Set();

    this.nodeCount = 0;
    this.keyCount = 0;
    this.deepest = 0;
    this.prevToken = null;
    this.lastDocEnded = false;
  }

  parse() {
    try {
      this.run();
      if (this.documents.length === 0) {
        throw new YamlHippoError("EMPTY_INPUT", "there is no YAML here — the input is empty", {
          expected: ["a value"],
          found: "end of input",
          path: "$",
        });
      }
      return {
        documents: this.documents,
        ast: this.documents[0].ast,
        comments: this.sc.comments,
        warnings: this.lint?.warnings ?? [],
        warningTotal: this.lint?.total ?? 0,
        stats: { nodes: this.nodeCount, keys: this.keyCount, depth: this.deepest, documents: this.documents.length },
      };
    } catch (err) {
      if (err instanceof YamlHippoError) {
        if (err.path === null) err.path = this.currentPath();
        if (err.openStack.length === 0) err.openStack = this.openStack();
        if (err.document === undefined) err.document = this.documents.length;
      }
      throw err;
    }
  }

  // ── token access ─────────────────────────────────────────────────────────

  check(...types) {
    return this.sc.check(...types);
  }

  peek() {
    return this.sc.peek();
  }

  next() {
    const token = this.sc.next();
    this.prevToken = token;
    return token;
  }

  // ── the machine ──────────────────────────────────────────────────────────

  run() {
    for (;;) {
      switch (this.state) {
        case S.IMPLICIT_DOC_START:
          this.implicitDocumentStart();
          break;
        case S.DOC_START:
          this.documentStart();
          break;
        case S.DOC_END:
          this.documentEnd();
          break;
        case S.DOC_CONTENT:
          this.documentContent();
          break;
        case S.BLOCK_NODE:
          this.parseNode(true, false);
          break;
        case S.BLOCK_SEQ_FIRST:
          this.next();
          this.blockSequenceEntry();
          break;
        case S.BLOCK_SEQ_ENTRY:
          this.blockSequenceEntry();
          break;
        case S.INDENTLESS_ENTRY:
          this.indentlessSequenceEntry();
          break;
        case S.BLOCK_MAP_FIRST_KEY:
          this.next();
          this.blockMappingKey();
          break;
        case S.BLOCK_MAP_KEY:
          this.blockMappingKey();
          break;
        case S.BLOCK_MAP_VALUE:
          this.blockMappingValue();
          break;
        case S.FLOW_SEQ_FIRST:
          this.next();
          this.flowSequenceEntry(true);
          break;
        case S.FLOW_SEQ_ENTRY:
          this.flowSequenceEntry(true);
          break;
        case S.FLOW_SEQ_ENTRY_NEXT:
          this.flowSequenceEntry(false);
          break;
        case S.FLOW_PAIR_KEY:
          this.flowPairKey();
          break;
        case S.FLOW_PAIR_VALUE:
          this.flowPairValue();
          break;
        case S.FLOW_PAIR_END:
          this.state = S.FLOW_SEQ_ENTRY_NEXT;
          this.collectionEnd(null);
          break;
        case S.FLOW_MAP_FIRST_KEY:
          this.next();
          this.flowMappingKey(true);
          break;
        case S.FLOW_MAP_KEY:
          this.flowMappingKey(true);
          break;
        case S.FLOW_MAP_KEY_NEXT:
          this.flowMappingKey(false);
          break;
        case S.FLOW_MAP_VALUE:
          this.flowMappingValue();
          break;
        case S.END:
          return;
        default:
          throw new Error(`parser: bad state ${this.state}`);
      }
    }
  }

  pop() {
    this.state = this.states.pop();
  }

  // ── documents ────────────────────────────────────────────────────────────

  implicitDocumentStart() {
    if (!this.check(T.DIRECTIVE, T.DOC_START, T.DOC_END, T.STREAM_END)) {
      this.tagHandles = DEFAULT_TAGS;
      this.documentBegin(this.peek(), false, null, {});
      this.states.push(S.DOC_END);
      this.state = S.BLOCK_NODE;
      return;
    }
    this.documentStart();
  }

  documentStart() {
    let ended = this.lastDocEnded;
    while (this.check(T.DOC_END)) {
      this.next();
      ended = true;
    }
    if (this.check(T.STREAM_END)) {
      this.next();
      this.state = S.END;
      return;
    }
    if (this.check(T.DIRECTIVE) && this.documents.length > 0 && !ended) {
      const token = this.peek();
      throw this.error("BAD_DIRECTIVE", `a directive after a document needs '...' before it`, token, {
        expected: ["'...'"],
        hint: "End the previous document with a '...' line, then the directives, then '---'.",
      });
    }
    if (ended && !this.check(T.DIRECTIVE, T.DOC_START)) {
      // A bare document after '...': no '---' needed.
      this.tagHandles = DEFAULT_TAGS;
      this.documentBegin(this.peek(), false, null, {});
      this.states.push(S.DOC_END);
      this.state = S.BLOCK_NODE;
      return;
    }
    const { version, tags, any } = this.directives();
    if (!this.check(T.DOC_START)) {
      const token = this.peek();
      if (any) {
        throw this.error("BAD_DIRECTIVE", `expected '---' after the directives but found ${describeToken(token)}`, token, {
          expected: ["'---'"],
          hint: "Directives (%YAML, %TAG) must be followed by '---' to start the document.",
        });
      }
      throw this.error("TRAILING_CONTENT", `unexpected ${describeToken(token)} after the end of the document`, token, {
        expected: ["'---'", "end of input"],
        path: "$",
        hint:
          "A document has one top-level value. To start another document put '---' on the line before it; " +
          "to make this part of the value above, indent it under a key.",
      });
    }
    const token = this.next();
    this.documentBegin(token, true, version, tags);
    this.states.push(S.DOC_END);
    this.state = S.DOC_CONTENT;
  }

  /** %YAML and %TAG lines before a '---'. */
  directives() {
    let version = null;
    let any = false;
    const tags = {};
    while (this.check(T.DIRECTIVE)) {
      const token = this.next();
      any = true;
      if (token.name === "YAML") {
        if (version !== null) throw this.error("BAD_DIRECTIVE", "a second %YAML directive", token);
        if (token.value[0] !== 1) {
          throw this.error("BAD_DIRECTIVE", `YAML ${token.value.join(".")} is not supported`, token, {
            hint: "YamlHippo reads YAML 1.x (1.2 rules).",
          });
        }
        version = token.value;
      } else if (token.name === "TAG") {
        const [handle, prefix] = token.value;
        if (handle in tags) throw this.error("BAD_DIRECTIVE", `the tag handle ${handle} is declared twice`, token);
        tags[handle] = prefix;
      }
    }
    this.tagHandles = { ...DEFAULT_TAGS, ...tags };
    return { version, tags, any };
  }

  documentBegin(token, explicit, version, tags) {
    for (const name of this.anchors.keys()) this.earlierAnchors.add(name);
    this.anchors = new Map();
    this.doc = { ast: null, start: token.start, end: null, explicitStart: explicit, explicitEnd: false, version, tags };
  }

  documentEnd() {
    const token = this.peek();
    let end = token.start;
    if (token.type === T.DOC_END) {
      this.next();
      this.doc.explicitEnd = true;
      end = token.end;
    } else if (this.doc.ast) {
      end = this.doc.ast.end;
    }
    this.doc.end = end;
    this.lastDocEnded = this.doc.explicitEnd;
    this.documents.push(this.doc);
    this.doc = null;
    this.state = S.DOC_START;
  }

  documentContent() {
    if (this.check(T.DIRECTIVE, T.DOC_START, T.DOC_END, T.STREAM_END)) {
      this.emptyScalar(this.peek().start);
      this.pop();
      return;
    }
    this.parseNode(true, false);
  }

  // ── nodes ────────────────────────────────────────────────────────────────

  /** One node: an alias, a scalar, or the start of a collection; with its anchor and tag. */
  parseNode(block, indentless) {
    let token = this.peek();
    if (token.type === T.ALIAS) {
      this.next();
      this.alias(token);
      this.pop();
      return;
    }
    let anchor = null;
    let tag = null;
    if (token.type === T.ANCHOR) {
      anchor = this.next();
      token = this.peek();
      if (token.type === T.TAG) {
        tag = this.next();
        token = this.peek();
      }
    } else if (token.type === T.TAG) {
      tag = this.next();
      token = this.peek();
      if (token.type === T.ANCHOR) {
        anchor = this.next();
        token = this.peek();
      }
    }
    if (token.type === T.ALIAS) {
      throw this.error("BAD_ANCHOR", `an alias can't have its own ${anchor ? "anchor" : "tag"}`, anchor ?? tag, {
        hint: `${token.raw} refers to a node that is defined elsewhere, with its own anchor and tag.`,
      });
    }
    const tagInfo = tag ? this.resolveTag(tag) : null;
    const props = { anchor, tag: tagInfo };

    if (indentless && token.type === T.BLOCK_ENTRY) {
      this.collectionStart("array", "block", token, props);
      this.state = S.INDENTLESS_ENTRY;
      return;
    }
    switch (token.type) {
      case T.SCALAR:
        this.next();
        this.scalar(token, props);
        this.pop();
        return;
      case T.FLOW_SEQUENCE_START:
        this.collectionStart("array", "flow", token, props);
        this.state = S.FLOW_SEQ_FIRST;
        return;
      case T.FLOW_MAPPING_START:
        this.collectionStart("object", "flow", token, props);
        this.state = S.FLOW_MAP_FIRST_KEY;
        return;
      case T.BLOCK_SEQUENCE_START:
        if (!block) break;
        this.collectionStart("array", "block", token, props);
        this.state = S.BLOCK_SEQ_FIRST;
        return;
      case T.BLOCK_MAPPING_START:
        if (!block) break;
        this.collectionStart("object", "block", token, props);
        this.state = S.BLOCK_MAP_FIRST_KEY;
        return;
      default:
    }
    if (anchor || tag) {
      // `key: !Ref` or `- &a` with nothing after: an empty value, tagged.
      this.emptyScalar((tag && (!anchor || tag.end.offset > anchor.end.offset) ? tag : anchor).end, props);
      this.pop();
      return;
    }
    if (!block) this.guardFlow(token);
    throw this.expectedValue(token);
  }

  expectedValue(token) {
    return this.error("EXPECTED_VALUE", `expected a value but found ${describeToken(token)}`, token, {
      expected: ["a value"],
      hint: this.adjacentHint(token),
    });
  }

  // ── block collections ────────────────────────────────────────────────────

  blockSequenceEntry() {
    if (this.check(T.BLOCK_ENTRY)) {
      const token = this.next();
      if (!this.check(T.BLOCK_ENTRY, T.BLOCK_END)) {
        this.states.push(S.BLOCK_SEQ_ENTRY);
        this.parseNode(true, false);
      } else {
        this.state = S.BLOCK_SEQ_ENTRY;
        this.emptyScalar(token.end);
      }
      return;
    }
    const token = this.peek();
    if (token.type !== T.BLOCK_END) throw this.blockMismatch(token, "array");
    this.next();
    this.collectionEnd(null);
    this.pop();
  }

  indentlessSequenceEntry() {
    if (this.check(T.BLOCK_ENTRY)) {
      const token = this.next();
      if (!this.check(T.BLOCK_ENTRY, T.KEY, T.VALUE, T.BLOCK_END)) {
        this.states.push(S.INDENTLESS_ENTRY);
        this.parseNode(true, false);
      } else {
        this.state = S.INDENTLESS_ENTRY;
        this.emptyScalar(token.end);
      }
      return;
    }
    this.collectionEnd(null);
    this.pop();
  }

  blockMappingKey() {
    if (this.check(T.KEY)) {
      const token = this.next();
      if (!this.check(T.KEY, T.VALUE, T.BLOCK_END)) {
        this.states.push(S.BLOCK_MAP_VALUE);
        this.parseNode(true, true);
      } else {
        this.state = S.BLOCK_MAP_VALUE;
        this.emptyScalar(token.end);
      }
      return;
    }
    if (this.check(T.VALUE)) {
      // `: value` with no key: the key is empty.
      this.state = S.BLOCK_MAP_VALUE;
      this.emptyScalar(this.peek().start);
      return;
    }
    const token = this.peek();
    if (token.type !== T.BLOCK_END) throw this.blockMismatch(token, "object");
    this.next();
    this.collectionEnd(null);
    this.pop();
  }

  blockMappingValue() {
    if (this.check(T.VALUE)) {
      const token = this.next();
      if (!this.check(T.KEY, T.VALUE, T.BLOCK_END)) {
        this.states.push(S.BLOCK_MAP_KEY);
        this.parseNode(true, true);
      } else {
        this.state = S.BLOCK_MAP_KEY;
        this.emptyScalar(token.end);
      }
      return;
    }
    this.state = S.BLOCK_MAP_KEY;
    this.emptyScalar(this.peek().start);
  }

  /**
   * Something other than the next entry, or the end, in a block collection.
   * Most of these are indentation slips, and say so.
   */
  blockMismatch(token, kind) {
    const frame = this.top();
    const col = frame.node.start.column - 1;
    const line = frame.node.start.line;
    if (token.type === T.BLOCK_MAPPING_START || token.type === T.BLOCK_SEQUENCE_START) {
      const found = token.start.column - 1;
      return this.error("INDENT_MISMATCH", `indented ${spaces(found)} but siblings use ${col}`, token, {
        column: 1,
        offset: token.start.offset - found,
        endOffset: token.start.offset,
        expected: [`${col}`],
        found: spaces(found),
        opener: frame.node.start,
        indent: { found, expected: [col] },
        hint:
          `The ${kind === "object" ? "mapping" : "list"} this line is in starts at line ${line} with ${spaces(col)}. ` +
          "A deeper-indented line can only follow a key with nothing after its ':'. Line it up with its siblings.",
      });
    }
    if (kind === "array") {
      const next = this.sc.peekSecond();
      const what = token.type === T.KEY && next?.type === T.SCALAR ? `the mapping key ${describeToken(next)}` : describeToken(token);
      return this.error("EXPECTED_ENTRY", `expected another '- ' entry or the end of the list but found ${what}`, token, {
        expected: ["'- '"],
        opener: frame.node.start,
        hint:
          token.type === T.KEY
            ? `This line is at the indentation of the list that starts at line ${line}, but it is a 'key: value', not a '- ' entry. ` +
              "Indent it to put it inside the entry above, or start it with '- '."
            : this.adjacentHint(token),
      });
    }
    return this.error("EXPECTED_KEY", `expected the next key or the end of the mapping but found ${describeToken(token)}`, token, {
      expected: ["a key"],
      opener: frame.node.start,
      hint:
        token.type === T.BLOCK_ENTRY
          ? `A '- ' entry can't sit at the indentation of the mapping that starts at line ${line}. ` +
            "Indent the list under the key it belongs to."
          : (this.adjacentHint(token) ?? "Each entry of a block mapping goes on its own line, as 'key: value'."),
    });
  }

  /** "abc" def — text straight after a closing quote is usually a quote inside the string. */
  adjacentHint(token) {
    const prev = this.prevToken;
    if (!prev || prev.type !== T.SCALAR || prev.end.offset !== token.start.offset) return null;
    if (prev.style === "single") return "Is there a ' inside the string? Inside '…' a single quote is written ''.";
    if (prev.style === "double") return 'Is there a " inside the string? Inside "…" write \\".';
    return null;
  }

  // ── flow collections ─────────────────────────────────────────────────────

  /** In a flow collection: a wrong closer, or the end of the input, is reported against the opener. */
  guardFlow(token) {
    const frame = this.innermostFlow();
    if (!frame) return;
    if (token.type === T.STREAM_END || token.type === T.DOC_START || token.type === T.DOC_END) throw this.unclosed(frame, token);
    const wrong = frame.kind === "array" ? T.FLOW_MAPPING_END : T.FLOW_SEQUENCE_END;
    if (token.type === wrong) throw this.mismatched(frame, token);
  }

  flowSequenceEntry(first) {
    let token = this.peek();
    this.guardFlow(token);
    if (token.type !== T.FLOW_SEQUENCE_END) {
      if (!first) {
        if (token.type !== T.FLOW_ENTRY) throw this.expectedCommaOrClose(token, "array");
        this.next();
        token = this.peek();
        this.guardFlow(token);
      }
      if (token.type === T.KEY) {
        // [a: 1] — a single-pair mapping inside a flow sequence.
        this.collectionStart("object", "flow", token, { anchor: null, tag: null });
        this.state = S.FLOW_PAIR_KEY;
        return;
      }
      if (token.type === T.VALUE) {
        // [: 1] — the same, with an empty key.
        this.collectionStart("object", "flow", token, { anchor: null, tag: null });
        this.state = S.FLOW_PAIR_VALUE;
        this.emptyScalar(token.start);
        return;
      }
      if (token.type !== T.FLOW_SEQUENCE_END) {
        this.states.push(S.FLOW_SEQ_ENTRY_NEXT);
        this.parseNode(false, false);
        return;
      }
    }
    this.next();
    this.collectionEnd(token);
    this.pop();
  }

  flowPairKey() {
    const token = this.next();
    if (!this.check(T.VALUE, T.FLOW_ENTRY, T.FLOW_SEQUENCE_END)) {
      this.states.push(S.FLOW_PAIR_VALUE);
      this.parseNode(false, false);
    } else {
      this.state = S.FLOW_PAIR_VALUE;
      this.emptyScalar(token.end);
    }
  }

  flowPairValue() {
    if (this.check(T.VALUE)) {
      const token = this.next();
      if (!this.check(T.FLOW_ENTRY, T.FLOW_SEQUENCE_END)) {
        this.states.push(S.FLOW_PAIR_END);
        this.parseNode(false, false);
      } else {
        this.state = S.FLOW_PAIR_END;
        this.emptyScalar(token.end);
      }
      return;
    }
    this.state = S.FLOW_PAIR_END;
    this.emptyScalar(this.peek().start);
  }

  flowMappingKey(first) {
    let token = this.peek();
    this.guardFlow(token);
    if (token.type !== T.FLOW_MAPPING_END) {
      if (!first) {
        if (token.type !== T.FLOW_ENTRY) throw this.expectedCommaOrClose(token, "object");
        this.next();
        token = this.peek();
        this.guardFlow(token);
      }
      if (token.type === T.KEY) {
        this.next();
        if (!this.check(T.VALUE, T.FLOW_ENTRY, T.FLOW_MAPPING_END)) {
          this.states.push(S.FLOW_MAP_VALUE);
          this.parseNode(false, false);
        } else {
          this.state = S.FLOW_MAP_VALUE;
          this.emptyScalar(token.end);
        }
        return;
      }
      if (token.type === T.VALUE) {
        // {: v} — an empty key.
        this.state = S.FLOW_MAP_VALUE;
        this.emptyScalar(token.start);
        return;
      }
      if (token.type !== T.FLOW_MAPPING_END) {
        // A key with no ':' yet: {a, b} — or {"a"\n: 1}, whose ':' is on
        // the next line, which flow mappings allow after a JSON-like key.
        this.states.push(S.FLOW_MAP_VALUE);
        this.parseNode(false, false);
        return;
      }
    }
    this.next();
    this.collectionEnd(token);
    this.pop();
  }

  flowMappingValue() {
    const token = this.peek();
    this.guardFlow(token);
    if (token.type === T.VALUE) {
      this.next();
      const after = this.peek();
      this.guardFlow(after);
      if (after.type !== T.FLOW_ENTRY && after.type !== T.FLOW_MAPPING_END) {
        this.states.push(S.FLOW_MAP_KEY_NEXT);
        this.parseNode(false, false);
      } else {
        this.state = S.FLOW_MAP_KEY_NEXT;
        this.emptyScalar(token.end);
      }
      return;
    }
    this.state = S.FLOW_MAP_KEY_NEXT;
    this.emptyScalar(token.start);
  }

  expectedCommaOrClose(token, kind) {
    const close = CLOSE_CHAR[kind];
    // A line that starts back at (or left of) the indentation of the line
    // the bracket opened on is not more of the bracket's content: it is the
    // document carrying on, and the bracket was never closed.
    const frame = this.innermostFlow();
    if (frame && token.start.line > frame.node.start.line) {
      const open = frame.node.start;
      const lineStart = open.offset - (open.column - 1);
      let indent = 0;
      while (this.text.charCodeAt(lineStart + indent) === 0x20) indent++;
      if (this.lineIndent(token) <= indent) throw this.unclosed(frame, token);
    }
    const looksLikeNextValue = [T.SCALAR, T.FLOW_SEQUENCE_START, T.FLOW_MAPPING_START, T.ALIAS, T.ANCHOR, T.TAG, T.KEY].includes(token.type);
    return this.error("EXPECTED_COMMA_OR_CLOSE", `expected ${listExpected(["','", `'${close}'`])} but found ${describeToken(token)}`, token, {
      expected: ["','", `'${close}'`],
      opener: this.top().node.start,
      hint: this.adjacentHint(token) ?? (looksLikeNextValue ? "Missing comma after the previous item?" : token.type === T.VALUE ? "Missing comma between entries?" : null),
    });
  }

  mismatched(frame, token) {
    const open = OPEN_CHAR[frame.kind];
    const close = CLOSE_CHAR[frame.kind];
    const start = frame.node.start;
    return this.error("MISMATCHED_CLOSE", `${describeToken(token)} does not match the '${open}' opened at line ${start.line}, col ${start.column}`, token, {
      expected: ["','", `'${close}'`],
      path: this.containerPath(this.frames.indexOf(frame)),
      opener: start,
      hint: `Opened with '${open}' at line ${start.line} col ${start.column}. Close it with '${close}', or add the missing '${token.raw === "}" ? "{" : "["}'.`,
    });
  }

  /** The end of the input (or of the document) inside [ ] or { }: points at the opener. */
  unclosed(frame, token) {
    const open = OPEN_CHAR[frame.kind];
    const start = frame.node.start;
    const flows = this.frames.filter((f) => f.node.style === "flow");
    const chain = flows.map((f) => `'${OPEN_CHAR[f.kind]}' ${f.node.start.line}:${f.node.start.column}`);
    const shown = chain.length > 6 ? [...chain.slice(0, 2), "…", ...chain.slice(-3)] : chain;
    const ends =
      token.type === T.STREAM_END
        ? "The input ends"
        : token.type === T.DOC_START || token.type === T.DOC_END
          ? `The document ends (${describeToken(token)} at line ${token.start.line})`
          : `Line ${token.start.line} starts a new entry`;
    return new YamlHippoError("UNCLOSED_CONTAINER", `'${open}' is never closed`, {
      ...start,
      endOffset: start.offset + 1,
      expected: [`'${CLOSE_CHAR[frame.kind]}'`],
      found: describeToken(token),
      path: this.containerPath(this.frames.indexOf(frame)),
      opener: start,
      openStack: this.openStack(),
      hint:
        flows.length === 1
          ? `${ends} before this '${open}' is closed with '${CLOSE_CHAR[frame.kind]}'.`
          : `${ends} with ${flows.length} brackets still open: ${shown.join(" → ")}.`,
    });
  }

  /** The indentation (in spaces) of the line `token` is on. */
  lineIndent(token) {
    const lineStart = token.start.offset - token.start.column + 1;
    let i = lineStart;
    while (this.text.charCodeAt(i) === 0x20) i++;
    return i - lineStart;
  }

  innermostFlow() {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].node.style === "flow") return this.frames[i];
    }
    return null;
  }

  // ── tags ─────────────────────────────────────────────────────────────────

  resolveTag(token) {
    let full;
    if (token.handle === null) {
      full = token.suffix;
    } else {
      const prefix = this.tagHandles[token.handle];
      if (prefix === undefined) {
        throw this.error("BAD_TAG", `the tag handle ${token.handle} is not declared`, token, {
          hint: `Declare it with a %TAG ${token.handle} … directive before the document's '---'.`,
        });
      }
      full = prefix + token.suffix;
    }
    const name = token.handle === "!!" ? `!!${token.suffix}` : token.raw;
    return {
      name,
      full,
      custom: !isStandardTag(full),
      token: { line: token.start.line, column: token.start.column, offset: token.start.offset, endOffset: token.end.offset },
    };
  }

  /** A scalar's kind and value, under its tag if it has one. */
  resolveScalar(token, tag) {
    const text = token.value;
    if (!tag) return token.style === "plain" ? resolvePlain(text) : { kind: "string", value: text };
    const bad = (what) =>
      this.error("BAD_TAG", `${tag.name} needs ${what}, but the value is ${clip(quoted(text))}`, token, {
        opener: tag.token,
        hint: `Change the value, or the tag — or remove ${tag.name} to let YAML decide the type.`,
      });
    switch (tag.full) {
      case STD.str:
      case STD.binary:
      case STD.timestamp:
      case "!":
        return { kind: "string", value: text };
      case STD.int:
        if (!isInt(text)) throw bad("an integer");
        return { kind: "number", value: text, json: jsonNumber(text) };
      case STD.float:
        if (!isInt(text) && !isFloat(text)) throw bad("a number");
        return { kind: "number", value: text, json: jsonNumber(text) };
      case STD.bool:
        if (!isBool(text)) throw bad("true or false");
        return { kind: "boolean", value: /^t/i.test(text) };
      case STD.null:
        if (!isNull(text)) throw bad("null (~, null or nothing)");
        return { kind: "null", value: null };
      case STD.map:
      case STD.seq:
      case STD.set:
      case STD.omap:
      case STD.pairs:
        throw this.error("BAD_TAG", `${tag.name} is for a ${tag.full === STD.map || tag.full === STD.set ? "mapping" : "list"}, but this is a scalar`, token, {
          opener: tag.token,
        });
      default:
        // A custom tag: the application decides what it means. The text is
        // kept as written, untyped.
        return { kind: "string", value: text };
    }
  }

  checkCollectionTag(kind, tag, token) {
    if (!tag) return;
    const wantsMap = tag.full === STD.map || tag.full === STD.set;
    const wantsSeq = tag.full === STD.seq || tag.full === STD.omap || tag.full === STD.pairs;
    const scalarOnly = [STD.str, STD.int, STD.float, STD.bool, STD.null, STD.binary, STD.timestamp].includes(tag.full);
    if ((wantsMap && kind !== "object") || (wantsSeq && kind !== "array") || scalarOnly) {
      throw this.error("BAD_TAG", `${tag.name} can't go on a ${kind === "object" ? "mapping" : "list"}`, token, { opener: tag.token });
    }
  }

  // ── building the tree ────────────────────────────────────────────────────

  top() {
    return this.frames[this.frames.length - 1];
  }

  scalar(token, { anchor, tag }) {
    this.nodeCount++;
    const resolved = this.resolveScalar(token, tag);
    const node = { kind: resolved.kind, value: resolved.value, raw: token.raw, start: token.start, end: token.end, style: token.style };
    if (resolved.json !== undefined) node.json = resolved.json;
    if (token.chomping) {
      node.chomping = token.chomping;
      node.blockIndent = token.blockIndent;
    }
    this.decorate(node, anchor, tag);
    this.add(node);
  }

  emptyScalar(mark, props = { anchor: null, tag: null }) {
    this.nodeCount++;
    const tag = props.tag;
    let node;
    if (tag) {
      const resolved = this.resolveScalar({ value: "", style: "plain", raw: "", start: mark, end: mark }, tag);
      node = { kind: resolved.kind, value: resolved.kind === "string" ? "" : resolved.value, raw: "", start: mark, end: mark, style: "plain" };
    } else {
      node = { kind: "null", value: null, raw: "", start: mark, end: mark, style: "plain" };
    }
    this.decorate(node, props.anchor, tag);
    this.add(node);
  }

  alias(token) {
    const target = this.anchors.get(token.value);
    if (target === undefined) {
      const earlier = this.earlierAnchors.has(token.value);
      throw this.error("UNKNOWN_ALIAS", `${token.raw} refers to an anchor that is not defined`, token, {
        hint: earlier
          ? `&${token.value} is defined in an earlier document. Anchors do not carry across '---'.`
          : `Define the anchor first, with &${token.value} on the node it should repeat. An alias can only refer back, never forward.`,
      });
    }
    this.nodeCount++;
    const node = { kind: "alias", name: token.value, target, raw: token.raw, start: token.start, end: token.end };
    if (this.frames.some((f) => f.node === target)) node.recursive = true;
    this.add(node);
  }

  decorate(node, anchor, tag) {
    if (tag) node.tag = tag;
    if (anchor) {
      node.anchor = anchor.value;
      node.anchorToken = { line: anchor.start.line, column: anchor.start.column, offset: anchor.start.offset, endOffset: anchor.end.offset };
      this.lint?.anchor?.(anchor, this.anchors.has(anchor.value));
      this.anchors.set(anchor.value, node);
    }
  }

  collectionStart(kind, style, token, { anchor, tag }) {
    if (this.frames.length >= this.maxDepth) {
      throw this.error("MAX_DEPTH", `nesting is deeper than ${this.maxDepth.toLocaleString("en-US")} levels`, token, {
        hint: "This many levels of nesting is almost certainly generated by mistake.",
      });
    }
    this.checkCollectionTag(kind, tag, token);
    this.nodeCount++;
    const node = kind === "object" ? { kind, entries: [], start: token.start, end: null, style } : { kind, items: [], start: token.start, end: null, style };
    this.decorate(node, anchor, tag);
    this.frames.push({ node, kind, key: null });
    if (this.frames.length > this.deepest) this.deepest = this.frames.length;
    this.lint?.open(node);
  }

  /** Close the innermost collection: a flow one ends at its closer, a block one at its last child. */
  collectionEnd(closer) {
    const frame = this.frames.pop();
    const node = frame.node;
    if (closer) node.end = endOf(closer);
    else {
      const last = node.kind === "object" ? node.entries[node.entries.length - 1]?.value : node.items[node.items.length - 1];
      node.end = last ? last.end : node.start;
      if (node.end.offset < node.start.offset) node.end = node.start;
    }
    this.lint?.close(node);
    this.add(node);
  }

  /** A finished node goes to its parent: an array item, an entry's key, or an entry's value. */
  add(node) {
    const frame = this.top();
    const isKey = frame !== undefined && frame.kind === "object" && frame.key === null;
    if (!isKey && this.lint && node.kind !== "object" && node.kind !== "array") this.lint.value(node);
    if (frame === undefined) {
      this.doc.ast = node;
      return;
    }
    if (frame.kind === "array") {
      frame.node.items.push(node);
      return;
    }
    if (isKey) {
      // Keys are not counted as nodes (as in JsonHippo, where they are tokens).
      if (node.kind !== "object" && node.kind !== "array") this.nodeCount--;
      frame.key = makeKey(node);
      this.keyCount++;
      this.lint?.key(frame.key.keyToken);
      return;
    }
    const { key, keyToken } = frame.key;
    frame.node.entries.push({ key, keyToken, keyNode: frame.key.node, value: node });
    frame.key = null;
  }

  // ── errors and paths ─────────────────────────────────────────────────────

  error(code, message, token, fields = {}) {
    return new YamlHippoError(code, message, {
      ...token.start,
      endOffset: token.end.offset > token.start.offset ? token.end.offset : token.start.offset + 1,
      found: describeToken(token),
      ...fields,
    });
  }

  currentPath() {
    return this.containerPath(this.frames.length);
  }

  /** The path of the collection at frames[depth] (frames.length → the current child). */
  containerPath(depth) {
    const segments = [];
    for (let i = 0; i < depth; i++) {
      const frame = this.frames[i];
      if (frame.kind === "object") {
        if (frame.key === null) break;
        segments.push(frame.key.key);
      } else {
        segments.push(frame.node.items.length);
      }
    }
    return formatPath(segments);
  }

  openStack() {
    return this.frames.map((f) => ({ kind: f.kind, line: f.node.start.line, column: f.node.start.column, offset: f.node.start.offset }));
  }
}

/** A string as it might be quoted in a message. */
function quoted(text) {
  return `"${text}"`;
}

/**
 * An entry's key: the string a path and the tree show, the key's text
 * position, and its node. Keys are usually strings; numbers, booleans and
 * null show as written; a collection used as a key shows in flow style.
 */
export function makeKey(node) {
  const key = keyString(node);
  const start = node.start;
  const end = node.end ?? node.start;
  return {
    key,
    node,
    keyToken: { type: "KEY", value: key, raw: node.raw ?? key, line: start.line, column: start.column, offset: start.offset, endOffset: end.offset },
  };
}

export function keyString(node, depth = 0) {
  switch (node.kind) {
    case "string":
      return node.value;
    case "number":
      return node.json ?? node.value;
    case "boolean":
      return node.value ? "true" : "false";
    case "null":
      return node.raw === "" ? "" : "null";
    case "alias":
      return `*${node.name}`;
    case "array":
      if (depth > 8) return "[…]";
      return `[${node.items.map((n) => keyString(n, depth + 1)).join(", ")}]`;
    case "object":
      if (depth > 8) return "{…}";
      return `{${node.entries.map((e) => `${e.key}: ${keyString(e.value, depth + 1)}`).join(", ")}}`;
    default:
      return "";
  }
}
