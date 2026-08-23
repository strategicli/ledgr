"use client";

// The Synced devices manager on /build/updates (plan decision 15). One client
// island: the table of registered devices, the Add-device flow (the token is
// shown exactly once), Revoke/Restore, and Delete for revoked rows.
//
// Deliberately NOT a multi-select list surface: this is a small management
// table (a handful of rows, each action per-device and deliberate), one of
// ADR-118's management-shaped exceptions, like Trash.
import { useState } from "react";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { badgeCount } from "@/lib/format-count";
import { relativeTime } from "@/lib/relative-time";
import type { PeerSummary } from "@/lib/sync/peers";

type Minted = { name: string; token: string };

export default function SyncedDevices({ initialPeers }: { initialPeers: PeerSummary[] }) {
  const [peers, setPeers] = useState<PeerSummary[]>(initialPeers);
  const [name, setName] = useState("");
  const [pullOnlyNew, setPullOnlyNew] = useState(true);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/sync/peers", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { peers: PeerSummary[] };
      setPeers(data.peers);
    }
  }

  async function addDevice() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/peers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, pullOnly: pullOnlyNew }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "The device could not be added.");
        return;
      }
      setMinted({ name: trimmed, token: data.token });
      setCopied(false);
      setName("");
      setPullOnlyNew(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The device could not be added.");
    } finally {
      setBusy(false);
    }
  }

  // Revoke/restore/delete. Thrown errors surface inside ConfirmButton's
  // popover; the restore button reports through the shared error line.
  async function mutate(deviceId: string, init: RequestInit) {
    const res = await fetch(`/api/sync/peers/${deviceId}`, init);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "That did not work.");
    }
    await refresh();
  }

  const setRevoked = (deviceId: string, revoked: boolean) =>
    mutate(deviceId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revoked }),
    });

  // Guardrail 1's "arming sync safely" lever: flip a device between
  // pull-only and full from the hub, correctable even if the spoke can't be
  // reached.
  const setPullOnly = (deviceId: string, pullOnly: boolean) =>
    mutate(deviceId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pullOnly }),
    });

  const rowButton =
    "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3";

  return (
    <div>
      {peers.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No devices sync against this instance yet.
        </p>
      ) : (
        // No overflow wrapper here on purpose: `overflow-x-auto` computes
        // overflow-y to `auto` as well (one non-visible axis forces the other),
        // which clipped the Revoke/Allow-push confirmation popover inside the
        // table and put a stray scrollbar on the card. This table is four
        // narrow columns on a desktop-first Build surface, so it never needed
        // horizontal scrolling; long device names wrap instead (break-words on
        // the name cell). ponytail: if a Build table ever genuinely needs BOTH
        // horizontal scrolling and a popover, ConfirmButton needs to render in
        // a portal — that is the real fix, and this is not that case.
        <div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="ui-meta text-ink-subtle">
                <th className="py-1.5 pr-4 font-normal">Device</th>
                <th className="py-1.5 pr-4 font-normal">Last seen</th>
                <th className="py-1.5 pr-4 font-normal">Behind</th>
                <th className="py-1.5 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {peers.map((p) => (
                <tr key={p.deviceId} className={p.revoked ? "opacity-60" : undefined}>
                  <td className="py-2 pr-4 break-words text-ink">
                    {p.name}
                    {p.revoked && (
                      <span className="ui-meta ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-ink-subtle">
                        revoked
                      </span>
                    )}
                    {p.pullOnly && (
                      <span className="ui-meta ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-ink-subtle">
                        pull-only
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-ink-muted">
                    {p.lastSeenAt ? relativeTime(p.lastSeenAt) : "never"}
                  </td>
                  <td className="py-2 pr-4 text-ink-muted tabular-nums">
                    {p.opsBehind === 0 ? (
                      "up to date"
                    ) : (
                      <>{badgeCount(p.opsBehind, 999)} ops behind</>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      {p.revoked ? (
                        <>
                          <button
                            type="button"
                            className={rowButton}
                            onClick={() =>
                              void setRevoked(p.deviceId, false).catch((err) =>
                                setError(err instanceof Error ? err.message : String(err))
                              )
                            }
                          >
                            Restore
                          </button>
                          <ConfirmButton
                            title={`Delete ${p.name}?`}
                            description="Removes the device and its token for good. It can be added again later with a new token."
                            confirmLabel="Delete"
                            align="right"
                            trigger={<span>Delete</span>}
                            triggerClassName={rowButton}
                            onConfirm={() => mutate(p.deviceId, { method: "DELETE" })}
                          />
                        </>
                      ) : (
                        <>
                          {p.pullOnly ? (
                            <ConfirmButton
                              title={`Let ${p.name} push to this hub?`}
                              description="Its own edits start flowing here on its next sync. Until now it could only receive."
                              confirmLabel="Allow push"
                              align="right"
                              panelClassName="w-80"
                              trigger={<span>Allow push</span>}
                              triggerClassName={rowButton}
                              onConfirm={() => setPullOnly(p.deviceId, false)}
                            >
                              <ul className="ui-meta list-disc space-y-1 pl-4 text-ink-muted">
                                <li>
                                  Conflicts resolve per field by whichever write is newer, so a
                                  device with a wrong clock or a stale copy can overwrite values
                                  here.
                                </li>
                                <li>
                                  A losing body is kept in that item&apos;s revisions and flagged,
                                  so body edits are recoverable. Other fields are not.
                                </li>
                                <li>
                                  Its first push is held if it has more than a few hundred pending
                                  changes, which is the guard against a bad restore.
                                </li>
                                <li>Reversible here at any time, even while that device is offline.</li>
                              </ul>
                            </ConfirmButton>
                          ) : (
                            <button
                              type="button"
                              className={rowButton}
                              onClick={() =>
                                void setPullOnly(p.deviceId, true).catch((err) =>
                                  setError(err instanceof Error ? err.message : String(err))
                                )
                              }
                            >
                              Make pull-only
                            </button>
                          )}
                          <ConfirmButton
                            title={`Revoke ${p.name}?`}
                            description="Its next sync will be refused. You can restore it later."
                            confirmLabel="Revoke"
                            align="right"
                            trigger={<span>Revoke</span>}
                            triggerClassName={rowButton}
                            onConfirm={() => setRevoked(p.deviceId, true)}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add-device flow: name → token, shown exactly once. */}
      {minted && (
        <div className="mt-4 rounded-card border border-amber-500/40 bg-surface-2 p-3">
          <p className="text-sm text-ink">
            Token for <strong className="font-medium">{minted.name}</strong>:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface-3 px-2 py-1 font-mono text-xs text-ink">
              {minted.token}
            </code>
            <button
              type="button"
              className={rowButton}
              onClick={() => {
                void navigator.clipboard.writeText(minted.token);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="ui-meta mt-2 text-amber-400">
            You will not see this token again. Paste it into the device&apos;s setup
            before closing this.
          </p>
          <button
            type="button"
            className="ui-meta mt-2 text-ink-subtle hover:text-ink"
            onClick={() => setMinted(null)}
          >
            Done, hide it
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addDevice();
          }}
          placeholder="Device name (e.g. Study PC)"
          className="w-56 rounded-card border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
        />
        <label className="ui-meta flex items-center gap-1.5 text-ink-muted">
          <input
            type="checkbox"
            checked={pullOnlyNew}
            onChange={(e) => setPullOnlyNew(e.target.checked)}
          />
          Pull-only (safe default for a new device)
        </label>
        <button
          type="button"
          onClick={() => void addDevice()}
          disabled={busy || !name.trim()}
          className="rounded-card border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add device"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
