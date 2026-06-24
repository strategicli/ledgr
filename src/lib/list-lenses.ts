// List lenses: the per-type tab strip on the generic /list/[type] page and the
// bespoke Notes/Links lists (the /tasks tab pattern generalized to every type).
// A lens is either a SORT (the plain item list in a chosen order) or a VIEW (a
// saved view rendered with ViewRenderer — the dashboard "view widget" reused as
// a tab). Four sort lenses are virtual defaults every type gets for free; the
// owner can reorder/rename/add/remove them per type in Build, stored in
// users.settings.listTabs (no schema change, same posture as navSlots /
// favorites). This module is pure and client-safe (no DB / server imports), so
// settings.ts, the list pages, and the client editor all share it.
import type { ListSort } from "@/lib/views";

// --- Types ----------------------------------------------------------------

// A sort lens orders the plain list by a built-in field or one of the type's
// own properties (numeric = cast the JSONB text to a number for ordering).
export type LensSortSource =
  | { field: LensField }
  | { property: string; numeric?: boolean };

export type Lens =
  | { id: string; kind: "sort"; label: string; source: LensSortSource; dir: "asc" | "desc" }
  | { id: string; kind: "view"; label: string; viewId: string };

// Built-in sort fields a lens can use. A subset of the view engine's columns
// plus "mostLinked" (the confirmed-relation count). Date/scheduled/meeting
// fields aren't offered as generic defaults (they're type-specific); a type
// that wants them adds a property lens or a view lens.
export const LENS_FIELDS = ["updatedAt", "createdAt", "title", "mostLinked"] as const;
export type LensField = (typeof LENS_FIELDS)[number];

const LENS_CAP = 12; // per type
const TYPE_CAP = 200; // distinct types with overrides
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Defaults -------------------------------------------------------------

// The virtual default strip every type gets when it has no stored override.
// Each is reversible at render time via the active-tab direction toggle, so
// "A → Z" inverts to "Z → A", "Most linked" to "Least linked", etc.
export function defaultLenses(): Lens[] {
  return [
    { id: "recent", kind: "sort", label: "Recent", source: { field: "updatedAt" }, dir: "desc" },
    { id: "newest", kind: "sort", label: "Newest", source: { field: "createdAt" }, dir: "desc" },
    { id: "az", kind: "sort", label: "A → Z", source: { field: "title" }, dir: "asc" },
    { id: "linked", kind: "sort", label: "Most linked", source: { field: "mostLinked" }, dir: "desc" },
  ];
}

// The lenses for a type: the stored override if present and non-empty, else the
// virtual defaults. Typed structurally so this file needs no settings import.
export function lensesForType(
  settings: { listTabs?: Record<string, Lens[]> },
  typeKey: string
): Lens[] {
  const stored = settings.listTabs?.[typeKey];
  return stored && stored.length ? stored : defaultLenses();
}

// Pick the active lens from a `?lens=` param, falling back to the first lens.
export function selectLens(lenses: Lens[], lensParam: string | undefined): Lens {
  return lenses.find((l) => l.id === lensParam) ?? lenses[0] ?? defaultLenses()[0];
}

// Map a SORT lens to the engine's ListSort, flipping direction when reversed.
// View lenses render via ViewRenderer instead, so they return null here.
export function resolveLensSort(lens: Lens, reversed: boolean): ListSort | null {
  if (lens.kind !== "sort") return null;
  const dir: "asc" | "desc" = reversed ? (lens.dir === "asc" ? "desc" : "asc") : lens.dir;
  if ("property" in lens.source) {
    return { field: "property", propertyKey: lens.source.property, numeric: lens.source.numeric, dir };
  }
  return { field: lens.source.field, dir } as ListSort;
}

// --- Editor helpers -------------------------------------------------------

type PropLike = { key: string; label: string; kind: string };

// The type's properties that make sense to sort a lens by: text, number, date,
// and single-select. (multi_select is an array; url/checkbox/relation aren't
// useful orderings.) Numeric properties get the numeric cast in the query.
export function lensPropertyOptions(
  schema: PropLike[]
): { key: string; label: string; numeric: boolean }[] {
  return schema
    .filter((p) => p.kind === "text" || p.kind === "number" || p.kind === "date" || p.kind === "select")
    .map((p) => ({ key: p.key, label: p.label, numeric: p.kind === "number" }));
}

// --- Validation (used by parseSettings + the API route) -------------------

function isLensField(v: unknown): v is LensField {
  return typeof v === "string" && (LENS_FIELDS as readonly string[]).includes(v);
}

function parseLens(raw: unknown): Lens | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().slice(0, 40) : "";
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
  if (!id || !label) return null;

  if (r.kind === "view") {
    const viewId = typeof r.viewId === "string" && UUID_RE.test(r.viewId) ? r.viewId : "";
    if (!viewId) return null;
    return { id, kind: "view", label, viewId };
  }

  // Default kind is "sort".
  const dir: "asc" | "desc" = r.dir === "asc" ? "asc" : "desc";
  const src = r.source && typeof r.source === "object" ? (r.source as Record<string, unknown>) : {};
  if (typeof src.property === "string" && src.property.trim()) {
    const property = src.property.trim().slice(0, 40);
    return { id, kind: "sort", label, source: { property, numeric: src.numeric === true }, dir };
  }
  if (isLensField(src.field)) {
    return { id, kind: "sort", label, source: { field: src.field }, dir };
  }
  return null;
}

// Parse a stored lens array: drop malformed entries, dedupe by id, cap the
// count. Returns null when nothing valid remains, so the type falls back to the
// virtual defaults (an empty override is not a meaningful "no tabs" choice).
export function parseLenses(raw: unknown): Lens[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Lens[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const lens = parseLens(entry);
    if (!lens || seen.has(lens.id)) continue;
    seen.add(lens.id);
    out.push(lens);
    if (out.length >= LENS_CAP) break;
  }
  return out.length ? out : null;
}

// Parse the whole listTabs map (typeKey → lenses) for parseSettings. Tolerant:
// drop unusable keys/values, cap the number of customized types.
export function parseListTabs(raw: unknown): Record<string, Lens[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Lens[]> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= TYPE_CAP) break;
    const k = key.trim().slice(0, 60);
    if (!k) continue;
    const lenses = parseLenses(value);
    if (lenses) {
      out[k] = lenses;
      count++;
    }
  }
  return out;
}
