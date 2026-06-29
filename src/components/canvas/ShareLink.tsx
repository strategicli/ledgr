// Share link control (slice 31, PRD §4.12): mint an unguessable, read-only
// public link to this item (print-friendly, PDF-downloadable), copy it, and
// revoke it. Sits beside Save Offline on every canvas. Owner-scoped on the
// server; the public render takes no session.
"use client";

import { useEffect, useState } from "react";

type TokenRow = { token: string; revokedAt: string | null; createdAt: string };

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

export default function ShareLink({ itemId }: { itemId: string }) {
  const [active, setActive] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  // Bakes into the next link: off → the shared/PDF render drops @-mention icons
  // for a cleaner document. The choice rides the token, so the recipient sees it.
  const [showIcons, setShowIcons] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/items/${itemId}/share`)
      .then((r) => (r.ok ? r.json() : { tokens: [] }))
      .then((data: { tokens?: TokenRow[] }) => {
        if (!cancelled) setActive((data.tokens ?? []).filter((t) => !t.revokedAt));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showIcons }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      const { token } = (await res.json()) as { token: string };
      setActive((prev) => [{ token, revokedAt: null, createdAt: new Date().toISOString() }, ...prev]);
      void copy(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not create link");
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000);
    } catch {
      // clipboard blocked (insecure context); the link is still shown to copy
      // by hand.
    }
  }

  async function revoke(token: string) {
    setActive((prev) => prev.filter((t) => t.token !== token)); // optimistic
    try {
      await fetch(`/api/items/${itemId}/share?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
    } catch {
      // If it failed, a refresh re-lists it; revocation is also idempotent.
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-2 pt-2 sm:px-8 md:px-12">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void create()}
          disabled={busy}
          className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Creating…" : active.length > 0 ? "New share link" : "Share link"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={showIcons}
            onChange={(e) => setShowIcons(e.target.checked)}
            className="ledgr-check"
          />
          Show item icons
        </label>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {active.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {active.map((t) => (
            <li key={t.token} className="flex items-center gap-2 text-xs">
              <a
                href={`/share/${t.token}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-neutral-400 hover:text-neutral-200"
              >
                {`/share/${t.token}`}
              </a>
              <button
                onClick={() => void copy(t.token)}
                className="shrink-0 text-neutral-500 hover:text-neutral-300"
              >
                {copied === t.token ? "copied ✓" : "copy"}
              </button>
              <button
                onClick={() => void revoke(t.token)}
                className="shrink-0 text-neutral-600 hover:text-[var(--accent)]"
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
