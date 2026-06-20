// Per-row actions on the Build → Templates index (ADR-093, TPL2): set-as-default
// (one per type), duplicate, and delete. All hit the registry endpoints and
// refresh in place — managing templates, you stay on the index.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmButton from "@/components/ui/ConfirmButton";

export default function TemplateRowActions({
  id,
  name,
  isDefault,
}: {
  id: string;
  name: string;
  isDefault: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "default" | "duplicate">(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleDefault() {
    if (busy) return;
    setBusy("default");
    setError(null);
    const res = await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: !isDefault }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `failed (${res.status})`);
    } else {
      router.refresh();
    }
    setBusy(null);
  }

  async function duplicate() {
    if (busy) return;
    setBusy("duplicate");
    setError(null);
    const res = await fetch(`/api/templates/${id}/duplicate`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `failed (${res.status})`);
    } else {
      router.refresh();
    }
    setBusy(null);
  }

  async function confirmDelete() {
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `delete failed (${res.status})`);
    }
    router.refresh();
  }

  const btn =
    "rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50";

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void toggleDefault()}
        disabled={busy !== null}
        title={isDefault ? "This type's default for “+ New”" : "Make this the type's default for “+ New”"}
        className={`${btn} ${isDefault ? "text-amber-300 hover:text-amber-200" : ""}`}
      >
        {isDefault ? "★ Default" : "☆ Set default"}
      </button>
      <button type="button" onClick={() => void duplicate()} disabled={busy !== null} className={btn}>
        {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
      </button>
      <ConfirmButton
        onConfirm={confirmDelete}
        title={`Delete the “${name}” template?`}
        description="The template's prototype moves to Trash. Items already created from it aren't affected."
        align="right"
        trigger="Delete"
        triggerClassName="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
