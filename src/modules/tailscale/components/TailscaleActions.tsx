"use client";

// The buttons on the Tailscale options (ADR-276). The panel around them is a
// server component; these ask /api/tailscale and refresh it.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BUTTON =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-40";

async function post(action: "connect" | "disconnect") {
  const res = await fetch("/api/tailscale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "The local service did not answer.");
}

/** Re-render the panel every few seconds while something is on its way. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/**
 * Connect: switch this computer on, then open the Tailscale sign-in page in a
 * new tab as soon as the helper reports it. The tab is opened during the click
 * (a browser blocks one opened later) and pointed at the link when it arrives.
 */
export function ConnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    const tab = window.open("", "_blank");
    if (tab) {
      tab.opener = null; // the sign-in page gets no handle back to Ledgr
      tab.document.title = "Starting Tailscale…";
      tab.document.body.textContent = "Starting Tailscale… this tab turns into the sign-in page in a moment.";
    }
    try {
      await post("connect");
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const res = await fetch("/api/tailscale", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          status?: { state?: string; authUrl?: string | null; message?: string | null } | null;
        };
        const s = data.status;
        if (s?.state === "needs-login" && s.authUrl) {
          if (tab && !tab.closed) tab.location.href = s.authUrl;
          break;
        }
        if (s?.state === "running" || s?.state === "error") {
          tab?.close();
          break;
        }
      }
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      router.refresh();
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

/** Disconnect: sign this computer's Ledgr out of the tailnet and forget its keys. */
export function DisconnectButton({ label = "Disconnect" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await post("disconnect");
      // The supervisor signs the node out, which takes a few seconds.
      await new Promise((r) => setTimeout(r, 4000));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div>
      <span className="group relative inline-block cursor-help">
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void disconnect()}>
          {busy ? "Disconnecting…" : label}
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-64 rounded-card border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case text-ink-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          Signs this Ledgr out of your Tailscale network, so your other devices stop reaching it at the private
          address. Tailscale still lists it as an offline device; remove it there if you like. Nothing in Ledgr is
          deleted, and you can connect again any time.
        </span>
      </span>
      {error && <p className="ui-meta mt-1 text-ink-subtle">{error}</p>}
    </div>
  );
}
