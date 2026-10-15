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
 * resolve.js — what type a scalar is.
 *
 * Plain (unquoted) scalars are resolved by the YAML 1.2 core schema, and
 * only by it:
 *
 *   null     ~  null  Null  NULL  (and the empty value)
 *   boolean  true True TRUE false False FALSE
 *   integer  123  -7  0o17  0x1F
 *   float    1.5  -2e10  .5  .inf  -.Inf  .nan
 *
 * Everything else is a string — including `yes`, `no`, `on`, `off`, `0755`
 * read as octal and `1:30` read as base 60, which YAML 1.1 parsers turn into
 * booleans and numbers. YamlHippo does not coerce them; the linter
 * points them out instead, because another parser may.
 *
 * Quoted and block scalars are always strings. A !!tag overrides all of it.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

const NULLS = new Set(["", "~", "null", "Null", "NULL"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);

const INT_DEC = /^[-+]?[0-9]+$/;
const INT_OCT = /^0o[0-7]+$/;
const INT_HEX = /^0x[0-9a-fA-F]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INF = /^[-+]?\.(?:inf|Inf|INF)$/;
const NAN = /^\.(?:nan|NaN|NAN)$/;

/** The standard tags, by full name. */
export const YAML_TAG = "tag:yaml.org,2002:";
export const STD = Object.freeze({
  str: `${YAML_TAG}str`,
  int: `${YAML_TAG}int`,
  float: `${YAML_TAG}float`,
  bool: `${YAML_TAG}bool`,
  null: `${YAML_TAG}null`,
  map: `${YAML_TAG}map`,
  seq: `${YAML_TAG}seq`,
  binary: `${YAML_TAG}binary`,
  timestamp: `${YAML_TAG}timestamp`,
  set: `${YAML_TAG}set`,
  omap: `${YAML_TAG}omap`,
  pairs: `${YAML_TAG}pairs`,
  merge: `${YAML_TAG}merge`,
  value: `${YAML_TAG}value`,
});
const KNOWN = new Set(Object.values(STD));

/** True for a tag YamlHippo knows; anything else is "custom" and left alone. */
export function isStandardTag(full) {
  return KNOWN.has(full) || full === "!";
}

export const isNull = (text) => NULLS.has(text);
export const isBool = (text) => TRUES.has(text) || FALSES.has(text);
export const isInt = (text) => INT_DEC.test(text) || INT_OCT.test(text) || INT_HEX.test(text);
export const isFloat = (text) => FLOAT.test(text) || INF.test(text) || NAN.test(text);

/**
 * A plain scalar's type under the core schema:
 * { kind: 'null'|'boolean'|'number'|'string', value, json? }
 * Numbers keep their source text as `value` (like JsonHippo); `json` is the
 * same number written as JSON, exactly (see jsonNumber).
 */
export function resolvePlain(text) {
  const c = text.charCodeAt(0);
  // Most plain scalars are words: skip the tests that can't match.
  if (text === "" || c === 0x7e || c === 0x6e || c === 0x4e) {
    if (NULLS.has(text)) return { kind: "null", value: null };
  }
  if (c === 0x74 || c === 0x54) {
    if (TRUES.has(text)) return { kind: "boolean", value: true };
  } else if (c === 0x66 || c === 0x46) {
    if (FALSES.has(text)) return { kind: "boolean", value: false };
  }
  if ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2b || c === 0x2e) {
    if (isInt(text) || isFloat(text)) return { kind: "number", value: text, json: jsonNumber(text) };
  }
  return { kind: "string", value: text };
}

/**
 * A YAML number written as JSON, without going through a double (so
 * 12345678901234567890 keeps every digit): 0x1F → "31", 0o17 → "15",
 * +1.5 → "1.5", .5 → "0.5", 1. → "1", 007 → "7". .inf and .nan have no JSON
 * form: null.
 */
export function jsonNumber(text) {
  if (INT_HEX.test(text)) return BigInt(text).toString();
  if (INT_OCT.test(text)) return BigInt(text).toString();
  if (INF.test(text) || NAN.test(text)) return null;
  const m = /^([-+]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([-+]?[0-9]+))?$/.exec(text);
  if (m === null) return null;
  const sign = m[1] === "-" ? "-" : "";
  const int = m[2].replace(/^0+(?=[0-9])/, "") || "0";
  const frac = m[3] ? `.${m[3]}` : "";
  const exp = m[4] !== undefined ? `e${m[4]}` : "";
  return `${sign}${int}${frac}${exp}`;
}

/** The JS number a YAML number denotes, including ±Infinity and NaN. */
export function numberValue(node) {
  if (node.json !== null && node.json !== undefined) return Number(node.json);
  const raw = node.value;
  if (NAN.test(raw)) return NaN;
  return raw.startsWith("-") ? -Infinity : Infinity;
}
