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
 * rules.js — the linter's checks, one object each (see linter.js for the
 * shape). To add a check, write one more and put it in RULES.
 *
 * Most of them are about TYPE COERCION. YamlHippo reads YAML by the 1.2 core
 * schema, where `no` is a string and 0755 is seven hundred and fifty-five —
 * but much of the world's YAML is read by 1.1 parsers (PyYAML, many config
 * loaders), which make `no` false and 0755 octal. A value whose meaning
 * depends on the parser is a bug waiting to happen; these rules surface each
 * one instead of silently picking a side, and say what quoting it would fix.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { clip } from "../parser/errors.js";
import { canonicalNumber, isIntegerLiteral } from "../numbers.js";

/** "line 3, col 5" */
const at = (pos) => `line ${pos.line}, col ${pos.column}`;

/** An untagged plain scalar: the only kind a parser resolves by its text. */
const isPlain = (node) => node.style === "plain" && !node.tag && node.raw !== "";

/** A plain key, from its token: written without quotes. */
const isPlainKey = (token) => token.raw === token.value && token.raw !== "";

/**
 * The same key twice in one mapping. The YAML spec forbids it, but most
 * parsers accept it and keep only one of the values — the last, usually — so
 * the other is silently lost. Every repeat is flagged, pointing at the first.
 */
export const duplicateKeys = {
  code: "DUPLICATE_KEY",
  label: "Duplicate key",
  create(report) {
    // The open mappings, innermost last: each one's keys so far (a Map from
    // its first key on). Lists hold no keys, so they push null and are skipped.
    const mappings = [];
    return {
      open(node) {
        mappings.push(node.kind === "object" ? undefined : null);
      },
      close() {
        mappings.pop();
      },
      key(token) {
        const top = mappings.length - 1;
        if (top < 0 || mappings[top] === null) return;
        if (mappings[top] === undefined) mappings[top] = new Map();
        const first = mappings[top].get(token.value);
        if (first === undefined) {
          mappings[top].set(token.value, token);
          return;
        }
        report(token, `duplicate key ${clip(token.raw || '""')} (first defined at ${at(first)}) — most parsers keep only the last value`, {
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
        if (token.value === "" && token.raw !== "") report(token, 'empty key "" — usually a field name that went missing');
      },
    };
  },
};

// YAML 1.1's booleans (yaml.org/type/bool.html), minus 1.2's own true/false.
const YAML11_BOOLS = new Map(
  ["y", "Y", "yes", "Yes", "YES", "on", "On", "ON"].map((w) => [w, true]).concat(["n", "N", "no", "No", "NO", "off", "Off", "OFF"].map((w) => [w, false])),
);

/**
 * The "Norway problem": a country list with `NO` in it, read by a 1.1
 * parser, holds `false`. yes/no/on/off/y/n are strings in YAML 1.2 and
 * booleans in 1.1 — including as keys (GitHub Actions' `on:`).
 */
export const norway = {
  code: "YAML11_BOOLEAN",
  label: "1.1 boolean",
  create(report) {
    const say = (text, value, what) =>
      `${what} '${text}' is a string here (YAML 1.2), but a YAML 1.1 parser reads it as ${value} — quote it ("${text}") or write ${value} to be sure`;
    return {
      value(node) {
        if (node.kind !== "string" || !isPlain(node)) return;
        const b = YAML11_BOOLS.get(node.value);
        if (b !== undefined) report(node, say(node.value, b, "the value"), { becomes: String(b) });
      },
      key(token) {
        if (!isPlainKey(token)) return;
        const b = YAML11_BOOLS.get(token.value);
        if (b !== undefined) report(token, say(token.value, b, "the key"), { becomes: String(b) });
      },
    };
  },
};

const SEXAGESIMAL_INT = /^[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+$/;
const SEXAGESIMAL_FLOAT = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/;

/** 1:30:00 → 5400 in base 60, as a YAML 1.1 parser reads it. */
function base60(text) {
  const negative = text.startsWith("-");
  const parts = text.replace(/^[-+]/, "").replaceAll("_", "").split(":");
  let value = 0;
  for (const part of parts) value = value * 60 + Number(part);
  return negative ? -value : value;
}

/**
 * Sexagesimal numbers: YAML 1.1 reads 1:30 as 90 (base 60, for times), so a
 * port mapping `22:22` or a time `12:30` changes meaning between parsers.
 */
export const sexagesimal = {
  code: "SEXAGESIMAL",
  label: "Base-60 number",
  create(report) {
    return {
      value(node) {
        if (node.kind !== "string" || !isPlain(node)) return;
        const text = node.value;
        if (!SEXAGESIMAL_INT.test(text) && !SEXAGESIMAL_FLOAT.test(text)) return;
        const becomes = String(base60(text));
        report(node, `'${text}' is a string here (YAML 1.2), but a YAML 1.1 parser reads it as the base-60 number ${becomes} — quote it ("${text}")`, { becomes });
      },
    };
  },
};

/**
 * Numbers that 1.1 and 1.2 read differently: a leading zero (0755 is 493 in
 * 1.1, octal; 755 in 1.2) and digit separators (1_000 is 1000 in 1.1, a
 * string in 1.2).
 */
export const legacyNumbers = {
  code: "YAML11_NUMBER",
  label: "1.1 number",
  create(report) {
    return {
      value(node) {
        if (!isPlain(node)) return;
        const text = node.kind === "number" || node.kind === "string" ? node.value : null;
        if (text === null) return;
        if (node.kind === "number" && /^[-+]?0[0-7]+$/.test(text)) {
          const octal = parseInt(text.replace(/^[-+]/, ""), 8) * (text.startsWith("-") ? -1 : 1);
          report(node, `${text} is ${node.json} here (YAML 1.2), but a YAML 1.1 parser reads it as octal ${octal} — write 0o${text.replace(/^[-+]?0+/, "")} for octal, or quote it`, {
            becomes: String(octal),
          });
          return;
        }
        if (node.kind === "string" && /^[-+]?(?:0|[1-9])[0-9]*_[0-9_]*(?:\.[0-9_]*)?$/.test(text)) {
          const becomes = text.replaceAll("_", "");
          report(node, `'${text}' is a string here (YAML 1.2), but a YAML 1.1 parser reads it as the number ${becomes} — quote it, or drop the underscores`, { becomes });
        }
      },
    };
  },
};

/**
 * Versions written as numbers. `version: 1.10` is the float 1.1, and
 * `python: 3.10` becomes 3.1 — the classic CI-config bug. Flagged: any
 * float whose fraction ends in 0 (the digit is lost), and any number under
 * a key that names a version.
 */
export const versionNumbers = {
  code: "VERSION_NUMBER",
  label: "Version as a number",
  create(report) {
    let lastKey = null;
    return {
      key(token) {
        lastKey = token.value;
      },
      value(node) {
        const key = lastKey;
        lastKey = null;
        if (node.kind !== "number" || !isPlain(node)) return;
        const text = node.value;
        const fraction = /^[-+]?[0-9]*\.([0-9]+)$/.exec(text);
        if (fraction && fraction[1].endsWith("0")) {
          const becomes = String(Number(text));
          report(node, `${text} is the number ${becomes} — if it is a version, quote it ("${text}") so the trailing zero is kept`, { becomes });
          return;
        }
        if (key !== null && /version|^v$|^ver$|release/i.test(key) && /[.]/.test(text)) {
          report(node, `${key}: ${text} is a number, not text — quote it ("${text}") if it is a version, so it compares and prints as written`, { becomes: String(Number(text)) });
        }
      },
    };
  },
};

/** Integers past ±(2^53 − 1) are not all exact as 64-bit floats. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * A number that changes when it is read as a 64-bit float — what most YAML
 * libraries turn every number into: an integer beyond ±(2^53 − 1), or any
 * other number whose value does not survive the round trip (too many
 * digits, too large, too small). 1.50 and 1E+2 are not flagged: written back
 * as 1.5 and 100 they are the same numbers.
 */
export const numberPrecision = {
  code: "NUMBER_PRECISION",
  label: "Precision loss",
  create(report) {
    return {
      value(node) {
        if (node.kind !== "number" || node.json === null || node.json === undefined) return;
        const raw = node.json;
        if (raw.length <= 15 && raw.indexOf("e") === -1 && raw.indexOf("E") === -1) return;

        const n = Number(raw);
        const becomes = String(n);
        const shown = clip(node.value);
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

/** An anchor name used twice: aliases after the second refer to it, not the first. */
export const duplicateAnchors = {
  code: "DUPLICATE_ANCHOR",
  label: "Duplicate anchor",
  create(report) {
    return {
      anchor(token, redefined) {
        if (redefined) report(token, `&${token.value} is defined again — aliases from here on refer to this one, not the earlier one`);
      },
    };
  },
};

/**
 * A plain value that runs on to a line looking like a new entry:
 *
 *   - a
 *      - b       ← indented deeper, so this is the text "a - b", not an entry
 *
 * Valid YAML, and almost never what was meant.
 */
export const runOnLines = {
  code: "RUN_ON_VALUE",
  label: "Run-on value",
  create(report) {
    return {
      value(node) {
        if (node.kind !== "string" || node.style !== "plain" || node.raw.indexOf("\n") === -1) return;
        const lines = node.raw.split("\n").slice(1);
        const odd = lines.find((l) => /^\s*-\s/.test(l) || /^\s*[^\s#]+:\s*$/.test(l));
        if (!odd) return;
        report(node, `this value runs on over ${lines.length + 1} lines, including '${clip(odd.trim())}', which looks like a new entry — it is indented deeper than its siblings, so YAML reads it as more text`);
      },
    };
  },
};

/** Every check, in the order their warnings are described in the docs. */
export const RULES = [duplicateKeys, emptyKeys, norway, sexagesimal, legacyNumbers, versionNumbers, numberPrecision, duplicateAnchors, runOnLines];
