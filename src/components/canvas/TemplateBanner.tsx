// The "Template" banner on a prototype item's canvas (ADR-093, TPL2). Makes it
// unmistakable you're editing a template (not a real item), and carries its
// registry actions: inline rename, set-as-default, duplicate, delete. Apply is
// elsewhere ("+ New" / the chooser, TPL4); this is the authoring surface.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmButton from "@/components/ui/ConfirmButton";

export default function TemplateBanner({
  templateId,
  name,
  isDefault,
  typeLabel,
}: {
  templateId: string;
  name: string;
  isDefault: boolean;
  typeLabel: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState<null | "rename" | "default" | "duplicate">(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/templates/${templateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `failed (${res.status})`);
      return false;
    }
    return true;
  }

  async function rename() {
    if (busy) return;
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    setBusy("rename");
    if (await patch({ name: next })) {
      setEditing(false);
      router.refresh();
    }
    setBusy(null);
  }

  async function toggleDefault() {
    if (busy) return;
    setBusy("default");
    if (await patch({ isDefault: !isDefault })) router.refresh();
    setBusy(null);
  }

  async function duplicate() {
    if (busy) return;
    setBusy("duplicate");
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `failed (${res.status})`);
        setBusy(null);
        return;
      }
      const { template } = (await res.json()) as { template: { prototypeItemId: string } };
      router.push(`/items/${template.prototypeItemId}`);
      router.refresh();
    } catch {
      setError("failed (offline?)");
      setBusy(null);
    }
  }

  async function confirmDelete() {
    const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `delete failed (${res.status})`);
    }
    router.push("/build/templates");
    router.refresh();
  }

  const actionClass =
    "rounded px-2 py-0.5 text-xs text-amber-200/80 hover:bg-amber-900/40 hover:text-amber-100 disabled:opacity-50";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-8 md:px-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2">
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          Template
        </span>
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(name);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded border border-amber-800/60 bg-neutral-950 px-2 py-0.5 text-sm text-neutral-100 outline-none focus:border-amber-600"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            title="Rename template"
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-neutral-100 hover:text-white"
          >
            {name}
          </button>
        )}
        <span className="text-xs text-amber-200/50">{typeLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void toggleDefault()}
            disabled={busy !== null}
            title={isDefault ? "This type's default for “+ New”" : "Make this the type's default for “+ New”"}
            className={actionClass}
          >
            {isDefault ? "★ Default" : "☆ Set default"}
          </button>
          <button
            type="button"
            onClick={() => void duplicate()}
            disabled={busy !== null}
            className={actionClass}
          >
            {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
          </button>
          <ConfirmButton
            onConfirm={confirmDelete}
            title={`Delete the “${name}” template?`}
            description="The prototype moves to Trash. Items already created from it aren't affected."
            align="right"
            trigger="Delete"
            triggerClassName={actionClass}
          />
          <Link
            href="/build/templates"
            className="rounded px-2 py-0.5 text-xs text-amber-200/60 hover:bg-amber-900/40 hover:text-amber-100"
          >
            All templates
          </Link>
        </div>
        {error && <span className="w-full text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
