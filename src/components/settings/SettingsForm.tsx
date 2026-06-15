// User settings form (v5). Highlight-accent color, Trash retention window, and
// nav position. Saves each change to /api/settings; the color updates the live
// `--accent` CSS variable immediately so the choice is visible without a reload.
"use client";

import { useState } from "react";
import { HIGHLIGHT_COLORS, NAV_POSITIONS, type UserSettings } from "@/lib/settings";

export default function SettingsForm({ initial }: { initial: UserSettings }) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const [saved, setSaved] = useState(false);

  const save = async (patch: Partial<UserSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.highlightColor) {
      // The layout sets --accent inline on <body>, which wins for its
      // descendants — so override it there, not on <html>, for an instant change.
      document.body.style.setProperty("--accent", patch.highlightColor);
    }
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch {
      /* offline; the next change retries */
    }
  };

  return (
    <div className="mt-6 flex max-w-xl flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Highlight color</h2>
        <p className="mt-0.5 text-sm text-neutral-500">The accent used for primary buttons and highlights.</p>
        <div className="mt-2 flex gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => void save({ highlightColor: c.value })}
              aria-label={c.name}
              title={c.name}
              className={`h-7 w-7 rounded-full border-2 ${settings.highlightColor === c.value ? "border-neutral-100" : "border-transparent"}`}
              style={{ background: c.value }}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Trash retention</h2>
        <p className="mt-0.5 text-sm text-neutral-500">Days a trashed item is kept before it's purged.</p>
        <input
          type="number"
          min={1}
          max={365}
          value={settings.trashRetentionDays}
          onChange={(e) => void save({ trashRetentionDays: Number(e.target.value) || 30 })}
          className="mt-2 w-24 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Navigation position</h2>
        <p className="mt-0.5 text-sm text-neutral-500">Where the nav bar sits.</p>
        <select
          value={settings.navPosition}
          onChange={(e) => void save({ navPosition: e.target.value as UserSettings["navPosition"] })}
          className="mt-2 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
        >
          {NAV_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </section>

      {saved && <p className="text-xs text-neutral-500">Saved</p>}
    </div>
  );
}
