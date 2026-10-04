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
 * linter.js — warnings for JSON that is valid but suspect.
 *
 * Errors mean "this is not JSON"; warnings mean "this is JSON, but look
 * here". The linter never sees invalid input and never stops a parse.
 *
 * It does not walk the document itself. The parser already visits every
 * container, key and value as it builds the tree, so it calls the linter as
 * it goes — `parse(text, { lint: new Linter() })` — and a parse without a
 * linter does no lint work at all. The linter hands each event to the rules
 * that asked for it:
 *
 *   open(node)    a '{' or '[' was read; `node` is the new container
 *   close(node)   … and its closer
 *   key(token)    an object member's key (a STRING token)
 *   value(node)   a scalar: string, number, boolean or null
 *
 * A rule (rules.js) is independent of the others:
 *
 *   { code, label, create(report) → { open?, close?, key?, value? } }
 *
 * create() runs once per parse and returns the handlers, which keep whatever
 * state the rule needs in their closure. report(at, message, extra) records
 * a warning at a token or a node. A new check is one more rule in RULES; the
 * parser and the views do not change.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { RULES } from "./rules.js";

/** Warnings kept per parse. The count goes on past it; the list does not. */
export const MAX_WARNINGS = 1000;

/**
 * A warning:
 *   { code, label, message, line, column, offset, endOffset, path,
 *     target — the key token or AST node it is about (for the tree), …extra }
 */
export class Linter {
  constructor(rules = RULES, { max = MAX_WARNINGS } = {}) {
    this.rules = rules;
    this.max = max;
    this.warnings = [];
    this.total = 0;
    this.path = () => null;

    const handlers = rules.map((rule) => rule.create((at, message, extra) => this.report(rule, at, message, extra)));
    const pick = (name) => handlers.filter((h) => h[name]).map((h) => h[name]);
    this.onOpen = pick("open");
    this.onClose = pick("close");
    this.onKey = pick("key");
    this.onValue = pick("value");
  }

  /** The parser says how to name where it is: a function returning the current $.path. */
  begin(path) {
    this.path = path;
  }

  open(node) {
    for (const f of this.onOpen) f(node);
  }

  close(node) {
    for (const f of this.onClose) f(node);
  }

  key(token) {
    for (const f of this.onKey) f(token);
  }

  value(node) {
    for (const f of this.onValue) f(node);
  }

  /** `at` is a token ({ line, column, offset, endOffset }) or an AST node ({ start, end }). */
  report(rule, at, message, extra = {}) {
    this.total++;
    if (this.warnings.length >= this.max) return;
    const start = at.start ?? at;
    this.warnings.push({
      code: rule.code,
      label: rule.label,
      message,
      line: start.line,
      column: start.column,
      offset: start.offset,
      endOffset: at.end ? at.end.offset : at.endOffset,
      path: this.path(),
      target: at,
      ...extra,
    });
  }
}
