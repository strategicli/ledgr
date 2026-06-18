// Per-type status editor (Tasks Polish S2, ADR-082) — the ClickUp-style "Use
// custom statuses" panel on the type edit page. Statuses are grouped under the
// four fixed categories (the plumbing buckets); the user adds/labels/colors them
// and picks a default per category. "Inherit" resets to the system default.
// PATCHes the focused /api/types/[key]/statuses route (never the whole builder),
// which validates + re-syncs every item's denormalized category.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_DEFAULT_COLOR,
  CATEGORY_META,
  STATUS_CATEGORIES,
  SYSTEM_DEFAULT_STATUSES,
  type StatusCategory,
  type StatusDef,
} from "@/lib/status";

const inputClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600";

export default function StatusSchemaEditor({
  typeKey,
  initial,
}: {
  typeKey: string;
  // The type's stored statusSchema (null = inheriting the system default).
  initial: StatusDef[] | null;
}) {
  const router = useRouter();
  const [custom, setCustom] = useState(initial != null);
  // Seed custom editing from the inherited default when the type has none yet,
  // so flipping to "custom" starts from To Do / Done / Archived, not blank.
  const [rows, setRows] = useState<StatusDef[]>(
    initial && initial.length ? initial : SYSTEM_DEFAULT_STATUSES
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(key: string, patch: Partial<StatusDef>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function add(category: StatusCategory) {
    // A fresh stable key not already in use (no Date.now — the purity rule); the
    // key is opaque, the label is what shows.
    setRows((rs) => {
      const used = new Set(rs.map((r) => r.key));
      let n = rs.length + 1;
      while (used.has(`status_${n}`)) n += 1;
      return [
        ...rs,
        {
          key: `status_${n}`,
          label: "New status",
          category,
          color: CATEGORY_DEFAULT_COLOR[category],
        },
      ];
    });
  }
  // One default per category (a radio); clears the flag on the others in it.
  function setDefault(category: StatusCategory, key: string) {
    setRows((rs) =>
      rs.map((r) =>
        r.category === category ? { ...r, isDefault: r.key === key } : r
      )
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/types/${typeKey}/statuses`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: custom ? rows : null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `save failed (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="mt-6 flex flex-col gap-3 rounded-lg border border-neutral-800 p-4">
      <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Statuses
      </legend>
      <p className="text-xs text-neutral-500">
        Statuses live inside four fixed categories the rest of Ledgr keys off
        (the done category drives the check-box and completing a recurring task).
        Labels and colors are yours.
      </p>

      <div className="flex gap-4 text-sm text-neutral-300">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            className="ledgr-check ledgr-check-sm"
            checked={!custom}
            onChange={() => setCustom(false)}
          />
          Inherit default (To Do / Done / Archived)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            className="ledgr-check ledgr-check-sm"
            checked={custom}
            onChange={() => setCustom(true)}
          />
          Use custom statuses
        </label>
      </div>

      {custom && (
        <div className="flex flex-col gap-4">
          {STATUS_CATEGORIES.map((category) => {
            const inCat = rows.filter((r) => r.category === category);
            return (
              <div key={category} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {CATEGORY_META[category].label}
                  {category === "done" && (
                    <span className="font-normal normal-case tracking-normal text-neutral-600">
                      (the check-box completes to the default here)
                    </span>
                  )}
                </div>
                {inCat.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={s.color}
                      onChange={(e) => update(s.key, { color: e.target.value })}
                      className="h-7 w-9 shrink-0 cursor-pointer rounded border border-neutral-800 bg-neutral-900"
                      aria-label={`${s.label} color`}
                    />
                    <input
                      value={s.label}
                      onChange={(e) => update(s.key, { label: e.target.value })}
                      className={`${inputClass} flex-1`}
                      placeholder="Status label"
                    />
                    <label
                      className="flex shrink-0 items-center gap-1 text-xs text-neutral-500"
                      title="The default status in this category"
                    >
                      <input
                        type="radio"
                        name={`default-${category}`}
                        className="ledgr-check ledgr-check-sm"
                        checked={!!s.isDefault}
                        onChange={() => setDefault(category, s.key)}
                      />
                      default
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(s.key)}
                      className="shrink-0 rounded px-1.5 text-xs text-neutral-500 hover:text-red-400"
                      aria-label={`Remove ${s.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => add(category)}
                  className="self-start rounded border border-dashed border-neutral-700 px-2 py-0.5 text-xs text-neutral-500 hover:border-neutral-500 hover:text-neutral-300"
                >
                  + Add status
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save statuses"}
        </button>
        {saved && <span className="text-xs text-green-500">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </fieldset>
  );
}
