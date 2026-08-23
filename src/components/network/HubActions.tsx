"use client";

// Build → Network's client islands (ADR-209): add a hub (URL + a token
// minted on that hub — the mirror image of the hub-side Add device), and
// remove one. Everything else on the page is server-rendered.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";

const button =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-60";

export function AddHub() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/hubs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, token }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "The hub could not be added.");
      }
      setOpen(false);
      setUrl("");
      setToken("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={button} onClick={() => setOpen(true)}>
        + Add hub
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-card border border-line bg-surface-2 p-3">
      <label className="ui-meta block text-ink-subtle">
        Hub URL
        <input
          className="mt-1 w-full rounded-card border border-line bg-surface-0 px-2 py-1.5 text-sm text-ink"
          placeholder="https://hub.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
      </label>
      <label className="ui-meta mt-3 block text-ink-subtle">
        Device token, minted on that hub
        <input
          className="mt-1 w-full rounded-card border border-line bg-surface-0 px-2 py-1.5 font-mono text-sm text-ink"
          placeholder="paste the token its Add-device showed once"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p className="ui-meta mt-2 text-ink-subtle">
        On the other instance: Build → Network → Devices → Add device, then
        paste the one-time token here. New devices start pull-only there;
        allow push from that side when you are ready.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={button} disabled={busy || !url.trim() || !token.trim()} onClick={() => void add()}>
          {busy ? "Adding…" : "Add hub"}
        </button>
        <button type="button" className="ui-meta text-ink-subtle hover:text-ink" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && <span className="ui-meta text-rose-400">{error}</span>}
      </div>
    </div>
  );
}

export function RemoveHub({ url }: { url: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    const res = await fetch("/api/sync/hubs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "The hub could not be removed.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <ConfirmButton
        title="Stop syncing to this hub?"
        description="This instance keeps all its data; it just stops exchanging changes with that hub. The hub keeps its copy too, and they drift apart from here."
        confirmLabel="Remove hub"
        panelClassName="w-72"
        trigger={<span>Remove</span>}
        triggerClassName="ui-meta text-ink-subtle hover:text-rose-400"
        onConfirm={() => void remove()}
      />
      {error && <span className="ui-meta text-rose-400">{error}</span>}
    </span>
  );
}
