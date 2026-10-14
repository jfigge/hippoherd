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
 * languages.js — the languages the code plugin colours. Each is
 *
 *   { id, name, aliases, tokenize }
 *
 * built on tokenizer.js. They are deliberately lexical: comments, strings,
 * numbers, keywords, and a little context (a name before "(" is a call, a
 * name after "def" is a function). That is what reads well in a document;
 * it is not a compiler.
 *
 * Tokens: comment string number literal keyword type function property
 * variable regex meta tag attr inserted deleted.
 */

import { nextChar, tokenizer, words } from "./tokenizer.js";

// ── Shared rules ─────────────────────────────────────────────────────────────

const SPACE = [/\s+/, null];
const LINE_COMMENT = [/\/\/.*/, "comment"];
const BLOCK_COMMENT = [/\/\*[^]*?(?:\*\/|$)/, "comment"];
const HASH_COMMENT = [/#.*/, "comment"];
const DQ_STRING = [/"(?:\\.|[^\\"\n])*"?/, "string"];
const SQ_STRING = [/'(?:\\.|[^\\'\n])*'?/, "string"];
const NUMBER = [/0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[a-zA-Z]*/, "number"];
// A word that is not one of the above: kept plain, but consumed whole so a
// keyword is never found inside a longer name.
const WORD = [/[\w$]+/, null];

// Classify an identifier: keyword, literal, type, a call, or plain.
function identifier({ keywords, literals = new Set(), types = new Set(), builtins = new Set(), capitalTypes = true }) {
  return (text, ctx) => {
    const afterDot = ctx.prev && ctx.prev.text === ".";
    if (!afterDot && keywords.has(text)) return "keyword";
    if (!afterDot && literals.has(text)) return "literal";
    if (types.has(text)) return "type";
    if (nextChar(ctx) === "(") return "function";
    if (!afterDot && builtins.has(text)) return "function";
    if (capitalTypes && /^[A-Z][a-z0-9]/.test(text) && /[a-z]/.test(text)) return "type";
    return null;
  };
}

function language(id, name, aliases, rules) {
  return { id, name, aliases, tokenize: tokenizer(rules) };
}

// ── JavaScript / TypeScript ──────────────────────────────────────────────────

const JS_KEYWORDS =
  "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield";
const TS_KEYWORDS =
  " abstract as declare enum implements interface is keyof namespace private protected public readonly satisfies type infer module override";
const JS_LITERALS = words("true false null undefined NaN Infinity");
const TS_TYPES = words("string number boolean any unknown never object symbol bigint void");

// A "/" starts a regex where a value cannot end: at the start, after an
// operator or opening bracket, or after a keyword like return.
const REGEX_AFTER_KEYWORD = words("return typeof case do else in of new delete void throw yield await instanceof");
function regexAllowed({ prev }) {
  if (!prev) return true;
  if (prev.token === "keyword") return REGEX_AFTER_KEYWORD.has(prev.text);
  return prev.token === null && /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev.text);
}

function javascript(id, name, aliases, ts) {
  const keywords = words(JS_KEYWORDS + (ts ? TS_KEYWORDS : ""));
  return language(id, name, aliases, [
    SPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    [/`(?:\\[^]|[^\\`])*`?/, "string"],
    DQ_STRING,
    SQ_STRING,
    [/\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/, "regex", regexAllowed],
    NUMBER,
    [/@[A-Za-z_$][\w$.]*/, "meta"],
    [/#?[A-Za-z_$][\w$]*/, identifier({ keywords, literals: JS_LITERALS, types: ts ? TS_TYPES : undefined })],
  ]);
}

// ── JSON ─────────────────────────────────────────────────────────────────────

const json = language("json", "JSON", ["jsonc", "json5", "geojson", "webmanifest"], [
  SPACE,
  LINE_COMMENT,
  BLOCK_COMMENT,
  [/"(?:\\.|[^\\"\n])*"(?=\s*:)/, "property"],
  DQ_STRING,
  [/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, "number"],
  [/(?:true|false|null)\b/, "literal"],
  WORD,
]);

// ── YAML ─────────────────────────────────────────────────────────────────────

// The end of a plain scalar: end of line, a comment, or a flow delimiter.
const YAML_END = String.raw`(?=[ \t]*(?:$|\n|#|,|\]|\}))`;

// Where a key can start: first on its line, or after "- ", "? ", "{" or ","
// — so the key rule is tried once per entry, not at every word.
function yamlKeyPosition(ctx) {
  let i = ctx.at - 1;
  while (i >= 0 && (ctx.code[i] === " " || ctx.code[i] === "\t")) i--;
  return i < 0 || "\n-?{,".includes(ctx.code[i]);
}

const yaml = language("yaml", "YAML", ["yml"], [
  SPACE,
  [/(?<=^|\s)#.*/, "comment"],
  [/(?<=^|\n)(?:---|\.\.\.)(?=\s|$)/, "meta"],
  [/(?<=^|\n)%.*/, "meta"],
  [/"(?:\\.|[^\\"])*"?(?=[ \t]*:(?:\s|$))/, "property"],
  [/[^\s#:'"\-?{}[\],&*!|>%@`][^\n:#,[\]{}]*(?=:(?:\s|$))/, "property", yamlKeyPosition],
  [/-(?=[ \t])/, null],
  [/"(?:\\[^]|[^\\"])*"?/, "string"],
  [/'(?:''|[^'])*'?/, "string"],
  [/[&*][^\s,[\]{}]+/, "variable"],
  [/!!?[\w/.-]*/, "type"],
  [/[|>][-+0-9]*(?=[ \t]*(?:#.*)?(?:$|\n))/, "meta"],
  [new RegExp(String.raw`[-+]?(?:0x[\da-fA-F]+|0o[0-7]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|\.inf|\.nan)` + YAML_END, "i"), "number"],
  [new RegExp(`(?:true|false|yes|no|on|off|null|~)${YAML_END}`, "i"), "literal"],
  [/[^\s,[\]{}#:]+/, null],
]);

// ── Python ───────────────────────────────────────────────────────────────────

const PY_KEYWORDS = words(
  "and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield",
);
const PY_BUILTINS = words(
  "abs all any bool bytes callable chr dict dir divmod enumerate filter float format frozenset getattr hasattr hash help hex id input int isinstance issubclass iter len list map max min next object open ord pow print property range repr reversed round set setattr slice sorted staticmethod classmethod str sum super tuple type vars zip",
);

const pyIdentifier = identifier({ keywords: PY_KEYWORDS, builtins: PY_BUILTINS });

const python = language("python", "Python", ["py", "py3", "python3", "gyp"], [
  SPACE,
  HASH_COMMENT,
  [/[rRbBuUfF]{0,2}(?:"""[^]*?(?:"""|$)|'''[^]*?(?:'''|$))/, "string"],
  [/[rRbBuUfF]{0,2}(?:"(?:\\.|[^\\"\n])*"?|'(?:\\.|[^\\'\n])*'?)/, "string"],
  [/@[\w.]+/, "meta"],
  NUMBER,
  [
    /[A-Za-z_]\w*/,
    (text, ctx) => {
      const prev = ctx.prev && ctx.prev.text;
      if (prev === "def") return "function";
      if (prev === "class") return "type";
      if (prev !== "." && (text === "True" || text === "False" || text === "None")) return "literal";
      if (prev !== "." && (text === "self" || text === "cls")) return "variable";
      return pyIdentifier(text, ctx);
    },
  ],
]);

// ── C family ─────────────────────────────────────────────────────────────────

function cLike(id, name, aliases, { keywords, types = "", literals = "true false null", extra = [], hashLines = false }) {
  const classify = identifier({ keywords: words(keywords), types: words(types), literals: words(literals) });
  return language(id, name, aliases, [
    SPACE,
    LINE_COMMENT,
    BLOCK_COMMENT,
    ...(hashLines ? [[/#[ \t]*[a-z]+(?:\\\n|[^\n])*/, "meta"]] : []),
    ...extra,
    DQ_STRING,
    SQ_STRING,
    NUMBER,
    [/@[A-Za-z_][\w.]*/, "meta"],
    [/[A-Za-z_]\w*/, classify],
  ]);
}

const C_KEYWORDS =
  "auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local";
const C_TYPES =
  "char double float int long short signed unsigned void bool size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE";

const c = cLike("c", "C", ["h"], { keywords: C_KEYWORDS, types: C_TYPES, literals: "NULL true false", hashLines: true });

const cpp = cLike("cpp", "C++", ["c++", "cc", "cxx", "hpp", "hh", "hxx", "h++"], {
  keywords:
    C_KEYWORDS +
    " alignas alignof catch class concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept operator override private protected public reinterpret_cast requires static_assert static_cast template this throw try typeid typename using virtual",
  types: C_TYPES + " wchar_t char8_t char16_t char32_t string vector map set unique_ptr shared_ptr",
  literals: "nullptr NULL true false",
  hashLines: true,
});

const java = cLike("java", "Java", [], {
  keywords:
    "abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package permits private protected public record return sealed static strictfp super switch synchronized this throw throws transient try var volatile while yield",
  types: "boolean byte char double float int long short void",
});

const csharp = cLike("csharp", "C#", ["cs", "c#"], {
  keywords:
    "abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach get goto if implicit in init interface internal is lock namespace new operator out override params partial private protected public readonly record ref return sealed set sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using var virtual volatile when where while yield",
  types: "bool byte char decimal double dynamic float int long nint nuint object sbyte short string uint ulong ushort void",
  extra: [[/@"(?:""|[^"])*"?|\$"(?:\\.|[^\\"\n])*"?/, "string"]],
});

const go = cLike("go", "Go", ["golang"], {
  keywords:
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
  types:
    "any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr",
  literals: "true false nil iota",
  extra: [[/`[^`]*`?/, "string"]],
});

const rust = cLike("rust", "Rust", ["rs"], {
  keywords:
    "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
  types: "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box",
  literals: "true false None Some Ok Err",
  extra: [
    [/r#*"[^]*?"#*/, "string"],
    [/'(?:\\.|[^\\'\n])'/, "string"],
    [/'[A-Za-z_]\w*/, "variable"],
    [/[A-Za-z_]\w*!(?!=)/, "function"],
  ],
});

const swift = cLike("swift", "Swift", [], {
  keywords:
    "actor associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate final for func guard if import in init inout internal is let mutating nonisolated open operator override private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws try typealias var weak where while any",
  types: "Int Int8 Int16 Int32 Int64 UInt Double Float Bool String Character Array Dictionary Set Optional Void",
  literals: "true false nil",
  extra: [[/"""[^]*?(?:"""|$)/, "string"]],
});

const kotlin = cLike("kotlin", "Kotlin", ["kt", "kts"], {
  keywords:
    "abstract as break by catch class companion const constructor continue data do else enum external final finally for fun get if import in infix init inline inner interface internal is lateinit object open operator out override package private protected public reified return sealed set super suspend this throw try typealias val var vararg when where while",
  types: "Any Boolean Byte Char Double Float Int Long Nothing Short String Unit",
  extra: [[/"""[^]*?(?:"""|$)/, "string"]],
});

// ── CSS ──────────────────────────────────────────────────────────────────────

const css = language("css", "CSS", ["scss", "less", "sass"], [
  SPACE,
  BLOCK_COMMENT,
  [/\/\/.*/, "comment", (ctx) => !ctx.prev || ctx.prev.text !== ":"],
  DQ_STRING,
  SQ_STRING,
  [/[{}]/, braces],
  [/@[\w-]+/, "keyword"],
  [/!important\b/i, "keyword"],
  [/url\([^)\n]*\)?/, "string"],
  [/[\w-]+(?=\s*:(?!:))/, "property", (ctx) => (inBlock(ctx) && !nestedSelector(ctx)) || ctx.prev?.text === "("],
  [/#[\da-fA-F]{3,8}\b/, "number", inBlock],
  [/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/, "number"],
  [/[\w-]+(?=\()/, "function"],
  [/[.#][\w-]+/, "type", (ctx) => !inBlock(ctx) || ctx.prev?.text === "&"],
  [/::?[\w-]+/, "keyword", (ctx) => !inBlock(ctx)],
  [/[\w-]+/, (text, ctx) => (inBlock(ctx) ? null : "tag")],
]);

// Brace depth: inside a block are declarations, outside are selectors.
function braces(text, ctx) {
  ctx.state.depth = Math.max(0, (ctx.state.depth ?? 0) + (text === "{" ? 1 : -1));
  return null;
}

function inBlock(ctx) {
  return (ctx.state.depth ?? 0) > 0;
}

// In a block, `a:hover {` (nested, as Sass and modern CSS allow) is a
// selector, not a declaration. The look-ahead is bounded (200 characters,
// and never past ; { } or a line end) so it stays linear on long lines.
const reNestedSelector = /[\w-]+\s*:[^;{}\n]{0,200}\{/y;
function nestedSelector(ctx) {
  reNestedSelector.lastIndex = ctx.at;
  return reNestedSelector.test(ctx.code);
}

// ── HTML / XML ───────────────────────────────────────────────────────────────

const inTag = (ctx) => Boolean(ctx.state.tag);

function openTag(text, ctx) {
  ctx.state.tag = true;
  return "tag";
}

function closeTag(text, ctx) {
  if (!ctx.state.tag) return null;
  ctx.state.tag = false;
  return "tag";
}

const html = language("html", "HTML", ["xml", "svg", "xhtml", "htm", "vue", "rss", "plist"], [
  SPACE,
  [/<!--[^]*?(?:-->|$)/, "comment"],
  [/<!\[CDATA\[[^]*?(?:\]\]>|$)/, "string"],
  [/<![A-Za-z][^>]*>?|<\?[^]*?(?:\?>|$)/, "meta"],
  [/<\/?[A-Za-z][\w:.-]*/, openTag],
  [/\/?>/, closeTag],
  [/[^\s"'<>/=]+/, "attr", inTag],
  [/"[^"]*"?|'[^']*'?/, "string", inTag],
  [/&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][\w]*);/, "literal"],
  [/[^<&\s]+/, null, (ctx) => !inTag(ctx)],
]);

// ── Shell ────────────────────────────────────────────────────────────────────

const SH_KEYWORDS = words(
  "if then else elif fi for in do done while until case esac function select return exit break continue local export readonly declare unset source alias time",
);

const shell = language("shell", "Shell", ["sh", "bash", "zsh", "ksh", "console", "shellsession", "terminal"], [
  SPACE,
  [/(?<=^|\s)#.*/, "comment"],
  [/"(?:\\[^]|[^\\"])*"?/, "string"],
  [/\$?'[^']*'?/, "string"],
  [/\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@#?$!*-])/, "variable"],
  [/(?<=^|\s)--?[\w-]+(?:=)?/, "attr"],
  [/[\w./-]+/, (text, ctx) => (SH_KEYWORDS.has(text) && commandPosition(ctx, text) ? "keyword" : null)],
]);

// A keyword only counts where a command could start: first on its line,
// after ; & | or (, or after another keyword (then, do, else…).
function commandPosition(ctx, text) {
  if (!ctx.prev || /[;&|(]$/.test(ctx.prev.text) || ctx.prev.token === "keyword") return true;
  let i = ctx.end - text.length - 1;
  while (i >= 0 && (ctx.code[i] === " " || ctx.code[i] === "\t")) i--;
  return i < 0 || ctx.code[i] === "\n";
}

// ── SQL ──────────────────────────────────────────────────────────────────────

const SQL_KEYWORDS = words(
  "add all alter and any as asc begin between by case cascade check column commit constraint create cross database default delete desc distinct drop else end exists foreign from full group having if in index inner insert intersect into is join key left like limit not null offset on or order outer primary references replace returning right rollback select set table then transaction trigger truncate union unique update using values view when where with",
);
const SQL_TYPES = words(
  "bigint binary bit blob boolean char date datetime decimal double float int integer interval json jsonb money numeric real serial smallint text time timestamp timestamptz uuid varchar",
);

const sql = language("sql", "SQL", ["mysql", "postgresql", "postgres", "psql", "sqlite", "plsql", "tsql"], [
  SPACE,
  [/--.*/, "comment"],
  BLOCK_COMMENT,
  [/'(?:''|[^'])*'?/, "string"],
  [/"(?:""|[^"])*"?|`[^`]*`?/, "variable"],
  [/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, "number"],
  [/[:@$]\w+|\?/, "variable"],
  [
    /[A-Za-z_]\w*/,
    (text, ctx) => {
      const lower = text.toLowerCase();
      if (lower === "true" || lower === "false" || lower === "null") return "literal";
      if (SQL_KEYWORDS.has(lower)) return "keyword";
      if (SQL_TYPES.has(lower)) return "type";
      return nextChar(ctx) === "(" ? "function" : null;
    },
  ],
]);

// ── INI / TOML ───────────────────────────────────────────────────────────────

const ini = language("ini", "INI / TOML", ["toml", "cfg", "conf", "properties", "editorconfig", "gitconfig"], [
  SPACE,
  [/(?<=^|\s)[#;].*/, "comment"],
  [/(?<=^|\n)[ \t]*\[\[?[^\]\n]*\]\]?/, "type"],
  [/(?<=^|\n)[ \t]*[\w."-]+(?=[ \t]*[=:])/, "property"],
  [/"""[^]*?(?:"""|$)|'''[^]*?(?:'''|$)/, "string"],
  DQ_STRING,
  SQ_STRING,
  [/(?:true|false)\b/, "literal"],
  [/[-+]?(?:\d[\d_:.T-]*(?:[eE][+-]?\d+)?Z?|inf|nan)\b/, "number"],
  [/[^\s=,[\]{}"']+/, null],
]);

// ── Diff ─────────────────────────────────────────────────────────────────────

const diff = language("diff", "Diff", ["patch", "udiff"], [
  [/(?<=^|\n)(?:diff |index |\+\+\+ |--- |@@).*/, "meta"],
  [/(?<=^|\n)\+.*/, "inserted"],
  [/(?<=^|\n)-.*/, "deleted"],
  [/[^\n]+|\n/, null],
]);

// ── Dockerfile ───────────────────────────────────────────────────────────────

const dockerfile = language("dockerfile", "Dockerfile", ["docker", "containerfile"], [
  SPACE,
  [/(?<=^|\n)[ \t]*#.*/, "comment"],
  [
    /(?<=^|\n)[ \t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i,
    "keyword",
  ],
  DQ_STRING,
  SQ_STRING,
  [/\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*)/, "variable"],
  [/--[\w-]+/, "attr"],
  [/[^\s"'$]+/, null],
]);

export const LANGUAGES = [
  javascript("javascript", "JavaScript", ["js", "jsx", "mjs", "cjs", "node"], false),
  javascript("typescript", "TypeScript", ["ts", "tsx", "mts", "cts"], true),
  json,
  yaml,
  python,
  html,
  css,
  shell,
  sql,
  c,
  cpp,
  csharp,
  java,
  kotlin,
  go,
  rust,
  swift,
  ini,
  dockerfile,
  diff,
];
