"use client";

// The widget gear (Project Type, ADR-111/PJ4): the "Customize" surface for a
// widget-composed record. PJ4 ships section 1 — "Which widgets" (enable /
// disable / reset). Enabling a not-present widget lazily appends an instance
// (Layer 3 "associate on turn-on"); disabling sets hidden=true (hide, never
// delete — the backing items are untouched, so re-enabling restores). The first
// edit materializes the full resolved composition onto the record; Reset clears
// it back to the type default (composition = null). Per-widget options + the
// Behaviors section (Digest) are follow-ups.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Composition } from "@/lib/composition";

type CatalogEntry = { id: string; label: string };

export default function WidgetGear({
  itemId,
  composition,
  catalog,
}: {
  itemId: string;
  composition: Composition;
  catalog: CatalogEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = new Set(composition.widgets.filter((w) => !w.hidden).map((w) => w.defId));

  async function patch(body: unknown) {
    setSaving(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function toggle(defId: string) {
    const widgets = [...composition.widgets];
    const idx = widgets.findIndex((w) => w.defId === defId);
    if (idx >= 0) {
      widgets[idx] = { ...widgets[idx], hidden: !widgets[idx].hidden };
    } else {
      widgets.push({ instanceId: defId, defId });
    }
    void patch({ composition: { ...composition, widgets } });
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
      >
        Customize
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
            <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Widgets
            </p>
            <ul className="max-h-72 overflow-y-auto">
              {catalog.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-neutral-200 hover:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={visible.has(c.id)}
                      disabled={saving}
                      onChange={() => toggle(c.id)}
                    />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={saving}
              onClick={() => void patch({ composition: null })}
              className="mt-1 w-full rounded px-1 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            >
              Reset to type default
            </button>
          </div>
        </>
      )}
    </div>
  );
}
