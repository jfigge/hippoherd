/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of MarkHippo.
 *
 * MarkHippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * MarkHippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with MarkHippo. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * tokenizer.js — a small table-driven tokenizer, enough to colour code
 * convincingly without parsing it.
 *
 * A language is an ordered list of rules, each [regex, token, when?]:
 *
 *   regex   matched at the current position (it is made sticky)
 *   token   the token name, null for text that stays plain, or a function
 *           (text, ctx) → name | null that decides from context
 *   when    optional (ctx) → boolean: the rule is only tried when it says so
 *
 * The first rule that matches at a position wins; if none does, one
 * character stays plain and the scan moves on. `ctx` carries:
 *
 *   prev    the last token that was not whitespace, { text, token }, or null
 *           at the start (how a / after a value is told from a regex)
 *   code    the whole code; `at`, where the rule is being tried; and, for a
 *           token function, `end`, the offset just after its match (for
 *           looking ahead: is the next thing a "("?)
 *   state   an object the language's rules may keep their own state in
 *           (CSS's brace depth, HTML's inside-a-tag)
 */

export function tokenizer(rules) {
  const compiled = rules.map(([re, token, when]) => ({
    re: new RegExp(re.source, re.flags.replace(/[gy]/g, "") + "y"),
    token,
    when,
  }));
  return (code) => {
    const out = [];
    const ctx = { prev: null, code, end: 0, state: {} };
    let at = 0;
    while (at < code.length) {
      let matched = false;
      ctx.at = at;
      for (const rule of compiled) {
        if (rule.when && !rule.when(ctx)) continue;
        rule.re.lastIndex = at;
        const m = rule.re.exec(code);
        if (!m || m[0].length === 0) continue;
        const text = m[0];
        ctx.end = at + text.length;
        const token = typeof rule.token === "function" ? rule.token(text, ctx) : rule.token;
        if (token) out.push([at, ctx.end, token]);
        if (/\S/.test(text)) ctx.prev = { text, token: token ?? null };
        at = ctx.end;
        matched = true;
        break;
      }
      if (!matched) {
        if (/\S/.test(code[at])) ctx.prev = { text: code[at], token: null };
        at++;
      }
    }
    return out;
  };
}

// A Set of the space-separated words in `s`.
export const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

// The next character after the match that is not a space or tab.
export function nextChar(ctx) {
  let i = ctx.end;
  while (ctx.code[i] === " " || ctx.code[i] === "\t") i++;
  return ctx.code[i] ?? "";
}
