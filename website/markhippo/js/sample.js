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
 * sample.js — the document shown the first time MarkHippo opens: a short
 * tour that doubles as a check that every CommonMark construct renders.
 */

export const SAMPLE = `# Welcome to MarkHippo

Write **markdown** on the left and see it rendered on the right. The source
is coloured by the same parser as the preview, so you see what it understood
as you type; the preview catches up a moment after you stop.

MarkHippo reads markdown with *its own* parser — every construct of
[CommonMark](https://commonmark.org/), and nothing you write leaves this
machine. Open a \`.md\` file with **Open…**, or drop one on the page.

## Things to try

Type \`/\` at the start of a line for headings, lists, quotes and code
blocks, or press Ctrl+Space (Alt+/ on a Mac) anywhere: MarkHippo suggests what fits there.

- Lists, which can be
  1. ordered,
  2. nested,
  3. and *tight* or loose
- Block quotes:

  > Markdown is intended to be as easy-to-read and easy-to-write as is
  > feasible.

- Code, inline like \`const x = 1\` or fenced:

\`\`\`js
function hello(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Links and images

An inline [link](https://hippoherd.com/ "Hippo Herd"), a [reference
link][herd], and an autolink: <https://hippoherd.com/markhippo/>. Images
are written the same way as links, with a \`!\` in front:
\`![alt text](picture.png)\`.

[herd]: https://hippoherd.com/

## Beyond CommonMark

Plugins add GitHub's extensions, math and diagrams — each can be switched
off under **Plugins**.

| Feature       | Written as          | Status |
| :------------ | :------------------ | :----: |
| Tables        | pipes and dashes    |   ✓    |
| ~~Strikeout~~ | \`~~text~~\`          |   ✓    |
| Math          | \`$e^{i\\pi} + 1 = 0$\` | $e^{i\\pi} + 1 = 0$ |

- [x] Tick a task in the preview, and the source follows
- [ ] Bare links like www.hippoherd.com work too
- [ ] Footnotes, like this one[^tour]

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`mermaid
flowchart LR
  Write --> Parse --> Preview
  Parse --> Colour[Coloured source]
\`\`\`

[^tour]: Footnotes are listed at the end, with links back.

---

Try deleting the closing fence of the code block above: everything after it
becomes code, on both sides. That is the parser telling you exactly what it
understood.
`;
