// Deterministic mindmap layout (Mindmap module). Pure, node-testable.
//
// v1 stores NO node positions (PRD §3, §7): the same tree always lays out the
// same way, computed here, never persisted. That's the deliberate trade that
// keeps the body pure markdown — free-form drag-anywhere positions would need a
// sidecar store and are out of scope for v1.
//
// Algorithm: a two-sided tidy tree (2026-07-01). The root sits in the middle;
// its top-level branches are split across a LEFT and a RIGHT side (balanced by
// visible-leaf count) so the map grows in both directions instead of only
// rightward. Within a side, x is a function of depth (one column per level) and
// y is assigned by walking that side's visible leaves in order, centering each
// parent on its children. Collapsed nodes contribute no visible children, so a
// collapsed branch occupies a single row. Left-side x is negative, then the
// whole map is shifted so the leftmost box starts at 0.
import type { MindNode } from "@/lib/mindmap/tree";

export type Side = "left" | "right";

export type PositionedNode = {
  id: string;
  text: string;
  depth: number;
  x: number;
  y: number;
  // Which side of the root this node hangs off. The root is nominally "right";
  // it renders in the center and its children carry their own assigned side.
  side: Side;
  hasChildren: boolean;
  collapsed: boolean;
  parentId: string | null;
};

export type Layout = {
  nodes: PositionedNode[];
  byId: Map<string, PositionedNode>;
  width: number;
  height: number;
};

// Geometry. COL is the horizontal stride per depth (node box + connector gap);
// ROW is the vertical stride per visible leaf. NODE_W/NODE_H are the box size the
// canvas renders, used here only to size the scroll area.
export const COL = 240;
export const ROW = 52;
export const NODE_W = 190;
export const NODE_H = 36;
const PAD = 24;

// How many visible leaves a subtree occupies (a collapsed node counts as one).
// Drives the side-balancing so left and right end up roughly the same height.
function visibleLeafCount(node: MindNode): number {
  if (node.collapsed || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + visibleLeafCount(c), 0);
}

// Assign each top-level branch to a side, greedily filling whichever side is
// currently lighter (ties go right, so a single branch keeps the old "to the
// right" feel). Deterministic: same tree → same sides.
function assignSides(children: MindNode[]): Side[] {
  const load: Record<Side, number> = { left: 0, right: 0 };
  return children.map((c) => {
    const side: Side = load.right <= load.left ? "right" : "left";
    load[side] += visibleLeafCount(c);
    return side;
  });
}

export function layoutMindmap(root: MindNode): Layout {
  const nodes: PositionedNode[] = [];
  // Each side stacks its leaves independently from the top, so the root can
  // center on the taller of the two.
  const leafSlot: Record<Side, number> = { left: 0, right: 0 };

  const place = (
    node: MindNode,
    depth: number,
    parentId: string | null,
    side: Side
  ): number => {
    const visibleChildren = node.collapsed ? [] : node.children;
    let y: number;
    if (visibleChildren.length === 0) {
      y = leafSlot[side] * ROW;
      leafSlot[side]++;
    } else {
      const childYs = visibleChildren.map((c) => place(c, depth + 1, node.id, side));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    nodes.push({
      id: node.id,
      text: node.text,
      depth,
      x: side === "left" ? -depth * COL : depth * COL,
      y,
      side,
      hasChildren: node.children.length > 0,
      collapsed: node.collapsed,
      parentId,
    });
    return y;
  };

  // Split the top-level branches across sides and lay each subtree out.
  const rootChildren = root.collapsed ? [] : root.children;
  const sides = assignSides(rootChildren);
  rootChildren.forEach((child, i) => place(child, 1, root.id, sides[i]));

  // The root itself: x=0 (center), y centered on the full vertical span so it
  // sits between the two sides.
  const ys = nodes.map((n) => n.y);
  const rootY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  nodes.push({
    id: root.id,
    text: root.text,
    depth: 0,
    x: 0,
    y: rootY,
    side: "right",
    hasChildren: root.children.length > 0,
    collapsed: root.collapsed,
    parentId: null,
  });

  // Shift everything right so the leftmost box starts at x=0 (left-side x is
  // negative until now).
  const minX = nodes.reduce((m, n) => Math.min(m, n.x), 0);
  if (minX < 0) for (const n of nodes) n.x -= minX;

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes,
    byId,
    width: maxX + NODE_W + PAD * 2,
    height: maxY + NODE_H + PAD * 2,
  };
}

export const LAYOUT_PAD = PAD;
