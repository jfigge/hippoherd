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
 * linter.js — warnings for YAML that is valid but suspect.
 *
 * Errors mean "this is not YAML"; warnings mean "this is YAML, but look
 * here" — above all at the values another parser would read differently.
 * The linter never stops a parse.
 *
 * It does not walk the document itself. The parser already visits every
 * container, key and value as it builds the tree, so it calls the linter as
 * it goes — `parse(text, { lint: new Linter() })` — and a parse without a
 * linter does no lint work at all. The linter hands each event to the rules
 * that asked for it:
 *
 *   open(node)    a mapping or a list starts; `node` is the new collection
 *   close(node)   … and ends
 *   key(token)    a mapping key (its keyToken: { value, raw, line, column, … })
 *   value(node)   a scalar or an alias
 *   anchor(token, redefined)  an &anchor; redefined if the name was used before
 *
 * A rule (rules.js) is independent of the others:
 *
 *   { code, label, create(report) → { open?, close?, key?, value?, anchor? } }
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
    this.onAnchor = pick("anchor");
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

  anchor(token, redefined) {
    for (const f of this.onAnchor) f(token, redefined);
  }

  /** `at` is a token ({ line, column, offset, endOffset }) or an AST node ({ start, end }). */
  report(rule, at, message, extra = {}) {
    this.total++;
    if (this.warnings.length >= this.max) return;
    const start = at.start ?? at;
    const end = at.end ? at.end.offset : (at.endOffset ?? start.offset);
    this.warnings.push({
      code: rule.code,
      label: rule.label,
      message,
      line: start.line,
      column: start.column,
      offset: start.offset,
      endOffset: end,
      path: this.path(),
      target: at,
      ...extra,
    });
  }
}
