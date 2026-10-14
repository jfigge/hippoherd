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
 * Task lists (GFM): a list item whose text starts with [ ] or [x] (then a
 * space) gets a checkbox.
 *
 *   - [x] done
 *   - [ ] to do
 *
 * The marker is a node of its own, `task_marker { checked }`, at the start
 * of the item's first paragraph. The HTML is cmark-gfm's (a disabled
 * checkbox). With the renderer's `taskAttribute` option the checkbox is
 * live instead and carries the marker's source offset in that attribute,
 * so the app can tick it in the source when it is clicked.
 */

import { Node } from "../../parser/nodes.js";

const reMarker = /\[([ xX])\](?=[ \t])/y;

const taskMarker = {
  name: "task_marker",
  triggers: "[",
  priority: 20,
  parse(state) {
    if (state.pos !== 0) return false;
    const paragraph = state.block;
    if (paragraph.type !== "paragraph" || paragraph._parent?.type !== "item") return false;
    // Only the item's first block (definitions aside, which render nothing).
    for (let prev = paragraph._prev; prev; prev = prev._prev) {
      if (prev.type !== "link_reference_definition") return false;
    }
    reMarker.lastIndex = 0;
    const m = reMarker.exec(state.subject);
    if (!m) return false;
    state.add(new Node("task_marker", { checked: m[1] !== " " }), 0, 3);
    state.pos = 3;
    return true;
  },
};

function renderMarker(node, r) {
  const attribute = r.options.taskAttribute;
  const checked = node.checked ? ' checked=""' : "";
  if (attribute && node.pos) {
    r.lit(`<input type="checkbox"${checked} ${attribute}="${node.pos.start.offset}" aria-label="Done" />`);
  } else {
    r.lit(`<input type="checkbox"${checked} disabled="" />`);
  }
}

export default {
  id: "task-lists",
  name: "Task lists",
  version: "1.0.0",
  description: "GitHub's task lists: - [ ] and - [x] list items get checkboxes, which tick the source when clicked in the preview.",
  setup(api) {
    api.inlineRule(taskMarker);
    api.renderer("task_marker", renderMarker);
    api.highlighter("task_marker", (node, h) => h.mark(node.pos.start.offset, node.pos.end.offset, "md-task"));
    api.completions({
      context: "block",
      provide: () => [
        { label: "Task list", keywords: ["todo", "checkbox", "checklist", "[ ]"], hint: "- [ ] ", insert: "- [ ] ${task}" },
      ],
    });
  },
};
