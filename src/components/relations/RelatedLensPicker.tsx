// The in-place lens switcher on a related-type group header. A lens is a
// toolbelt, not a setting (Brandon): switching is one control on the panel
// itself — no trip to Build. The choice persists per host-type + related-type
// (settings.relatedLensChoices), so picking a Tasks lens on a Meeting applies to
// Tasks on every Meeting. A native <select> keeps it to a click-and-pick with no
// menu plumbing; onChange PATCHes the choice and refreshes the server render.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Lens } from "@/lib/list-lenses";

export default function RelatedLensPicker({
  hostType,
  relatedType,
  lenses,
  currentId,
}: {
  hostType: string;
  relatedType: string;
  lenses: Lens[];
  currentId: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(currentId);

  async function choose(lensId: string) {
    const prev = value;
    setValue(lensId);
    setSaving(true);
    try {
      const res = await fetch("/api/related-lens", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostType, relatedType, lensId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setValue(prev); // revert on failure; the list keeps its current lens
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
      <span className="text-neutral-600">Lens</span>
      <select
        value={value}
        disabled={saving}
        onChange={(e) => choose(e.target.value)}
        aria-label={`Lens for ${relatedType}`}
        className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      >
        {lenses.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
