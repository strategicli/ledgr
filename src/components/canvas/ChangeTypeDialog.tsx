// The "Change type" dialog (ADR-132): pick a target type, preview exactly what
// the move does, then commit. The preview and the commit both call
// POST /api/items/[id]/move-type (dryRun for the preview), so what you see is
// what you get. Opened from the item actions menu; self-contained modal so it
// survives the menu closing.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavGlyph from "@/components/nav/NavGlyph";

type TypeOption = { key: string; label: string; icon: string | null };

type MoveSummary = {
  from: string;
  to: string;
  carried: string[];
  surfaced: string[];
  relationCount: number;
};

export default function ChangeTypeDialog({
  itemId,
  currentType,
  onClose,
}: {
  itemId: string;
  currentType: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [target, setTarget] = useState("");
  const [summary, setSummary] = useState<MoveSummary | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape (the parent menu's handler is gone once the menu closed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the type list once; drop the current type and any task/template-ish
  // system types are still selectable (any registered type is a valid target).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/types");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          types: { key: string; label: string; icon: string | null }[];
        };
        if (!alive) return;
        setTypes(
          data.types
            .filter((t) => t.key !== currentType)
            .map((t) => ({ key: t.key, label: t.label, icon: t.icon }))
        );
      } catch {
        if (alive) setError("Couldn't load types.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentType]);

  // Preview (dry run) whenever the target changes.
  const preview = useCallback(
    async (targetType: string) => {
      setSummary(null);
      setError(null);
      if (!targetType) return;
      setPreviewing(true);
      try {
        const res = await fetch(`/api/items/${itemId}/move-type`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, dryRun: true }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { summary: MoveSummary };
        setSummary(data.summary);
      } catch {
        setError("Couldn't preview the move.");
      } finally {
        setPreviewing(false);
      }
    },
    [itemId]
  );

  function onPickTarget(next: string) {
    setTarget(next);
    void preview(next);
  }

  async function commit() {
    if (!target || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/move-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: target }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onClose();
      router.refresh();
    } catch {
      setError("Couldn't move the item.");
      setCommitting(false);
    }
  }

  const targetOption = types.find((t) => t.key === target);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-neutral-800 bg-[var(--background)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">Change type</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-xs text-neutral-400">
          Move this item to
          <select
            value={target}
            onChange={(e) => onPickTarget(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200"
          >
            <option value="">Select a type…</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {previewing && (
          <p className="text-xs text-neutral-500">Checking what will change…</p>
        )}

        {summary && !previewing && (
          <div className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-300">
            <div className="flex items-center gap-1.5 text-neutral-400">
              {targetOption && <NavGlyph icon={targetOption.icon ?? ""} size={14} />}
              <span>What happens</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              <li className="flex gap-2">
                <span className="text-[var(--accent)]">✓</span>
                <span>
                  {summary.carried.length > 0
                    ? `${summary.carried.length} ${summary.carried.length === 1 ? "property carries" : "properties carry"} over (${summary.carried.join(", ")})`
                    : "No shared properties to carry over"}
                </span>
              </li>
              {summary.surfaced.length > 0 && (
                <li className="flex gap-2">
                  <span>→</span>
                  <span>
                    {summary.surfaced.length}{" "}
                    {summary.surfaced.length === 1 ? "property" : "properties"} (
                    {summary.surfaced.join(", ")}) {summary.to} doesn&rsquo;t have
                    will be written into the body as a YAML block
                  </span>
                </li>
              )}
              <li className="flex gap-2">
                <span className="text-[var(--accent)]">✓</span>
                <span>
                  {summary.relationCount}{" "}
                  {summary.relationCount === 1 ? "relation" : "relations"} kept,
                  untouched
                </span>
              </li>
            </ul>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void commit()}
            disabled={!target || committing || previewing}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {committing
              ? "Moving…"
              : targetOption
                ? `Move to ${targetOption.label}`
                : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
