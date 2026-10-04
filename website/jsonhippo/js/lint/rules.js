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
 * rules.js — the linter's checks, one object each (see linter.js for the
 * shape). To add a check, write one more and put it in RULES.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { clip } from "../parser/errors.js";
import { canonicalNumber, isIntegerLiteral } from "../numbers.js";

/** "line 3, col 5" */
const at = (pos) => `line ${pos.line}, col ${pos.column}`;

/**
 * The same key twice in one object. Legal JSON, but only one of the values
 * survives a parse — the last, in most parsers — so the other is silently
 * lost. Every repeat is flagged, each pointing back at the first.
 */
export const duplicateKeys = {
  code: "DUPLICATE_KEY",
  label: "Duplicate key",
  create(report) {
    // The open objects, innermost last: each one's keys so far (a Map from
    // its first key on). Arrays hold no keys, so they are not on it.
    const objects = [];
    return {
      open(node) {
        if (node.kind === "object") objects.push(null);
      },
      close(node) {
        if (node.kind === "object") objects.pop();
      },
      key(token) {
        const top = objects.length - 1;
        if (objects[top] === null) objects[top] = new Map();
        const first = objects[top].get(token.value);
        if (first === undefined) {
          objects[top].set(token.value, token);
          return;
        }
        report(token, `duplicate key ${clip(token.raw)} (first defined at ${at(first)}) — most parsers keep only the last value`, {
          key: token.value,
          first: { line: first.line, column: first.column, offset: first.offset },
        });
      },
    };
  },
};

/** A key that is the empty string: legal, but almost always a name that went missing. */
export const emptyKeys = {
  code: "EMPTY_KEY",
  label: "Empty key",
  create(report) {
    return {
      key(token) {
        if (token.value === "") report(token, 'empty key "" — usually a field name that went missing');
      },
    };
  },
};

/** Integers past ±(2^53 − 1) are not all exact as 64-bit floats. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * A number that changes when it is read as a 64-bit float — what JavaScript,
 * and most JSON libraries by default, turn every number into:
 *
 *   - an integer (written without a fraction or exponent) beyond the safe
 *     range, ±(2^53 − 1);
 *   - any other number whose value does not survive the round trip: read it
 *     as a double, write that double back in the shortest form that reads
 *     the same (what every JSON writer does), and the value has changed.
 *     That covers too many digits (3.141592653589793238), too large (1e400,
 *     which becomes Infinity) and too small (1e-400, which becomes 0).
 *
 * 1.50 and 1E+2 are not flagged: written back as 1.5 and 100 they are the
 * same numbers.
 */
export const numberPrecision = {
  code: "NUMBER_PRECISION",
  label: "Precision loss",
  create(report) {
    return {
      value(node) {
        if (node.kind !== "number") return;
        const raw = node.raw;
        // Up to 15 characters without an exponent is at most 15 significant
        // digits in the normal range: always exact. Most numbers stop here.
        if (raw.length <= 15 && raw.indexOf("e") === -1 && raw.indexOf("E") === -1) return;

        const n = Number(raw);
        const becomes = String(n);
        const shown = clip(raw);
        if (!Number.isFinite(n)) {
          report(node, `${shown} is too large for a 64-bit float: it becomes ${becomes}`, { becomes });
          return;
        }
        const exact = canonicalNumber(raw) === canonicalNumber(becomes);
        if (isIntegerLiteral(raw)) {
          if (Math.abs(n) <= MAX_SAFE && exact) return;
          const what = exact ? "exact as a 64-bit float, but its neighbours are not" : `as a 64-bit float it becomes ${becomes}`;
          report(node, `${shown} is beyond the safe integer range (±2^53−1): ${what}`, { becomes });
          return;
        }
        if (exact) return;
        if (n === 0) report(node, `${shown} is too small for a 64-bit float: it becomes 0`, { becomes });
        else report(node, `${shown} has more digits than a 64-bit float holds: it becomes ${becomes}`, { becomes });
      },
    };
  },
};

/** Every check, in the order their warnings are described in the docs. */
export const RULES = [duplicateKeys, emptyKeys, numberPrecision];
