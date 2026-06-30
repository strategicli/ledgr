// Deterministic mindmap layout (Mindmap module). Pure, node-testable.
//
// v1 stores NO node positions (PRD §3, §7): the same tree always lays out the
// same way, computed here, never persisted. That's the deliberate trade that
// keeps the body pure markdown — free-form drag-anywhere positions would need a
// sidecar store and are out of scope for v1.
//
// Algorithm: a classic left-to-right tidy tree. x is a function of depth (one
// column per level); y is assigned by walking the visible leaves in order and
// centering each parent on its children. Collapsed nodes contribute no visible
// children, so a collapsed branch occupies a single row.
import type { MindNode } from "@/lib/mindmap/tree";

export type PositionedNode = {
  id: string;
  text: string;
  depth: number;
  x: number;
  y: number;
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

export function layoutMindmap(root: MindNode): Layout {
  const nodes: PositionedNode[] = [];
  let leafSlot = 0;

  const place = (node: MindNode, depth: number, parentId: string | null): number => {
    const visibleChildren = node.collapsed ? [] : node.children;
    let y: number;
    if (visibleChildren.length === 0) {
      y = leafSlot * ROW;
      leafSlot++;
    } else {
      const childYs = visibleChildren.map((c) => place(c, depth + 1, node.id));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    nodes.push({
      id: node.id,
      text: node.text,
      depth,
      x: depth * COL,
      y,
      hasChildren: node.children.length > 0,
      collapsed: node.collapsed,
      parentId,
    });
    return y;
  };

  place(root, 0, null);

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
