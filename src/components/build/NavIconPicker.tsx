// A searchable grid of every nav icon, grouped by category (slice: nav
// customization, ADR-056). Inline in the slot editor — picking an icon sets the
// slot's `icon` key. Search filters by icon-key substring; the selected icon
// gets an accent ring. No new dependency (the icon set is hand-rolled, the grid
// is plain CSS).
"use client";

import { useState } from "react";
import NavGlyph from "@/components/nav/NavGlyph";
import { NAV_ICON_GROUPS, type NavIconKey } from "@/lib/nav-icons";

export default function NavIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: NavIconKey) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = NAV_ICON_GROUPS.map((g) => ({
    label: g.label,
    keys: q ? g.keys.filter((k) => k.includes(q)) : g.keys,
  })).filter((g) => g.keys.length > 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons…"
        aria-label="Search icons"
        className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-neutral-600"
      />
      <div className="max-h-44 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="px-1 py-2 text-xs text-neutral-600">No icons match “{query}”.</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-1.5">
            <p className="px-0.5 pb-1 text-[10px] uppercase tracking-wide text-neutral-600">
              {g.label}
            </p>
            <div className="grid grid-cols-8 gap-1">
              {g.keys.map((key) => {
                const selected = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChange(key)}
                    title={key}
                    aria-label={key}
                    aria-pressed={selected}
                    className={`flex aspect-square items-center justify-center rounded-md border ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent)]"
                        : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:bg-neutral-800/60 hover:text-neutral-200"
                    }`}
                  >
                    <NavGlyph icon={key} size={18} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
