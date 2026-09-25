// Build → Modules: the on/off switch for one module (ADR-272). PATCHes
// settings.modules (the route merges per id), then refreshes so the page and
// every type menu re-read the stored answer. No confirm either way: turning a
// module off only hides it, and nothing is deleted. Turning one on also turns
// on the modules it requires (`alsoEnable`), named in the note under the switch.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ModuleToggle({
  moduleId,
  label,
  enabled,
  disabled = false,
  alsoEnable = [],
  note,
}: {
  moduleId: string;
  label: string;
  enabled: boolean;
  // The machine cannot run this module (the reason shows beside it).
  disabled?: boolean;
  // Module ids switched on together with this one (its requirements that are off).
  alsoEnable?: string[];
  // A short line under the switch: what turning it on also turns on.
  note?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !on;
    setOn(next); // optimistic; reverted on failure
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modules: {
            [moduleId]: next,
            ...(next ? Object.fromEntries(alsoEnable.map((id) => [id, true])) : {}),
          },
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setOn(!next);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label} module`}
        disabled={busy || disabled}
        onClick={() => void toggle()}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          on ? "bg-[var(--accent)]" : "bg-surface-3"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      {note && !on && <p className="ui-meta max-w-48 text-right text-ink-subtle">{note}</p>}
      {error && <p className="ui-meta text-rose-400">{error}</p>}
    </div>
  );
}
