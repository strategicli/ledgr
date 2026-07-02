// Shared presentational pieces for the "@"-mention picker, so the two surfaces
// that host it — the universal capture card (MentionTitleField) and the task-add
// card (AddTaskCard) — render an identical popup and chip row instead of each
// keeping its own copy. The token detection + search live in useMentionTypeahead
// (headless); this is just the view + the type-glyph helper.
"use client";

import { useCallback, useEffect, useState } from "react";
import { mentionGlyphSvg } from "@/lib/mention-glyph";
import { loadTypeMetaMap, type TypeMeta } from "@/components/search/type-token";
import type { MentionHit } from "./useMentionTypeahead";

export type LinkedItem = { id: string; title: string; type: string | null };

// The per-type glyph + label used by the popup rows and the chips. Loads the
// type registry once (memoized in type-token) and repaints when it arrives.
export function useTypeGlyphs() {
  const [typeMeta, setTypeMeta] = useState<Map<string, TypeMeta>>(new Map());
  useEffect(() => {
    void loadTypeMetaMap().then(setTypeMeta);
  }, []);
  const glyph = useCallback(
    (type: string | null) =>
      mentionGlyphSvg(
        { type, icon: type ? typeMeta.get(type)?.icon ?? null : null, statusCategory: null },
        16
      ),
    [typeMeta]
  );
  const typeLabel = useCallback(
    (type: string | null) => (type ? typeMeta.get(type)?.label ?? null : null),
    [typeMeta]
  );
  return { glyph, typeLabel };
}

// The anchored results popup. `selected` runs 0..hits.length-1 across the hits,
// with hits.length being the create-on-miss row when `showCreate` is true. Rows
// use mousedown (not click) so the parent field never blurs out from under the
// pointer before the pick registers.
export function MentionPopup({
  hits,
  selected,
  showCreate,
  creating,
  query,
  typeFilter,
  onHover,
  onPick,
  onCreate,
  glyph,
  typeLabel,
}: {
  hits: MentionHit[];
  selected: number;
  showCreate: boolean;
  creating: boolean;
  query: string;
  typeFilter: TypeMeta | null;
  onHover: (i: number) => void;
  onPick: (hit: MentionHit) => void;
  onCreate: () => void;
  glyph: (type: string | null) => string;
  typeLabel: (type: string | null) => string | null;
}) {
  return (
    <ul className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[90vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50">
      {typeFilter && (
        <li className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-400">
          <span aria-hidden dangerouslySetInnerHTML={{ __html: glyph(typeFilter.key) }} />
          <span>{typeFilter.label}</span>
        </li>
      )}
      {hits.map((hit, i) => (
        <li key={hit.id}>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onPick(hit); }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
              i === selected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"
            }`}
          >
            <span className="shrink-0 text-neutral-400" aria-hidden dangerouslySetInnerHTML={{ __html: glyph(hit.type) }} />
            <span className="min-w-0 flex-1 truncate">{hit.title}</span>
            {typeLabel(hit.type) && (
              <span className="shrink-0 text-xs text-neutral-500">{typeLabel(hit.type)}</span>
            )}
          </button>
        </li>
      ))}
      {showCreate && (
        <li>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onCreate(); }}
            onMouseEnter={() => onHover(hits.length)}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
              selected === hits.length ? "bg-neutral-800 text-neutral-100" : "text-[var(--accent)]"
            }`}
          >
            {creating ? `Creating “${query}”…` : `Create ${typeFilter?.label ?? ""} “${query}”`.replace(/\s+/g, " ")}
          </button>
        </li>
      )}
    </ul>
  );
}

// The "Linked" chip row: the items picked via "@", each removable. The parent
// turns these into `related` relations on save.
export function LinkedChips({
  linked,
  onRemove,
  glyph,
  className = "mt-2",
}: {
  linked: LinkedItem[];
  onRemove: (id: string) => void;
  glyph: (type: string | null) => string;
  className?: string;
}) {
  if (linked.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {linked.map((item) => (
        <span
          key={item.id}
          className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-sm text-[var(--accent)]"
        >
          <span aria-hidden dangerouslySetInnerHTML={{ __html: glyph(item.type) }} />
          <span className="max-w-[16rem] truncate">{item.title || "Untitled"}</span>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove link to ${item.title || "item"}`}
            className="text-neutral-500 hover:text-neutral-200"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
