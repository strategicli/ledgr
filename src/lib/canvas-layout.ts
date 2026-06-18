// Per-type item canvas layout (ADR-069, Feature B): the client-safe contract for
// the arrangeable, field-level item grid. Mirrors the dashboard split —
// dashboard-widgets.ts (shapes/vocab, no DB) ↔ dashboards.ts (server store +
// tolerant parse) — so the client grid imports these shapes without pulling
// server code. This module imports NO database code (only a type-only PropertyDef
// from types.ts and the pure canvas-fields helpers), so it's safe in the
// "use client" bundle; the DB store fns live in types.ts.
//
// The whole item window is one react-grid-layout grid (the dashboards' engine).
// Each field is its own card: the markdown body, the title, the Related panel,
// each system field (Status/Due/…), each custom property, each relation field.
// A type with no saved layout (canvas_layout = null) renders the classic stacked
// canvas untouched; defaultLayout() reproduces that same reading order as a grid
// for the moment the user opens Arrange. (ADR-069; grouping/collapsible
// containers are a deferred later slice — the CardMeta shape leaves room.)
import { topStripFields } from "@/lib/canvas-fields";
import type { PropertyDef } from "@/lib/types";

export type CardId = string;
export type CardMode = "flow" | "fixed";
export type Breakpoint = "lg" | "md" | "sm";

// One placed card at one breakpoint. Same shape RGL's Layout item uses (`i` is
// the card id); flow cards carry a placeholder `h` that the grid's measurer
// overwrites at render (auto-height), so a stored flow `h` is only a hint.
export type Cell = { i: CardId; x: number; y: number; w: number; h: number };

// Per-card metadata independent of position. `mode` is flow (height follows
// content) or fixed (a set cell; content scrolls). `hidden` drops the card from
// the canvas without losing its place in the vocabulary. (A future `group` slice
// can add child-id/collapsed fields here without a migration — ADR-069.)
export type CardMeta = { mode: CardMode; hidden?: boolean };

export type CanvasLayout = {
  version: 1;
  cards: Record<CardId, CardMeta>;
  layouts: Record<Breakpoint, Cell[]>;
};

// --- Grid engine constants (shared with ItemRglInner) --------------------
// One source of truth for the grid geometry, lifted from the dashboards' RGL
// (RglInner.tsx) so the item grid feels identical: 12/6/1 columns, a short 40px
// row for fine vertical control, vertical compaction.
export const GRID_COLS: Record<Breakpoint, number> = { lg: 12, md: 6, sm: 1 };
// RGL chooses the breakpoint by the GRID CONTAINER width, and each surface maps
// to one (Brandon, 2026-06-17): the full-page expand fills the browser → `lg`
// (Desktop); the modal panel (~768px) → `md` (Tablet); a true phone (< 480px
// container) → `sm` (one column). So the three arrange widths (Desktop / Tablet /
// Phone) correspond one-to-one to where the item is actually viewed. `sm` is a
// mobile state, never a "narrow desktop window" one.
export const GRID_BREAKPOINT_PX: Record<Breakpoint, number> = {
  lg: 1024,
  md: 480,
  sm: 0,
};
export const GRID_ROW_HEIGHT = 40;
export const GRID_MARGIN: [number, number] = [16, 12];
export const BREAKPOINTS: Breakpoint[] = ["lg", "md", "sm"];

const VERSION = 1 as const;

// --- Card kinds + per-kind defaults --------------------------------------

type CardKind =
  | "title"
  | "body"
  | "related"
  | "saveOffline"
  | "share"
  | "meta"
  | "subtasks"
  | "meetingPrep"
  | "recurrence"
  | "recurrenceCalendar"
  | "system"
  | "prop"
  | "relation";

function kindOf(id: CardId): CardKind {
  if (id.startsWith("sys:")) return "system";
  if (id.startsWith("prop:")) return "prop";
  if (id.startsWith("rel:")) return "relation";
  switch (id) {
    case "title":
    case "body":
    case "related":
    case "saveOffline":
    case "share":
    case "meta":
    case "subtasks":
    case "meetingPrep":
    case "recurrence":
    case "recurrenceCalendar":
      return id;
    default:
      // Unknown id (a hand-edited row): treat as a small fixed field card. In
      // practice reconcile() drops anything outside the vocabulary first.
      return "prop";
  }
}

// Default mode/size/flowability per kind. `flowable` gates the flow⇄fixed pin
// (and auto-height): content panels grow; atomic field chips stay fixed (the
// "small field cards fixed" default from the brief). `w`/`h` seed defaultLayout
// and the append-on-reconcile placement; `h` for a flow card is a placeholder
// the measurer replaces.
type CardSpec = { mode: CardMode; flowable: boolean; w: number; h: number };

const SPECS: Record<CardKind, CardSpec> = {
  title: { mode: "flow", flowable: true, w: 12, h: 2 },
  body: { mode: "flow", flowable: true, w: 12, h: 8 },
  subtasks: { mode: "flow", flowable: true, w: 12, h: 6 },
  meetingPrep: { mode: "flow", flowable: true, w: 12, h: 6 },
  recurrence: { mode: "flow", flowable: true, w: 12, h: 2 },
  recurrenceCalendar: { mode: "flow", flowable: true, w: 12, h: 9 },
  related: { mode: "flow", flowable: true, w: 12, h: 6 },
  relation: { mode: "flow", flowable: true, w: 6, h: 4 },
  saveOffline: { mode: "flow", flowable: true, w: 12, h: 2 },
  share: { mode: "flow", flowable: true, w: 12, h: 2 },
  meta: { mode: "flow", flowable: true, w: 12, h: 3 },
  system: { mode: "fixed", flowable: false, w: 4, h: 2 },
  prop: { mode: "fixed", flowable: false, w: 4, h: 2 },
};

export function cardSpec(id: CardId): CardSpec {
  return SPECS[kindOf(id)];
}

// Whether a card may be pinned flow⇄fixed (and so auto-heights when flow).
export function isFlowable(id: CardId): boolean {
  return SPECS[kindOf(id)].flowable;
}

// --- Vocabulary + labels --------------------------------------------------

// The ordered list of card ids a type offers, in today's reading order: title →
// system strip fields → body → subtasks/meetingPrep → custom scalar props →
// relation fields → related → saveOffline → share → meta. System-field
// applicability mirrors topStripFields (ADR-018: due/urgency are task-only), so
// a type never gets a card for a field it shouldn't have.
export function cardVocabulary(
  type: string,
  propertySchema: PropertyDef[]
): CardId[] {
  const ids: CardId[] = ["title"];
  for (const f of topStripFields(type)) ids.push(`sys:${f}`);
  ids.push("body");
  if (type === "task") ids.push("recurrence", "recurrenceCalendar", "subtasks");
  if (type === "meeting") ids.push("meetingPrep");
  for (const p of propertySchema) {
    if (p.kind !== "relation") ids.push(`prop:${p.key}`);
  }
  for (const p of propertySchema) {
    if (p.kind === "relation") ids.push(`rel:${p.key}`);
  }
  ids.push("related", "saveOffline", "share", "meta");
  return ids;
}

const STATIC_LABELS: Record<string, string> = {
  title: "Title",
  body: "Body",
  related: "Related",
  saveOffline: "Save Offline",
  share: "Share",
  meta: "Details",
  subtasks: "Subtasks",
  meetingPrep: "Meeting Prep",
  recurrence: "Repeat",
  recurrenceCalendar: "Completions",
  "sys:status": "Status",
  "sys:dueDate": "Due",
  "sys:scheduledDate": "Scheduled",
  "sys:urgency": "Urgency",
  "sys:meetingAt": "When",
  "sys:url": "URL",
};

// Human label for a card (grid header + arrange palette). Custom/relation cards
// resolve their label from the property schema (so a field rename shows here).
export function cardLabel(id: CardId, propertySchema: PropertyDef[]): string {
  if (STATIC_LABELS[id]) return STATIC_LABELS[id];
  if (id.startsWith("prop:") || id.startsWith("rel:")) {
    const key = id.slice(id.indexOf(":") + 1);
    const def = propertySchema.find((p) => p.key === key);
    if (def) return def.label;
  }
  return id;
}

// --- Default layout (reproduces today's order) ---------------------------

// Shelf-pack ids left-to-right into `cols`, wrapping rows; flow `h` placeholders
// get refined by the measurer at render. forceW (sm) makes every card one column.
function pack(ids: CardId[], cols: number, forceW?: number): Cell[] {
  const cells: Cell[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const id of ids) {
    const spec = cardSpec(id);
    const w = forceW ?? Math.min(spec.w, cols);
    if (x + w > cols) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    cells.push({ i: id, x, y, w, h: spec.h });
    x += w;
    rowH = Math.max(rowH, spec.h);
  }
  return cells;
}

// A CanvasLayout reproducing the classic canvas as a grid — the starting point
// when a user opens Arrange on a type that has none saved.
export function defaultLayout(
  type: string,
  propertySchema: PropertyDef[]
): CanvasLayout {
  const vocab = cardVocabulary(type, propertySchema);
  const cards: Record<CardId, CardMeta> = {};
  for (const id of vocab) cards[id] = { mode: cardSpec(id).mode };
  return {
    version: VERSION,
    cards,
    layouts: {
      lg: pack(vocab, GRID_COLS.lg),
      md: pack(vocab, GRID_COLS.md),
      sm: pack(vocab, GRID_COLS.sm, 1),
    },
  };
}

// --- Tolerant parse (bad shape → null) -----------------------------------

function parseCell(raw: unknown, cols: number): Cell | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.i !== "string" || !r.i) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const x = num(r.x);
  const y = num(r.y);
  const w = num(r.w);
  const h = num(r.h);
  if (x === null || y === null || w === null || h === null) return null;
  return {
    i: r.i,
    x: Math.min(Math.max(x, 0), Math.max(0, cols - 1)),
    y: Math.max(y, 0),
    w: Math.min(Math.max(w, 1), cols),
    h: Math.max(h, 1),
  };
}

function parseCells(raw: unknown, cols: number): Cell[] {
  if (!Array.isArray(raw)) return [];
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const cell = parseCell(c, cols);
    if (cell && !seen.has(cell.i)) {
      seen.add(cell.i);
      out.push(cell);
    }
  }
  return out;
}

function parseCards(raw: unknown): Record<CardId, CardMeta> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<CardId, CardMeta> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const mode = (v as Record<string, unknown>).mode;
    if (mode !== "flow" && mode !== "fixed") continue;
    const meta: CardMeta = { mode };
    if ((v as Record<string, unknown>).hidden === true) meta.hidden = true;
    out[k] = meta;
  }
  return out;
}

// Coerce a stored jsonb value into a CanvasLayout, or null if it's absent or
// structurally wrong — mirroring how rowToDefinition swallows a bad
// property_schema (a malformed layout degrades to the default render, never an
// error). Per-cell/per-card junk is dropped; the wrong top-level shape is null.
export function parseCanvasLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== VERSION) return null;
  const cards = parseCards(r.cards);
  if (!cards) return null;
  if (!r.layouts || typeof r.layouts !== "object") return null;
  const L = r.layouts as Record<string, unknown>;
  return {
    version: VERSION,
    cards,
    layouts: {
      lg: parseCells(L.lg, GRID_COLS.lg),
      md: parseCells(L.md, GRID_COLS.md),
      sm: parseCells(L.sm, GRID_COLS.sm),
    },
  };
}

// --- Responsive derivation + reconcile (run on every read) ---------------

function repackFromLg(lg: Cell[], cols: number, forceW?: number): Cell[] {
  const ordered = [...lg].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Cell[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of ordered) {
    const w = forceW ?? Math.min(c.w, cols);
    if (x + w > cols) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    out.push({ i: c.i, x, y, w, h: c.h });
    x += w;
    rowH = Math.max(rowH, c.h);
  }
  return out;
}

// Fill any missing md/sm from lg so authoring lg is enough (sm is always a single
// column; md scales lg into 6 columns). A breakpoint the user actually dragged
// has cells and is left untouched.
export function deriveResponsive(layout: CanvasLayout): CanvasLayout {
  const { lg, md, sm } = layout.layouts;
  return {
    ...layout,
    layouts: {
      lg,
      md: md.length ? md : repackFromLg(lg, GRID_COLS.md),
      sm: sm.length ? sm : repackFromLg(lg, GRID_COLS.sm, 1),
    },
  };
}

// Keep a stored layout in step with the type's current vocabulary: drop cards no
// longer present (a deleted property) and append newly-added cards (a property
// added later) at the bottom. Run on every read so the grid never goes stale
// when a type's schema changes. Returns a layout covering exactly the vocabulary.
export function reconcile(
  layout: CanvasLayout,
  type: string,
  propertySchema: PropertyDef[]
): CanvasLayout {
  const vocab = cardVocabulary(type, propertySchema);
  const vocabSet = new Set(vocab);

  const cards: Record<CardId, CardMeta> = {};
  for (const id of vocab) {
    cards[id] = layout.cards[id] ?? { mode: cardSpec(id).mode };
  }

  const layouts = {} as Record<Breakpoint, Cell[]>;
  for (const bp of BREAKPOINTS) {
    const cols = GRID_COLS[bp];
    const kept = (layout.layouts[bp] ?? []).filter((c) => vocabSet.has(c.i));
    const present = new Set(kept.map((c) => c.i));
    const missing = vocab.filter((id) => !present.has(id));
    const cells = [...kept];
    // Append the missing cards below everything that's placed, packed in row order.
    let y = cells.reduce((m, c) => Math.max(m, c.y + c.h), 0);
    let x = 0;
    let rowH = 0;
    for (const id of missing) {
      const spec = cardSpec(id);
      const w = bp === "sm" ? 1 : Math.min(spec.w, cols);
      if (x + w > cols) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      cells.push({ i: id, x, y, w, h: spec.h });
      x += w;
      rowH = Math.max(rowH, spec.h);
    }
    layouts[bp] = cells;
  }
  return deriveResponsive({ version: VERSION, cards, layouts });
}

// The render-path resolver: turn a stored jsonb value into the effective layout
// plus whether it's the generated default (raw was null/invalid → render the
// classic stacked canvas). A present layout is reconciled against the live schema.
export function resolveLayout(
  raw: unknown,
  type: string,
  propertySchema: PropertyDef[]
): { layout: CanvasLayout; isDefault: boolean } {
  const parsed = parseCanvasLayout(raw);
  if (!parsed) return { layout: defaultLayout(type, propertySchema), isDefault: true };
  return { layout: reconcile(parsed, type, propertySchema), isDefault: false };
}
