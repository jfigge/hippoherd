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
 * smart-paste.js — fix the damage YAML picks up on its way through a
 * clipboard.
 *
 * YAML pasted from a web page, a chat or a word processor breaks in ways
 * JSON does not, because its structure is whitespace:
 *
 *   tabs         editors and chat tools turn indentation into tabs, which
 *                YAML forbids
 *   indentation  a block pasted at a different depth than its siblings, or
 *                re-indented by hand: siblings at 3 spaces and 2
 *   characters   curly quotes (“ ” ‘ ’) from a word processor, no-break and
 *                zero-width spaces from a web page, a byte order mark
 *
 * detectAndFix() repairs all three and says what it did; the caller offers
 * Undo. Characters and tabs are fixed whenever they are found. Indentation
 * is only rewritten when the text does not parse as it is AND the rewritten
 * text does — re-indenting valid YAML could change what it means.
 *
 * Block scalars (| and >) are moved as a block, their inner indentation
 * kept, and their content is never touched: a tab or a curly quote inside a
 * literal block is the author's.
 *
 * Pure JS: no DOM, no jQuery. Runs in Node under `node --test`.
 */

import { parse } from "./parser/parser.js";
import { YamlHippoError } from "./parser/errors.js";

// Characters that look like a space but are not one to YAML.
const ODD_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;
// Characters that look like nothing at all.
const INVISIBLE = /\u200b|\u200c|\u200d|\u2060|\ufeff/g;

/** A line that starts a block scalar: `key: |`, `- >-`, `|2 # comment`. */
const BLOCK_HEADER = /(?:^|[\s:-])[|>][-+0-9]*\s*(?:#.*)?$/;

/**
 * @returns {{ text, fixes: [{ kind, count, message }] }} or null when there is nothing to fix.
 *   kind: 'tabs' | 'indent' | 'quotes' | 'spaces' | 'invisible'
 */
export function detectAndFix(text) {
  const fixes = [];
  let out = text;

  // ── characters (outside block scalars) ───────────────────────────────
  const lines = out.split("\n");
  const inBlock = blockScalarLines(lines);
  let quotes = 0;
  let oddSpaces = 0;
  let invisible = 0;
  let tabs = 0;
  const unit = detectUnit(lines, inBlock);
  for (let i = 0; i < lines.length; i++) {
    if (inBlock[i]) continue;
    let line = lines[i];
    line = line.replace(INVISIBLE, () => {
      invisible++;
      return "";
    });
    line = line.replace(ODD_SPACES, () => {
      oddSpaces++;
      return " ";
    });
    line = fixQuotes(line, () => quotes++);
    // Tabs in the indentation (and after a "- " that starts the line).
    const m = /^[ \t]*(?:-[ \t]+)*/.exec(line)[0];
    if (m.includes("\t")) {
      let col = 0;
      let lead = "";
      for (const ch of m) {
        if (ch === "\t") {
          const width = unit - (col % unit);
          lead += " ".repeat(width);
          col += width;
          tabs++;
        } else {
          lead += ch;
          col++;
        }
      }
      line = lead + line.slice(m.length);
    }
    lines[i] = line;
  }
  out = lines.join("\n");
  if (tabs > 0) fixes.push({ kind: "tabs", count: tabs, message: `replaced ${tabs === 1 ? "a tab" : `${tabs} tabs`} in the indentation with spaces` });
  if (quotes > 0) fixes.push({ kind: "quotes", count: quotes, message: `straightened ${quotes === 1 ? "a curly quote" : `${quotes} curly quotes`}` });
  if (oddSpaces > 0) fixes.push({ kind: "spaces", count: oddSpaces, message: `replaced ${oddSpaces === 1 ? "a no-break space" : `${oddSpaces} no-break spaces`} with ordinary spaces` });
  if (invisible > 0) fixes.push({ kind: "invisible", count: invisible, message: `removed ${invisible === 1 ? "an invisible character" : `${invisible} invisible characters`}` });

  // ── indentation, only when it is what stops the parse ────────────────
  if (!parses(out)) {
    const reindented = reindent(out);
    if (reindented !== null && reindented.text !== out && parses(reindented.text)) {
      out = reindented.text;
      fixes.push({
        kind: "indent",
        count: reindented.changed,
        message: `re-indented ${reindented.changed === 1 ? "a line" : `${reindented.changed} lines`} to ${reindented.unit} spaces a level`,
      });
    }
  }

  return fixes.length === 0 ? null : { text: out, fixes };
}

function parses(text) {
  try {
    parse(text);
    return true;
  } catch (err) {
    if (err instanceof YamlHippoError) return false;
    throw err;
  }
}

/**
 * Curly quotes: double ones always become ", single ones only where they
 * are used as quotes (at the start or end of a value), so an apostrophe in
 * "don’t" stays as written.
 */
function fixQuotes(line, count) {
  let out = line.replace(/[\u201c\u201d\u201e\u201f\u2033]/g, () => {
    count();
    return '"';
  });
  out = out.replace(/(^|[\s:,[{-])[\u2018\u201b]/g, (_m, before) => {
    count();
    return `${before}'`;
  });
  out = out.replace(/[\u2019](?=\s*(?:$|[,\]}:#]))/g, () => {
    count();
    return "'";
  });
  return out;
}

/** Which lines are the content of a block scalar (never touched). */
function blockScalarLines(lines) {
  const inside = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!BLOCK_HEADER.test(stripComment(lines[i])) && !BLOCK_HEADER.test(lines[i])) continue;
    const parent = indentOf(lines[i]);
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (indentOf(lines[j]) <= parent) break;
      inside[j] = true;
    }
    // Blank lines inside the block belong to it too.
    for (let k = i + 1; k < j; k++) if (lines[k].trim() === "") inside[k] = true;
    i = j - 1;
  }
  return inside;
}

function stripComment(line) {
  const i = line.search(/\s#/);
  return i === -1 ? line : line.slice(0, i);
}

/** Leading whitespace width, a tab counting as one column. */
function indentOf(line) {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

/** The indentation step the document mostly uses: 2 or 4 (2 when it cannot tell). */
function detectUnit(lines, inBlock = []) {
  const counts = new Map();
  let prev = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlock[i] || line.trim() === "" || /^\s*#/.test(line) || /^[ ]*\t/.test(line)) continue;
    const n = indentOf(line);
    if (n > prev) counts.set(n - prev, (counts.get(n - prev) ?? 0) + 1);
    prev = n;
  }
  const two = counts.get(2) ?? 0;
  const four = counts.get(4) ?? 0;
  return four > two ? 4 : 2;
}

/**
 * Rewrite every line's indentation from its nesting level, so siblings line
 * up and each level is `unit` spaces deeper than its parent:
 *
 *   - a line indented deeper than the line above, where that line opens a
 *     block (ends with ':', or is a '- '), is its child;
 *   - deeper below a line that does not open a block, it is a sibling that
 *     slipped (YAML would read it as run-on text);
 *   - a dedent goes back to the nearest open level at or above it.
 *
 * Returns null when there is nothing it can do (flow collections and quoted
 * strings over several lines are left alone: their lines are not levels).
 */
export function reindent(text) {
  const lines = text.split("\n");
  const inBlock = blockScalarLines(lines);
  const unit = detectUnit(lines, inBlock);
  // Open levels: { col (original), level, content (col of the text after a "- ") }
  const stack = [];
  let prevOpens = true;
  let changed = 0;
  let blockShift = 0;
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlock[i]) {
      // Only leading spaces move: a tab after them is the block's content.
      let shifted = line;
      if (line.trim() !== "" && blockShift > 0) shifted = " ".repeat(blockShift) + line;
      else if (line.trim() !== "" && blockShift < 0) {
        let n = 0;
        while (n < -blockShift && line[n] === " ") n++;
        shifted = line.slice(n);
      }
      if (shifted !== line) changed++;
      out.push(shifted);
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line) || /^(?:---|\.\.\.)(?:\s|$)/.test(line) || /^%/.test(line)) {
      out.push(line);
      if (/^(?:---|\.\.\.)/.test(line)) {
        stack.length = 0;
        prevOpens = true;
      }
      continue;
    }
    // Lines in the middle of a multi-line flow collection or quoted string: give up.
    if (/^\s*[\]}]/.test(line)) return null;

    const col = indentOf(line);
    let popped = null;
    while (stack.length > 0 && stack[stack.length - 1].col > col) popped = stack.pop();
    // A dedent between two open levels goes to the nearer one (the deeper
    // on a tie) — the same choice the error message makes.
    if (popped && stack.length > 0 && stack[stack.length - 1].col < col && popped.col - col <= col - stack[stack.length - 1].col) {
      stack.push(popped);
    }
    let level;
    const top = stack[stack.length - 1];
    if (top && (top.col === col || top === popped)) level = top.level;
    else if (!top) {
      stack.push({ col, level: 0 });
      level = 0;
    } else if (prevOpens) {
      level = top.level + 1;
      stack.push({ col, level });
    } else {
      // Deeper than a line that opens nothing: a slipped sibling.
      level = top.level;
    }

    let body = line.slice(col);
    const target = level * unit;
    // "- " entries: the text after the dash is a level of its own.
    let dashes = 0;
    let rest = body;
    const oldKeyCol = () => col + (line.slice(col).length - rest.length);
    while (/^-(?:\s+|$)/.test(rest)) {
      dashes++;
      rest = rest.replace(/^-\s*/, "");
    }
    if (dashes > 0 && rest !== "") {
      body = `${"-".padEnd(unit, " ").repeat(dashes)}${rest}`;
      stack.push({ col: oldKeyCol(), level: level + dashes });
    }
    const content = stripComment(rest === "" ? body : rest).trimEnd();
    prevOpens = content.endsWith(":") || (dashes > 0 && rest === "") || content === "-";
    if (BLOCK_HEADER.test(content)) {
      // The block's lines move as far as their header's key moved.
      blockShift = target + dashes * unit - oldKeyCol();
    }
    const rewritten = " ".repeat(target) + body;
    if (rewritten !== line) changed++;
    out.push(rewritten);
  }
  return { text: out.join("\n"), changed, unit };
}
