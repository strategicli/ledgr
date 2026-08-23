"use client";

// Build → Network's client islands (ADR-209): add a hub (URL + a token
// minted on that hub — the mirror image of the hub-side Add device), and
// remove one. ADR-210 adds the two per-hub axes (cadence and fallback trust)
// on both the add form and each row, plus priority reordering — before that,
// promoting a hub meant remove + re-add, which threw its token away.
// Everything else on the page is server-rendered.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import type { HubCadence, HubFallback } from "@/lib/sync/client";

const button =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-60";
const select = "rounded-card border border-line bg-surface-0 px-1.5 py-0.5 text-xs text-ink";
const tooltip =
  "pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs normal-case text-neutral-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100";

// The tradeoff, stated where the choice is made rather than in a doc: a hub
// you only reach once a day is by definition up to a day behind, so falling
// back to it loses everything since its last exchange.
const CADENCE_HELP =
  "Continuous exchanges every few seconds — right for another machine of yours. Daily is right for a cloud archive, and means that hub can be up to a day behind, so falling back to it loses everything since its last exchange.";
const FALLBACK_HELP =
  "Automatic means this instance reads from that hub without asking. Ask first means it only deposits changes there; if every automatic hub goes down it will ask before it starts reading from this one, because a stale source makes everything look fresher than it is.";

export function AddHub() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [cadence, setCadence] = useState<HubCadence>("continuous");
  const [fallback, setFallback] = useState<HubFallback>("automatic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/hubs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, token, cadence, fallback }),
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
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="ui-meta block text-ink-subtle">
          How often
          <select
            className={select + " mt-1 block"}
            value={cadence}
            onChange={(e) => setCadence(e.target.value as HubCadence)}
          >
            <option value="continuous">Continuously</option>
            <option value="daily">Once a day</option>
          </select>
        </label>
        <label className="ui-meta block text-ink-subtle">
          Fall back to it
          <select
            className={select + " mt-1 block"}
            value={fallback}
            onChange={(e) => setFallback(e.target.value as HubFallback)}
          >
            <option value="automatic">Automatically</option>
            <option value="prompt">Ask me first</option>
          </select>
        </label>
      </div>
      <p className="ui-meta mt-2 text-ink-subtle">
        {CADENCE_HELP} {FALLBACK_HELP}
      </p>
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

// Per-row settings: the two axes, each PATCHing on change so there is no Save
// button to forget, and the up/down priority moves. Order IS priority —
// automatic hubs are tried in order, then emergency hubs are offered in order.
export function HubSettings({
  url,
  cadence,
  fallback,
  canMoveUp,
  canMoveDown,
}: {
  url: string;
  cadence: HubCadence;
  fallback: HubFallback;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/hubs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, ...payload }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "That change could not be saved.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="group relative inline-flex cursor-help items-center">
        <select
          className={select}
          value={cadence}
          disabled={busy}
          aria-label="How often to exchange with this hub"
          onChange={(e) => void patch({ cadence: e.target.value })}
        >
          <option value="continuous">Continuously</option>
          <option value="daily">Once a day</option>
        </select>
        <span role="tooltip" className={tooltip}>
          {CADENCE_HELP}
        </span>
      </span>
      <span className="group relative inline-flex cursor-help items-center">
        <select
          className={select}
          value={fallback}
          disabled={busy}
          aria-label="Whether to fall back to this hub without asking"
          onChange={(e) => void patch({ fallback: e.target.value })}
        >
          <option value="automatic">Automatic</option>
          <option value="prompt">Ask first</option>
        </select>
        <span role="tooltip" className={tooltip}>
          {FALLBACK_HELP}
        </span>
      </span>
      <span className="inline-flex items-center">
        <button
          type="button"
          className="ui-meta px-1 text-ink-subtle hover:text-ink disabled:opacity-30"
          disabled={busy || !canMoveUp}
          aria-label="Higher priority"
          title="Higher priority"
          onClick={() => void patch({ move: "up" })}
        >
          &uarr;
        </button>
        <button
          type="button"
          className="ui-meta px-1 text-ink-subtle hover:text-ink disabled:opacity-30"
          disabled={busy || !canMoveDown}
          aria-label="Lower priority"
          title="Lower priority"
          onClick={() => void patch({ move: "down" })}
        >
          &darr;
        </button>
      </span>
      {error && <span className="ui-meta text-rose-400">{error}</span>}
    </span>
  );
}
