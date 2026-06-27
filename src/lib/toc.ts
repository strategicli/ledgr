// Floating table of contents — the pure, client-safe pieces (ADR-114). Kept out
// of settings.ts (which imports the DB layer) so a client component can import
// the type/constants/resolver without pulling server-only code into the bundle —
// the same split as list-lenses.ts ↔ settings.ts. settings.ts imports the parser
// + type from here; the Build panel and the canvas import the resolver/constants.
//
// A Notion-style outline built from the body's headings, configured per type and
// stored as an override map keyed by type key in users.settings.tocByType (no
// schema change). An absent key resolves to DEFAULT_TOC (auto-on); the component
// itself gates on heading count (>=2). The outline is a personal reading
// preference, so it lives in owner-scoped settings rather than on the
// (instance-global, not owner-scoped) types row.
export const TOC_LEVELS = [1, 2, 3] as const;
export type TocLevel = (typeof TOC_LEVELS)[number];

export type TocConfig = {
  enabled: boolean;
  levels: number[]; // which heading levels the outline includes (subset of TOC_LEVELS)
};

export const DEFAULT_TOC: TocConfig = { enabled: true, levels: [...TOC_LEVELS] };

// Resolve a type's floating-TOC config: the stored override, else the default
// (auto-on). The analog of lensesForType for list tabs.
export function tocForType(
  settings: { tocByType?: Record<string, TocConfig> },
  typeKey: string
): TocConfig {
  return settings.tocByType?.[typeKey] ?? DEFAULT_TOC;
}

// Parse one type's TOC config: require a boolean `enabled` and narrow `levels`
// to the known heading levels (deduped, sorted); an empty/missing levels list
// falls back to all levels. Returns null for anything malformed so the entry is
// dropped — a hand-edited blob still yields a safe map. Used by the per-type
// write route (mirrors parseLenses for list tabs) and by parseTocByType.
export function parseTocConfig(raw: unknown): TocConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  const levels = Array.isArray(r.levels)
    ? [
        ...new Set(
          r.levels.filter((n): n is number =>
            (TOC_LEVELS as readonly number[]).includes(n as number)
          )
        ),
      ].sort((a, b) => a - b)
    : [];
  return { enabled: r.enabled, levels: levels.length ? levels : [...DEFAULT_TOC.levels] };
}

// Parse the stored per-type TOC map, dropping malformed entries. Anything that
// isn't a plain object yields an empty map.
export function parseTocByType(raw: unknown): Record<string, TocConfig> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, TocConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cfg = parseTocConfig(value);
    if (cfg) out[key] = cfg;
  }
  return out;
}
