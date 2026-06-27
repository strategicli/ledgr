// Build → Types → edit: the "Table of contents" panel (ADR-114). Toggles the
// floating outline for this type and which heading levels it includes, then
// saves to users.settings.tocByType via PATCH /api/types/[key]/toc — no schema
// change, the same posture/optimistic-save pattern as ListTabsEditor. "Reset to
// default" drops the override (back to auto-on, all levels).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_TOC, TOC_LEVELS, type TocConfig } from "@/lib/toc";

// H1/H2/H3 friendly labels, matching the reference (Notion) settings panel.
const LEVEL_LABELS: Record<number, string> = {
  1: "Large headings",
  2: "Medium headings",
  3: "Small headings",
};

// A snapshot string for dirty-tracking (levels order-insensitive).
function snap(enabled: boolean, levels: number[]): string {
  return JSON.stringify({ enabled, levels: [...levels].sort((a, b) => a - b) });
}

function Toggle({
  on,
  onClick,
  disabled,
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "bg-[var(--accent)]" : "bg-neutral-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function TocSettingsEditor({
  typeKey,
  initial,
  customized,
}: {
  typeKey: string;
  initial: TocConfig;
  customized: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [levels, setLevels] = useState<number[]>(initial.levels);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [baseline, setBaseline] = useState(() => snap(initial.enabled, initial.levels));
  const dirty = snap(enabled, levels) !== baseline;

  function toggleLevel(l: number) {
    setLevels((ls) =>
      ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l].sort((a, b) => a - b)
    );
    setSaved(false);
  }

  async function persist(body: { config: TocConfig | null }, after: () => void) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/types/${typeKey}/toc`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Save failed (${res.status})`);
        return;
      }
      after();
      setSaved(true);
      router.refresh();
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    // An enabled outline with no levels would show nothing; fall back to all.
    const cfg: TocConfig = {
      enabled,
      levels: levels.length ? [...levels].sort((a, b) => a - b) : [...DEFAULT_TOC.levels],
    };
    void persist({ config: cfg }, () => {
      setLevels(cfg.levels);
      setBaseline(snap(cfg.enabled, cfg.levels));
    });
  }

  function reset() {
    void persist({ config: null }, () => {
      setEnabled(DEFAULT_TOC.enabled);
      setLevels([...DEFAULT_TOC.levels]);
      setBaseline(snap(DEFAULT_TOC.enabled, DEFAULT_TOC.levels));
      setSaved(false);
    });
  }

  return (
    <section className="mt-8 rounded-xl border border-neutral-800 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
          Table of contents
        </h2>
        <span className="text-xs text-neutral-600">
          {customized ? "Customized" : "Default"}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        A floating outline built from this type&apos;s headings — a hover rail on the
        desktop reading view, a tap-to-open list on phones. It only appears on items with
        at least two headings.
      </p>

      <div className="mt-3 divide-y divide-neutral-800/70 rounded-lg border border-neutral-800">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-sm text-neutral-200">Outline</span>
          <Toggle
            on={enabled}
            onClick={() => {
              setEnabled((v) => !v);
              setSaved(false);
            }}
            label="Show the floating table of contents"
          />
        </div>
        {TOC_LEVELS.map((l) => (
          <div key={l} className="flex items-center justify-between gap-3 py-2.5 pl-6 pr-3">
            <span
              className={`flex items-center gap-2 text-sm ${
                enabled ? "text-neutral-300" : "text-neutral-600"
              }`}
            >
              <span className="font-mono text-xs text-neutral-500">H{l}</span>
              {LEVEL_LABELS[l]}
            </span>
            <Toggle
              on={enabled && levels.includes(l)}
              disabled={!enabled}
              onClick={() => toggleLevel(l)}
              label={`Include H${l} headings`}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving || (!customized && !dirty)}
          className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
        >
          Reset to default
        </button>
        {saved && !dirty && <span className="text-xs text-emerald-500">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </section>
  );
}
