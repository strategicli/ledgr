// One compact labelled control for a custom property being set at CREATE time
// (ADR-268). The item doesn't exist yet, so nothing PATCHes here: the value rides
// the card's POST. Shared by both quick-capture cards (task and every other
// type) for chip-flagged properties, and by the task card's "More" menu.
//
// Values are plain: a string/number/boolean for scalars, a string[] for
// multi_select, and `{id,title}[]` for a relation. `captureValues` turns the
// whole map into the POST's `properties` + `relateTo` (role = the property key,
// the same edge shape RelationField writes, ADR-067).
"use client";

import { useEffect, useState } from "react";
import DateInput from "@/components/ui/DateInput";
import type { PropertyDef } from "@/lib/types";

export type RelPick = { id: string; title: string };
export type CaptureValues = Record<string, unknown>;

const box =
  "rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-500";

export function captureValues(schema: PropertyDef[], values: CaptureValues) {
  const properties: Record<string, unknown> = {};
  const relateTo: { targetId: string; role: string }[] = [];
  for (const [k, v] of Object.entries(values)) {
    const def = schema.find((p) => p.key === k);
    if (def?.kind === "relation") {
      for (const r of (v as RelPick[] | undefined) ?? []) relateTo.push({ targetId: r.id, role: k });
    } else if (v !== "" && v != null && !(Array.isArray(v) && v.length === 0)) {
      properties[k] = v;
    }
  }
  return { properties, relateTo };
}

const IconX = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function PropertyEditor({
  def,
  value,
  onChange,
  onRemove,
}: {
  def: PropertyDef;
  value: unknown;
  onChange: (v: unknown) => void;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-neutral-400">
      {def.label}
      <Control def={def} value={value} onChange={onChange} />
      <button type="button" aria-label={`Remove ${def.label}`} onClick={onRemove} className="text-neutral-600 hover:text-red-400">
        {IconX}
      </button>
    </span>
  );
}

function Control({ def, value, onChange }: { def: PropertyDef; value: unknown; onChange: (v: unknown) => void }) {
  switch (def.kind) {
    case "date":
      return (
        <DateInput
          value={typeof value === "string" ? value.slice(0, 10) : null}
          onCommit={(ymd) => onChange(def.withTime ? `${ymd}T00:00:00.000Z` : ymd)}
          ariaLabel={def.label}
          className={box}
        />
      );
    case "checkbox":
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={def.label} className="accent-[var(--accent)]" />;
    case "select":
      return (
        <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={def.label} className={box}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "multi_select": {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="inline-flex flex-wrap gap-1">
          {(def.options ?? []).map((o) => {
            const on = picked.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((x) => x !== o) : [...picked, o])}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-[var(--accent)] text-neutral-100" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
              >
                {o}
              </button>
            );
          })}
        </span>
      );
    }
    case "relation":
      return <RelationPicker def={def} value={Array.isArray(value) ? (value as RelPick[]) : []} onChange={onChange} />;
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          aria-label={def.label}
          className={`${box} w-24`}
        />
      );
    default:
      return (
        <input
          type={def.kind === "email" ? "email" : def.kind === "phone" ? "tel" : def.kind === "url" || def.kind === "image" ? "url" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-label={def.label}
          className={`${box} w-36`}
        />
      );
  }
}

// Search-as-you-type over items of the field's target type (any type when it
// has none), the same `/api/items?type&q` typeahead the task card's Person and
// Group chips use. `single` cardinality replaces; `many` appends.
function RelationPicker({ def, value, onChange }: { def: PropertyDef; value: RelPick[]; onChange: (v: RelPick[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RelPick[]>([]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "8" });
        if (def.targetType) params.set("type", def.targetType);
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/items?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const d = (await res.json()) as { items: RelPick[] };
        setHits(Array.isArray(d.items) ? d.items : []);
      } catch {
        // aborted or offline; the next keystroke retries
      }
    }, 150);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [open, q, def.targetType]);

  return (
    <span className="relative inline-flex flex-wrap items-center gap-1">
      {value.map((r) => (
        <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200">
          {r.title || "Untitled"}
          <button type="button" aria-label={`Unlink ${r.title}`} onClick={() => onChange(value.filter((x) => x.id !== r.id))} className="text-neutral-500 hover:text-red-400">{IconX}</button>
        </span>
      ))}
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${box} text-neutral-400`}>
        {value.length === 0 ? "Pick…" : "+"}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-10 mt-1 flex w-56 flex-col rounded border border-neutral-700 bg-neutral-900 p-1 shadow-lg shadow-black/40">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
            placeholder={`Search ${def.label.toLowerCase()}…`}
            aria-label={`Search ${def.label.toLowerCase()}`}
            className="mb-1 w-full rounded border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
          />
          <span className="max-h-44 overflow-y-auto">
            {hits.filter((h) => !value.some((v) => v.id === h.id)).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onChange(def.cardinality === "single" ? [h] : [...value, h]);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center rounded px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800"
              >
                {h.title || "Untitled"}
              </button>
            ))}
            {hits.length === 0 && <span className="block px-2 py-1 text-xs text-neutral-600">No matches.</span>}
          </span>
        </span>
      )}
    </span>
  );
}
