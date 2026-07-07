// The Desk's layout tree (ADR-146): Ledgr's OWN versioned data structure for a
// multi-panel workspace, kept behind a seam so the renderer (currently
// react-resizable-panels) is rented, not owned. Nothing here imports React or
// the library — it's the pure, unit-testable core. A DeskShell walks this tree
// into <PanelGroup>/<Panel> and writes divider drags back via setFrac; the tree
// is the single source of truth and the only thing that persists.
//
// Shape rules that make the wire format safe (see hard-to-reverse decision #1):
//   - versioned from day one; an unknown version resets to a fresh desk rather
//     than corrupting (sanitizeLayout returns null → caller uses freshLayout).
//   - splits store a FRACTION (proportion of the first child), never pixels, so
//     a layout restores proportionally at any window size.
//   - tabs reference items/views by their stable uuids, never by embedded copies.

// Bump only on a breaking change to the persisted shape; sanitizeLayout treats
// any other version as unreadable and the caller falls back to a fresh desk.
export const DESK_LAYOUT_VERSION = 1;

// A split's first-child fraction is clamped so a panel can't be dragged to
// nothing (and a hand-edited/legacy value can't wedge the layout).
export const MIN_FRAC = 0.15;
export const MAX_FRAC = 0.85;
export const clampFrac = (f: number): number =>
  Math.min(MAX_FRAC, Math.max(MIN_FRAC, f));

// --- The tree -------------------------------------------------------------

export type DeskTab =
  // section? is the active canvas-section index for THIS tab in THIS panel
  // (ADR-147 D5) — per-panel view state, so two panels of the same item can show
  // different sections side by side. Optional + parse-with-default; clamped to
  // the live body's sections at render (snaps to the first if out of range).
  // showDetails? opts this tab into the properties/relations/"Linked here" panel
  // below the body (ADR-147 D6); off (undefined) by default.
  | { id: string; kind: "item"; itemId: string; section?: number; showDetails?: boolean }
  // View/dashboard tabs carry a denormalized `title?` captured at open time (the
  // picker/host already has the name) so the tab strip shows the real name
  // instead of the literal word "View"/"Dashboard" (ADR-147 D2). Optional +
  // parse-with-default: a legacy tab without it falls back to the kind word.
  | { id: string; kind: "view"; viewId: string; title?: string }
  | { id: string; kind: "dashboard"; dashboardId: string; title?: string };

export type DeskLeaf = {
  id: string;
  kind: "leaf";
  tabs: DeskTab[];
  // The tab currently shown; null only for an empty leaf (the "open something"
  // picker state). Always points at a tab that exists in `tabs`.
  activeTab: string | null;
};

export type DeskSplit = {
  id: string;
  kind: "split";
  dir: "row" | "col"; // row = side-by-side (horizontal group); col = stacked
  frac: number; // proportion of the FIRST child (a), clamped to [MIN,MAX]
  a: DeskNode;
  b: DeskNode;
};

export type DeskNode = DeskLeaf | DeskSplit;

export type DeskLayout = {
  version: number;
  root: DeskNode;
  focusedLeaf: string; // the panel that holds the pen (its active item edits)
};

// Where a moving tab lands: center docks it as a tab in that leaf; an edge
// splits that leaf and places the tab in the new panel. Click-to-place (v1) and
// a future drag gesture share this one vocabulary.
export type DropZone = "center" | "left" | "right" | "top" | "bottom";
export type DropTarget = { leafId: string; zone: DropZone };

// --- Id generation --------------------------------------------------------

// Short, collision-resistant ids for nodes/tabs. These live only in the client
// layout (never in the DB), so uniqueness within one desk is all that matters.
let idCounter = 0;
export function newId(prefix = "n"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${(idCounter++).toString(36)}_${rand}`;
}

// --- Constructors ---------------------------------------------------------

export function itemTab(itemId: string): DeskTab {
  return { id: newId("tab"), kind: "item", itemId };
}
export function viewTab(viewId: string, title?: string): DeskTab {
  return { id: newId("tab"), kind: "view", viewId, ...(title ? { title } : {}) };
}
export function dashboardTab(dashboardId: string, title?: string): DeskTab {
  return {
    id: newId("tab"),
    kind: "dashboard",
    dashboardId,
    ...(title ? { title } : {}),
  };
}

export function emptyLeaf(): DeskLeaf {
  return { id: newId("leaf"), kind: "leaf", tabs: [], activeTab: null };
}

export function leafWith(tabs: DeskTab[]): DeskLeaf {
  return { id: newId("leaf"), kind: "leaf", tabs, activeTab: tabs[0]?.id ?? null };
}

// A brand-new desk: one empty panel, focused. Also the reset target when a
// persisted layout is unreadable.
export function freshLayout(): DeskLayout {
  const leaf = emptyLeaf();
  return { version: DESK_LAYOUT_VERSION, root: leaf, focusedLeaf: leaf.id };
}

// A seeded two-panel layout (S3 "Open beside"): left content and right content
// side by side, focus on the right (the just-opened target).
export function twoPanelLayout(
  leftTabs: DeskTab[],
  rightTabs: DeskTab[],
  dir: "row" | "col" = "row"
): DeskLayout {
  const a = leafWith(leftTabs);
  const b = leafWith(rightTabs);
  return {
    version: DESK_LAYOUT_VERSION,
    root: { id: newId("split"), kind: "split", dir, frac: 0.5, a, b },
    focusedLeaf: b.id,
  };
}

// --- Finders --------------------------------------------------------------

export function findLeaf(node: DeskNode, leafId: string): DeskLeaf | null {
  if (node.kind === "leaf") return node.id === leafId ? node : null;
  return findLeaf(node.a, leafId) ?? findLeaf(node.b, leafId);
}

export function allLeaves(node: DeskNode): DeskLeaf[] {
  return node.kind === "leaf"
    ? [node]
    : [...allLeaves(node.a), ...allLeaves(node.b)];
}

// The first leaf in reading order (leftmost/topmost); a safe focus fallback
// after a structural change removes the previously-focused leaf.
export function firstLeaf(node: DeskNode): DeskLeaf {
  return node.kind === "leaf" ? node : firstLeaf(node.a);
}

// Every open tab across the whole desk, in reading order — the mobile fallback
// (< 640px) renders these as a plain list.
export function allTabs(layout: DeskLayout): DeskTab[] {
  return allLeaves(layout.root).flatMap((l) => l.tabs);
}

// Two tabs point at the same underlying thing (used to dedupe within a leaf).
function sameTarget(a: DeskTab, b: DeskTab): boolean {
  if (a.kind === "item" && b.kind === "item") return a.itemId === b.itemId;
  if (a.kind === "view" && b.kind === "view") return a.viewId === b.viewId;
  if (a.kind === "dashboard" && b.kind === "dashboard")
    return a.dashboardId === b.dashboardId;
  return false;
}

// --- Structural rewrites (all pure: return a new layout) ------------------

// Rebuild the tree, replacing the matching leaf with whatever `make` returns
// (a leaf or a split). Untouched branches are returned as-is.
function replaceLeaf(
  node: DeskNode,
  leafId: string,
  make: (leaf: DeskLeaf) => DeskNode
): DeskNode {
  if (node.kind === "leaf") return node.id === leafId ? make(node) : node;
  const a = replaceLeaf(node.a, leafId, make);
  const b = replaceLeaf(node.b, leafId, make);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

// Remove a leaf, collapsing its parent split into the surviving sibling.
// Returns null if the whole subtree vanished (only when the removed leaf was
// the entire tree).
function removeLeaf(node: DeskNode, leafId: string): DeskNode | null {
  if (node.kind === "leaf") return node.id === leafId ? null : node;
  const a = removeLeaf(node.a, leafId);
  const b = removeLeaf(node.b, leafId);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

export function focusLeaf(layout: DeskLayout, leafId: string): DeskLayout {
  if (layout.focusedLeaf === leafId) return layout;
  if (!findLeaf(layout.root, leafId)) return layout;
  return { ...layout, focusedLeaf: leafId };
}

export function setActiveTab(
  layout: DeskLayout,
  leafId: string,
  tabId: string
): DeskLayout {
  const leaf = findLeaf(layout.root, leafId);
  if (!leaf || !leaf.tabs.some((t) => t.id === tabId)) return layout;
  const root = replaceLeaf(layout.root, leafId, (l) => ({ ...l, activeTab: tabId }));
  return { ...layout, root, focusedLeaf: leafId };
}

// Set the active canvas-section index for one item tab (ADR-147 D5). Per-panel
// view state; focuses the leaf like activating a tab does (a section switch is a
// navigation within that panel). A no-op for a non-item / missing tab.
export function setTabSection(
  layout: DeskLayout,
  leafId: string,
  tabId: string,
  section: number
): DeskLayout {
  const leaf = findLeaf(layout.root, leafId);
  if (!leaf || !leaf.tabs.some((t) => t.id === tabId && t.kind === "item"))
    return layout;
  const root = replaceLeaf(layout.root, leafId, (l) => ({
    ...l,
    tabs: l.tabs.map((t) =>
      t.id === tabId && t.kind === "item" ? { ...t, section } : t
    ),
  }));
  return { ...layout, root, focusedLeaf: leafId };
}

// Toggle an item tab's "Show details" panel (ADR-147 D6). Per-tab view state,
// like setTabSection; a no-op for a non-item / missing tab.
export function setTabShowDetails(
  layout: DeskLayout,
  leafId: string,
  tabId: string,
  show: boolean
): DeskLayout {
  const leaf = findLeaf(layout.root, leafId);
  if (!leaf || !leaf.tabs.some((t) => t.id === tabId && t.kind === "item"))
    return layout;
  const root = replaceLeaf(layout.root, leafId, (l) => ({
    ...l,
    tabs: l.tabs.map((t) =>
      t.id === tabId && t.kind === "item" ? { ...t, showDetails: show } : t
    ),
  }));
  return { ...layout, root, focusedLeaf: leafId };
}

export function setFrac(
  layout: DeskLayout,
  splitId: string,
  frac: number
): DeskLayout {
  function walk(node: DeskNode): DeskNode {
    if (node.kind === "leaf") return node;
    if (node.id === splitId) return { ...node, frac: clampFrac(frac) };
    const a = walk(node.a);
    const b = walk(node.b);
    return a === node.a && b === node.b ? node : { ...node, a, b };
  }
  return { ...layout, root: walk(layout.root) };
}

// Add a tab to a leaf. If the leaf already shows the same item/view, that tab
// is activated instead of adding a duplicate (opening the same item twice in
// one panel is never useful). Always focuses the target leaf.
export function addTab(
  layout: DeskLayout,
  leafId: string,
  tab: DeskTab,
  opts?: { activate?: boolean }
): DeskLayout {
  const activate = opts?.activate ?? true;
  const leaf = findLeaf(layout.root, leafId);
  if (!leaf) return layout;
  const existing = leaf.tabs.find((t) => sameTarget(t, tab));
  const root = replaceLeaf(layout.root, leafId, (l) =>
    existing
      ? { ...l, activeTab: activate ? existing.id : l.activeTab }
      : {
          ...l,
          tabs: [...l.tabs, tab],
          activeTab: activate ? tab.id : l.activeTab ?? tab.id,
        }
  );
  return { ...layout, root, focusedLeaf: leafId };
}

// Split a leaf, placing `newTabs` in a new sibling panel. `placeFirst` puts the
// new panel before (left/top) rather than after (right/bottom). Returns the new
// leaf's id so the caller can focus it.
export function splitLeaf(
  layout: DeskLayout,
  leafId: string,
  dir: "row" | "col",
  newTabs: DeskTab[],
  placeFirst = false
): { layout: DeskLayout; newLeafId: string } {
  const newLeaf = leafWith(newTabs);
  const root = replaceLeaf(layout.root, leafId, (orig) => ({
    id: newId("split"),
    kind: "split",
    dir,
    frac: 0.5,
    a: placeFirst ? newLeaf : orig,
    b: placeFirst ? orig : newLeaf,
  }));
  return {
    layout: { ...layout, root, focusedLeaf: newLeaf.id },
    newLeafId: newLeaf.id,
  };
}

// Append a new rightmost column holding `newTabs` (ADR-147 D1: "Open beside …"
// on repeat from the same host grows the row `[host | A | B]` rather than
// rebuilding). The whole existing tree becomes the first child of a new top-row
// split; the new leaf is the second child and gets focus. Its width share is
// sized so the addition looks like "one more equal column": with N leaves
// already open, the outgoing block keeps N/(N+1) of the width and the new column
// takes ~1/(N+1) (clamped). Returns the new leaf id so a caller can act on it.
export function appendColumn(
  layout: DeskLayout,
  newTabs: DeskTab[]
): { layout: DeskLayout; newLeafId: string } {
  const leaf = leafWith(newTabs);
  const n = allLeaves(layout.root).length;
  const frac = clampFrac(n / (n + 1));
  const root: DeskSplit = {
    id: newId("split"),
    kind: "split",
    dir: "row",
    frac,
    a: layout.root,
    b: leaf,
  };
  return {
    layout: { ...layout, root, focusedLeaf: leaf.id },
    newLeafId: leaf.id,
  };
}

// Close a whole panel (and any tabs it holds), collapsing its parent split.
// Closing the last remaining panel yields a fresh empty desk rather than an
// empty tree. Focus falls back to the first surviving leaf.
export function closeLeaf(layout: DeskLayout, leafId: string): DeskLayout {
  const root = removeLeaf(layout.root, leafId);
  if (root === null) return freshLayout();
  const focusedLeaf = findLeaf(root, layout.focusedLeaf)
    ? layout.focusedLeaf
    : firstLeaf(root).id;
  return { ...layout, root, focusedLeaf };
}

// Remove one tab from a leaf, returning the detached tab so it can be re-placed
// (moveTab). If it was the leaf's last tab, the leaf collapses.
function detachTab(
  layout: DeskLayout,
  leafId: string,
  tabId: string
): { layout: DeskLayout; tab: DeskTab | null } {
  const leaf = findLeaf(layout.root, leafId);
  if (!leaf) return { layout, tab: null };
  const tab = leaf.tabs.find((t) => t.id === tabId) ?? null;
  if (!tab) return { layout, tab: null };
  const remaining = leaf.tabs.filter((t) => t.id !== tabId);
  if (remaining.length === 0) return { layout: closeLeaf(layout, leafId), tab };
  const activeTab =
    leaf.activeTab === tabId ? remaining[remaining.length - 1].id : leaf.activeTab;
  const root = replaceLeaf(layout.root, leafId, (l) => ({
    ...l,
    tabs: remaining,
    activeTab,
  }));
  return { layout: { ...layout, root }, tab };
}

// Close a single tab (the × on a tab). Collapses the leaf if it was the last.
export function closeTab(
  layout: DeskLayout,
  leafId: string,
  tabId: string
): DeskLayout {
  return detachTab(layout, leafId, tabId).layout;
}

// Move a tab to a drop target: center docks it as a tab, an edge splits the
// target panel. The tab keeps its id so no content reloads.
export function moveTab(
  layout: DeskLayout,
  fromLeafId: string,
  tabId: string,
  target: DropTarget
): DeskLayout {
  // Moving a tab onto its own panel's center is a no-op; so is edge-splitting a
  // panel with a single tab by that same tab (nothing would change).
  const source = findLeaf(layout.root, fromLeafId);
  if (target.leafId === fromLeafId) {
    if (target.zone === "center") return layout;
    if (source && source.tabs.length <= 1) return layout;
  }
  const { layout: afterDetach, tab } = detachTab(layout, fromLeafId, tabId);
  if (!tab) return layout;
  // The target survives detach unless it was the source panel collapsing — the
  // guards above already excluded that case for a single-tab source.
  if (!findLeaf(afterDetach.root, target.leafId)) {
    return addTab(afterDetach, firstLeaf(afterDetach.root).id, tab);
  }
  if (target.zone === "center") return addTab(afterDetach, target.leafId, tab);
  const dir = target.zone === "left" || target.zone === "right" ? "row" : "col";
  const placeFirst = target.zone === "left" || target.zone === "top";
  return splitLeaf(afterDetach, target.leafId, dir, [tab], placeFirst).layout;
}

// --- Persistence validation ----------------------------------------------
// Tolerant parse-with-defaults, same posture as parseSettings/parseNavSlots: a
// malformed piece is dropped, an unreadable whole returns null so the caller
// falls back to a fresh desk. Never throws on hand-edited/legacy blobs.

function sanitizeTab(raw: unknown): DeskTab | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : null;
  if (!id) return null;
  // A denormalized title is optional (older blobs won't have it): keep it only
  // when it's a real string, else drop it and fall back to the kind word.
  const title = typeof r.title === "string" && r.title ? r.title : undefined;
  // A persisted section index: keep only a finite non-negative integer.
  const section =
    typeof r.section === "number" && Number.isInteger(r.section) && r.section >= 0
      ? r.section
      : undefined;
  const showDetails = r.showDetails === true ? true : undefined;
  if (r.kind === "item" && typeof r.itemId === "string" && r.itemId)
    return {
      id,
      kind: "item",
      itemId: r.itemId,
      ...(section !== undefined ? { section } : {}),
      ...(showDetails ? { showDetails } : {}),
    };
  if (r.kind === "view" && typeof r.viewId === "string" && r.viewId)
    return { id, kind: "view", viewId: r.viewId, ...(title ? { title } : {}) };
  if (r.kind === "dashboard" && typeof r.dashboardId === "string" && r.dashboardId)
    return {
      id,
      kind: "dashboard",
      dashboardId: r.dashboardId,
      ...(title ? { title } : {}),
    };
  return null;
}

function sanitizeNode(raw: unknown): DeskNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "leaf") {
    const id = typeof r.id === "string" && r.id ? r.id : null;
    if (!id) return null;
    const tabs = (Array.isArray(r.tabs) ? r.tabs : [])
      .map(sanitizeTab)
      .filter((t): t is DeskTab => t !== null);
    const activeTab = tabs.some((t) => t.id === r.activeTab)
      ? (r.activeTab as string)
      : tabs[0]?.id ?? null;
    return { id, kind: "leaf", tabs, activeTab };
  }
  if (r.kind === "split") {
    const id = typeof r.id === "string" && r.id ? r.id : null;
    if (!id) return null;
    const a = sanitizeNode(r.a);
    const b = sanitizeNode(r.b);
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    const dir = r.dir === "col" ? "col" : "row";
    const frac =
      typeof r.frac === "number" && Number.isFinite(r.frac)
        ? clampFrac(r.frac)
        : 0.5;
    return { id, kind: "split", dir, frac, a, b };
  }
  return null;
}

export function sanitizeLayout(raw: unknown): DeskLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== DESK_LAYOUT_VERSION) return null; // unknown version → fresh
  const root = sanitizeNode(r.root);
  if (!root) return null;
  const focusedLeaf =
    typeof r.focusedLeaf === "string" && findLeaf(root, r.focusedLeaf)
      ? r.focusedLeaf
      : firstLeaf(root).id;
  return { version: DESK_LAYOUT_VERSION, root, focusedLeaf };
}
