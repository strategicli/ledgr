"use client";
// "Restore from a backup" on the first-run page (ADR-282). Step 1 asks the
// app for a one-time upload address (refused with a count when this copy
// already holds items, unless "replace everything" is ticked); step 2 sends
// the file there. Then Ledgr restarts, the local service loads the backup, and
// this page waits for it to come back and reloads /setup, which says how it went.
import { useState } from "react";

const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

async function waitForRestore(): Promise<void> {
  const deadline = Date.now() + 60 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch("/restore-upload", { cache: "no-store" });
      const data = (await res.json()) as { pending?: boolean };
      if (res.ok && data.pending === false) break;
    } catch {
      // Ledgr is stopped while it restores; keep waiting.
    }
  }
  window.location.assign("/setup");
}

export default function RestoreFromBackup({ itemCount }: { itemCount: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState(itemCount);
  const [replace, setReplace] = useState(false);
  const [phase, setPhase] = useState<"idle" | "sending" | "restoring">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!file) return;
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/local/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace }),
      });
      const data = (await res.json().catch(() => ({}))) as { uploadUrl?: string; items?: number; error?: string };
      if (res.status === 409) {
        setItems(data.items ?? 1);
        setPhase("idle");
        return;
      }
      if (!res.ok || !data.uploadUrl) throw new Error(data.error ?? "That didn't work. Try again.");
      const up = await fetch(data.uploadUrl, { method: "PUT", body: file });
      const upData = (await up.json().catch(() => ({}))) as { error?: string };
      if (!up.ok) throw new Error(upData.error ?? "The file didn't upload. Try again.");
      setPhase("restoring");
      await waitForRestore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      setPhase("idle");
    }
  }

  if (phase === "restoring") {
    return (
      <p className="text-sm text-ink" role="status">
        Restoring. Ledgr stops, loads your backup, and starts again. A large backup takes a few minutes. This page
        reloads by itself when it is done.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept=".dump"
        aria-label="Backup file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-card file:border file:border-line-strong file:bg-surface-2 file:px-2.5 file:py-1 file:text-xs file:text-ink hover:file:bg-surface-3"
      />
      {items > 0 && (
        <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-ink">
          <p>
            This Ledgr already holds {items} item{items === 1 ? "" : "s"}. A restore replaces all of them with what is
            in the backup, and they can&rsquo;t be brought back.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace everything here with the backup
          </label>
        </div>
      )}
      <button
        type="button"
        onClick={() => void start()}
        disabled={!file || phase === "sending" || (items > 0 && !replace)}
        className={PRIMARY}
      >
        {phase === "sending" ? "Uploading…" : "Restore this backup"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
