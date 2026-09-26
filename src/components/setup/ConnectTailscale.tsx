"use client";
// "Connect with Tailscale" on the first-run page (ADR-282), shown while the
// Tailscale module is off. One click turns the module on and asks it to
// connect, through the same two API calls Build → Modules and the module's own
// Connect button make. The page then refreshes into the module's own panel,
// which carries on from there (sign in to Tailscale, the address, the QR code).
// Core never imports the module; it only calls its route.
import { useState } from "react";
import { useRouter } from "next/navigation";

const BUTTON =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-40";

export default function ConnectTailscale() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const on = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: { tailscale: true } }),
      });
      if (!on.ok) throw new Error("Couldn't turn on private access. Try again.");
      const res = await fetch("/api/tailscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "The local service did not answer.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className={BUTTON} disabled={busy} onClick={() => void connect()}>
        {busy ? "Connecting…" : "Connect with Tailscale"}
      </button>
      {error && <p className="ui-meta mt-1 text-ink-subtle">{error}</p>}
    </div>
  );
}
