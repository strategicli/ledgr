// A searchable grid of every icon, split into SETS via tabs (slice: nav
// customization, ADR-056; sets added 2026-07-01). "General" is the hand-rolled
// stroke-glyph library grouped by category; "AI Agent" is the licensed filled
// set (rendered filled, selected as "ai:<name>"). Inline in the slot/type
// editors — picking an icon sets the stored `icon` ref. Search filters by name.
// No new dependency (icons are local; the grid is plain CSS).
"use client";

import { useState } from "react";
import NavGlyph from "@/components/nav/NavGlyph";
import { AI_ICON_KEYS } from "@/lib/ai-icons";
import { AI_ICON_PREFIX, NAV_ICON_GROUPS } from "@/lib/nav-icons";

function IconButton({
  refKey,
  label,
  selected,
  onChange,
}: {
  refKey: string;
  label: string;
  selected: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(refKey)}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`flex aspect-square items-center justify-center rounded-md border ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent)]"
          : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:bg-neutral-800/60 hover:text-neutral-200"
      }`}
    >
      <NavGlyph icon={refKey} size={18} />
    </button>
  );
}

export default function NavIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const [tab, setTab] = useState<"general" | "ai">(
    value.startsWith(AI_ICON_PREFIX) ? "ai" : "general"
  );
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = NAV_ICON_GROUPS.map((g) => ({
    label: g.label,
    keys: q ? g.keys.filter((k) => k.includes(q)) : g.keys,
  })).filter((g) => g.keys.length > 0);
  const aiKeys = q ? AI_ICON_KEYS.filter((k) => k.includes(q)) : AI_ICON_KEYS;

  const TABS = [
    { id: "general" as const, label: "General" },
    { id: "ai" as const, label: "AI Agent" },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              tab === t.id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons…"
        aria-label="Search icons"
        className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-neutral-600"
      />
      <div className="max-h-44 overflow-y-auto pr-1">
        {tab === "general" ? (
          groups.length === 0 ? (
            <p className="px-1 py-2 text-xs text-neutral-600">No icons match “{query}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-1.5">
                <p className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-neutral-600">
                  {g.label}
                </p>
                <div className="grid grid-cols-8 gap-1">
                  {g.keys.map((key) => (
                    <IconButton
                      key={key}
                      refKey={key}
                      label={key}
                      selected={key === value}
                      onChange={onChange}
                    />
                  ))}
                </div>
              </div>
            ))
          )
        ) : aiKeys.length === 0 ? (
          <p className="px-1 py-2 text-xs text-neutral-600">No icons match “{query}”.</p>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {aiKeys.map((name) => {
              const refKey = AI_ICON_PREFIX + name;
              return (
                <IconButton
                  key={refKey}
                  refKey={refKey}
                  label={name}
                  selected={refKey === value}
                  onChange={onChange}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
