/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of JsonHippo.
 *
 * JsonHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * JsonHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with JsonHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * numbers.js — a JSON number's value, read from its source text.
 *
 * JSON numbers are decimal and unbounded; a 64-bit float is neither. These
 * helpers work on the text, so they can say what a number IS before anything
 * rounds it.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

/** Written as an integer: no fraction, no exponent ("12", "-3", not "1.0" or "1e3"). */
export function isIntegerLiteral(raw) {
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x2e || c === 0x65 || c === 0x45) return false; // . e E
  }
  return true;
}

/**
 * A number's value as a canonical string, so "1.0", "1", "1e0" and "10e-1"
 * compare equal — exactly, at any precision, never through a double.
 */
export function canonicalNumber(raw) {
  let s = raw;
  let negative = false;
  if (s[0] === "-") {
    negative = true;
    s = s.slice(1);
  }
  let exponent = 0;
  const e = s.search(/[eE]/);
  if (e >= 0) {
    exponent = Number(s.slice(e + 1));
    s = s.slice(0, e);
  }
  let digits = s;
  const dot = s.indexOf(".");
  if (dot >= 0) {
    digits = s.slice(0, dot) + s.slice(dot + 1);
    exponent -= s.length - dot - 1;
  }
  digits = digits.replace(/^0+/, "");
  if (digits === "") return "0"; // 0, -0, 0.000
  const trimmed = digits.replace(/0+$/, "");
  exponent += digits.length - trimmed.length;
  return `${negative ? "-" : ""}${trimmed}e${exponent}`;
}
