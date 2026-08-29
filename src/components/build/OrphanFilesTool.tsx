// The orphaned-files sweep (ADR-233) — Data Hygiene's first real tool. Scan
// lists every object in storage with no attachment row behind it (item purges
// from before the purge deleted bytes, or an upload whose row was deleted
// mid-flight); Delete reclaims them. The DELETE endpoint re-scans server-side,
// so nothing uploaded after the scan shown here can be caught.
"use client";

import { useState } from "react";
import { showToast } from "@/components/ui/ActionToast";
import ConfirmButton from "@/components/ui/ConfirmButton";

type Orphan = { key: string; sizeBytes: number };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// The key is `${ownerId}/${attachmentId}/${filename}` — show the filename.
function filenameOf(key: string): string {
  return key.split("/").slice(2).join("/") || key;
}

export default function OrphanFilesTool() {
  const [scan, setScan] = useState<{ orphans: Orphan[]; totalBytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const runScan = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/hygiene/orphan-files");
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `scan failed (${res.status})`);
      }
      setScan(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    const res = await fetch("/api/hygiene/orphan-files", { method: "DELETE" });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error ?? `delete failed (${res.status})`);
    }
    const { deleted, freedBytes, failed } = await res.json();
    showToast(
      `Deleted ${deleted} orphaned file${deleted === 1 ? "" : "s"} (${fmtBytes(freedBytes)} freed)` +
        (failed > 0 ? ` — ${failed} failed, scan again` : "")
    );
    setScan(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={busy}
          className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Scanning…" : "Scan for orphaned files"}
        </button>
        {scan && scan.orphans.length > 0 && (
          <ConfirmButton
            title={`Delete ${scan.orphans.length} orphaned file${scan.orphans.length === 1 ? "" : "s"}?`}
            description={`Frees ${fmtBytes(scan.totalBytes)} of storage. These files have no item behind them anymore; nothing in Ledgr links to them.`}
            confirmLabel="Delete all"
            trigger={<span>Delete all ({fmtBytes(scan.totalBytes)})</span>}
            triggerClassName="rounded border border-red-900/60 bg-red-950/40 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-900/40"
            onConfirm={purge}
          />
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {scan && scan.orphans.length === 0 && (
        <p className="text-sm text-ink-subtle">
          No orphaned files — everything in storage belongs to an item.
        </p>
      )}
      {scan && scan.orphans.length > 0 && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {scan.orphans.map((o) => (
            <li key={o.key} className="flex items-center gap-2 text-sm">
              <span className="truncate text-ink-muted">{filenameOf(o.key)}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-faint">
                {fmtBytes(o.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
