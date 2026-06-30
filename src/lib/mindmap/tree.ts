// The mindmap tree model (Mindmap module). Pure, node-testable: no React, no DOM.
//
// A mindmap is a central node with spokes, and each spoke can have spokes — i.e.
// a tree. A tree of text nodes is exactly what an indented markdown list
// expresses, so the **markdown nested list is the canonical body** (Principle 1:
// DB canonical, export one-way; Principle 2: everything is an item). The radial/
// tree canvas is a view over that one markdown body; editing the map rewrites the
// list, and a hand-authored `.md` reconstructs the map. Nothing is stored as a
// second source, and the standard markdown/OneDrive export emits the `.md` for
// free (no bespoke exporter). See explorations/mindmap-tool-prd.md.
//
// Convention (markmap-compatible):
//   # Central thing        ← the root (one `#` heading; falls back to item title)
//   - Spoke A              ← a child bullet; indentation depth = distance from root
//     - Spoke A.1
//   - Spoke B
//
// `id`s are assigned on parse for React keys and selection. They are ephemeral —
// never serialized — so a round-trip (parse → edit → serialize → parse) is stable
// regardless of ids. `collapsed` is likewise a view affordance and is NOT written
// to the markdown (PRD §3): collapsing a branch never changes the file.

export type MindNode = {
  id: string;
  text: string;
  collapsed: boolean;
  children: MindNode[];
};

// A fresh id factory per parse/build. Module-local counter is fine: ids only need
// to be unique within one in-memory tree, and a new parse restarts numbering.
let counter = 0;
function nextId(): string {
  return `n${counter++}`;
}

export function newNode(text = ""): MindNode {
  return { id: nextId(), text, collapsed: false, children: [] };
}

// --- parse: markdown nested list → tree ------------------------------------

// Tolerant by design (like the Papers outline parser): the first `# ` heading is
// the root; every `- `/`* ` bullet is a node placed by indentation; any other
// line is ignored. A file that's all bullets (no heading) synthesizes a root from
// `fallbackTitle` (the item title), so a loose markdown file still yields a sane
// map.
export function parseMindmap(markdown: string, fallbackTitle = ""): MindNode {
  const lines = markdown.split(/\r?\n/);
  let rootText = fallbackTitle.trim();

  // Find the root heading (first `# …`), if any, before the bullets start.
  let i = 0;
  for (; i < lines.length; i++) {
    const heading = /^#\s+(.*)$/.exec(lines[i]);
    if (heading) {
      rootText = heading[1].trim();
      i++;
      break;
    }
    const bullet = /^\s*[-*]\s+/.test(lines[i]);
    if (bullet) break; // bullets started before any heading → no root heading
    // blank line or stray prose before the structure: skip and keep looking.
  }

  const root = newNode(rootText);
  // Stack of (indentWidth, node); root sits at -1 so any top-level bullet nests
  // under it. A bullet deeper than the stack top is its child; equal/shallower
  // pops until it finds its parent.
  const stack: { indent: number; node: MindNode }[] = [{ indent: -1, node: root }];
  for (; i < lines.length; i++) {
    const m = /^(\s*)[-*]\s+(.*)$/.exec(lines[i]);
    if (!m) continue; // ignore non-bullet lines, keeping the parser forgiving
    const indent = m[1].replace(/\t/g, "  ").length;
    const node = newNode(m[2].trim());
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  return root;
}

// --- serialize: tree → markdown nested list --------------------------------

// The inverse of parse. Two spaces per depth level (CommonMark-friendly). The
// root becomes the `#` heading; an empty root text emits a bare `#` that re-parse
// treats as "no heading" so the item title drives the root again — a clean
// round-trip either way.
export function serializeMindmap(root: MindNode): string {
  const out: string[] = [`# ${root.text}`.trimEnd()];
  if (root.children.length) out.push("");
  const walk = (nodes: MindNode[], depth: number) => {
    for (const n of nodes) {
      out.push(`${"  ".repeat(depth)}- ${n.text}`.trimEnd());
      if (n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return out.join("\n");
}

// --- structural ops (immutable; return a new root) -------------------------
//
// Each op rebuilds only the path to the touched node and shares the rest. `id`s
// are preserved across every op, so the caller keeps focus/selection by id
// through a move. The root itself can't be removed or have a sibling.

// Replace one node's text.
export function updateText(root: MindNode, id: string, text: string): MindNode {
  const rec = (n: MindNode): MindNode =>
    n.id === id ? { ...n, text } : { ...n, children: n.children.map(rec) };
  return rec(root);
}

// Toggle a node's collapsed state (view-only; never serialized).
export function toggleCollapse(root: MindNode, id: string): MindNode {
  const rec = (n: MindNode): MindNode =>
    n.id === id
      ? { ...n, collapsed: !n.collapsed }
      : { ...n, children: n.children.map(rec) };
  return rec(root);
}

// Append a child to the node, expanding it so the new child is visible. Returns
// the new node's id (or null if the target wasn't found) so the caller can focus
// it.
export function addChild(root: MindNode, id: string): [MindNode, string | null] {
  let created: string | null = null;
  const rec = (n: MindNode): MindNode => {
    if (n.id === id) {
      const child = newNode("");
      created = child.id;
      return { ...n, collapsed: false, children: [...n.children, child] };
    }
    return { ...n, children: n.children.map(rec) };
  };
  return [rec(root), created];
}

// Insert a sibling immediately after the node. The root has no parent, so adding
// a sibling to the root returns it unchanged (the caller should add a child
// instead).
export function addSibling(root: MindNode, id: string): [MindNode, string | null] {
  let created: string | null = null;
  const rec = (n: MindNode): MindNode => {
    const idx = n.children.findIndex((c) => c.id === id);
    const children = n.children.map(rec);
    if (idx !== -1 && created === null) {
      const sib = newNode("");
      created = sib.id;
      return {
        ...n,
        children: [...children.slice(0, idx + 1), sib, ...children.slice(idx + 1)],
      };
    }
    return { ...n, children };
  };
  return [rec(root), created];
}

// Remove a node and its subtree. The root is never removed.
export function removeNode(root: MindNode, id: string): MindNode {
  const rec = (n: MindNode): MindNode => ({
    ...n,
    children: n.children.filter((c) => c.id !== id).map(rec),
  });
  return rec(root);
}

// Demote a node to be a child of its previous sibling (outliner Tab). A first
// child has no previous sibling and stays put. Returns whether anything moved.
export function indentNode(root: MindNode, id: string): [MindNode, boolean] {
  let done = false;
  const rec = (n: MindNode): MindNode => {
    if (done) return n;
    const idx = n.children.findIndex((c) => c.id === id);
    if (idx !== -1) {
      done = true; // found as a direct child either way — stop searching
      if (idx === 0) return n; // no previous sibling to nest under
      const node = n.children[idx];
      const prev = n.children[idx - 1];
      const newPrev = { ...prev, collapsed: false, children: [...prev.children, node] };
      return {
        ...n,
        children: [...n.children.slice(0, idx - 1), newPrev, ...n.children.slice(idx + 1)],
      };
    }
    return { ...n, children: n.children.map(rec) };
  };
  const next = rec(root);
  // `done` means we located the node; report movement only when it actually moved.
  return [next, next !== root];
}

// Promote a node to be a sibling of its parent, inserted right after it (outliner
// Shift+Tab). A direct child of the root has no grandparent and stays put.
export function outdentNode(root: MindNode, id: string): [MindNode, boolean] {
  let done = false;
  const rec = (n: MindNode): MindNode => {
    if (done) return n;
    // n is the grandparent if one of its children (the parent) holds `id`.
    const pIdx = n.children.findIndex((p) => p.children.some((c) => c.id === id));
    if (pIdx !== -1) {
      done = true;
      const parent = n.children[pIdx];
      const node = parent.children.find((c) => c.id === id)!;
      const newParent = { ...parent, children: parent.children.filter((c) => c.id !== id) };
      return {
        ...n,
        children: [
          ...n.children.slice(0, pIdx),
          newParent,
          node,
          ...n.children.slice(pIdx + 1),
        ],
      };
    }
    return { ...n, children: n.children.map(rec) };
  };
  const next = rec(root);
  return [next, next !== root];
}

// --- traversal helpers (for the canvas) ------------------------------------

// The node immediately before `id` in document order (its previous sibling, or
// its parent), for sensible focus after a delete. Null for the root or an
// unknown id.
export function neighborAfterRemove(root: MindNode, id: string): string | null {
  const find = (n: MindNode): string | null => {
    const idx = n.children.findIndex((c) => c.id === id);
    if (idx !== -1) return idx > 0 ? n.children[idx - 1].id : n.id;
    for (const c of n.children) {
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  return find(root);
}

// Total node count (root included) — for the empty-state and a node tally.
export function countNodes(root: MindNode): number {
  return 1 + root.children.reduce((sum, c) => sum + countNodes(c), 0);
}
