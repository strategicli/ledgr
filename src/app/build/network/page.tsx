// Network (Build → MAINTAIN, ADR-209): the whole sync topology on one page —
// the hubs THIS instance syncs to (its uplinks), and the devices that sync
// FROM it (its spokes). These used to be two sections of /build/updates,
// which stopped being legible the moment a third node existed.
//
// Everything is read server-side; the client islands are the add/remove hub
// forms, the mode toggle, and the devices table's buttons.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { relativeTime } from "@/lib/relative-time";
import {
  gatherSyncStatus,
  hubCadence,
  hubFallback,
  readSyncHubs,
  type FullSyncStatus,
  type HubConfig,
} from "@/lib/sync/client";
import { listPeers, type PeerSummary } from "@/lib/sync/peers";
import SyncedDevices from "@/components/updates/SyncedDevices";
import SyncModeToggle from "@/components/updates/SyncModeToggle";
import { AddHub, HubSettings, RemoveHub } from "@/components/network/HubActions";
import CopyAddress from "@/components/network/CopyAddress";
import {
  readLanIps,
  readTailscaleState,
  reachableAddresses,
  TAILSCALE_ABSENT,
} from "@/lib/network-addresses";
import ReleasePushButton from "@/components/network/ReleasePushButton";
import {
  FallbackApprovalBlock,
  FallbackPromptBlock,
} from "@/components/network/FallbackPrompt";

export const dynamic = "force-dynamic";

function StatusDot({ tone }: { tone: "ok" | "warn" | "info" }) {
  const color =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-neutral-500";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 rounded-card border border-line bg-surface-1 p-4">{children}</div>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">{children}</code>
  );
}

export default async function Network() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  let sync: FullSyncStatus = { enabled: false };
  let hubs: HubConfig[] = [];
  try {
    sync = await gatherSyncStatus();
    // Tokens are never rendered; only url + the two ADR-210 axes are read.
    hubs = await readSyncHubs();
  } catch {
    // A database without the sync tables just shows the empty states.
  }
  // This instance's own reachable addresses (ADR-212), so adding a spoke is
  // copy-from-here, paste-into-there. Only meaningful on a local peer: a cloud
  // deploy's address is its domain and nobody needs telling.
  const isLocal = !!process.env.LEDGR_SUPERVISOR_DIR;
  const tailscale = isLocal ? await readTailscaleState() : TAILSCALE_ABSENT;
  const myAddresses = isLocal
    ? reachableAddresses({
        tailscale,
        lanIps: await readLanIps(),
        port: Number(process.env.PORT) || 3000,
      })
    : [];

  let peers: PeerSummary[] = [];
  try {
    peers = await listPeers();
  } catch {
    // Same posture.
  }

  const hubStatusByUrl = new Map(
    (sync.enabled ? sync.hubs : []).map((h) => [h.url, h] as const)
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="ui-title">Network</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        How this instance connects to the others. It can sync <em>to</em> hubs
        (its own changes flow up, theirs flow down), and other devices can sync{" "}
        <em>from</em> it. Both directions are managed here.
      </p>

      {/* ── The fallback decision, when there is one (ADR-210) ──────────── */}
      {sync.enabled && sync.fallbackPrompt && (
        <section className="mt-8">
          <h2 className="ui-section-label">Needs your decision</h2>
          <FallbackPromptBlock prompt={sync.fallbackPrompt} />
        </section>
      )}
      {sync.enabled && !sync.fallbackPrompt && sync.fallbackApproval && (
        <section className="mt-8">
          <h2 className="ui-section-label">Running on a backup</h2>
          <FallbackApprovalBlock approval={sync.fallbackApproval} />
        </section>
      )}

      {/* ── Hubs this instance syncs to ─────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Hubs this instance syncs to</h2>
        <Card>
          {hubs.length === 0 ? (
            <p className="text-sm text-ink-muted">
              This instance does not sync to any hub. It works entirely on its
              own data. Add a hub to start exchanging changes with another
              instance — you will need a device token minted on that hub.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {hubs.map((hub, i) => {
                const url = hub.url;
                const h = hubStatusByUrl.get(url);
                const reading = h?.pulling ?? hubFallback(hub) === "automatic";
                const isActive =
                  sync.enabled && sync.activeHubIndex === i && sync.state !== "offline";
                return (
                  <li key={url} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <StatusDot tone={h?.lastError ? "warn" : h?.lastSyncAt ? "ok" : "info"} />
                    <span className="min-w-0 flex-1 basis-64">
                      <span className="block truncate font-mono text-sm text-ink">{url}</span>
                      <span className="ui-meta block text-ink-subtle">
                        {i + 1}
                        {i === 0 ? " · highest priority" : ""}
                        {isActive ? " · in use" : ""}
                        {" · "}
                        {reading
                          ? "sending and reading"
                          : "sending only, until you approve reading"}
                        {" · "}
                        {h?.lastSyncAt ? `synced ${relativeTime(h.lastSyncAt)}` : "no sync yet"}
                        {h?.behindOps !== null && h?.behindOps !== undefined && h.behindOps > 0
                          ? ` · ${h.behindOps} of your changes not delivered`
                          : ""}
                      </span>
                      {h?.lastError && (
                        <span className="ui-meta block text-amber-400">{h.lastError}</span>
                      )}
                    </span>
                    <HubSettings
                      url={url}
                      cadence={hubCadence(hub)}
                      fallback={hubFallback(hub)}
                      canMoveUp={i > 0}
                      canMoveDown={i < hubs.length - 1}
                    />
                    <RemoveHub url={url} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3">
            <AddHub />
          </div>
          <p className="ui-meta mt-3 text-ink-subtle">
            Every hub gets your changes, each on its own schedule — a backup
            that stops receiving is not a backup. Order is priority: this
            instance reads from the first automatic hub that answers, and asks
            before it starts reading from an &ldquo;ask first&rdquo; hub.
            Repointing this instance at a{" "}
            <em>different primary</em> is not a setting — its data has to be
            re-filled from the new hub first: stop the supervisor, then{" "}
            <Mono>npm run local:restore -- --from-url &lt;new hub db&gt;</Mono>.
            Changing the URL alone would merge two diverged databases field by
            field.
          </p>
        </Card>
      </section>

      {/* ── This instance's own link state (spoke side) ─────────────────── */}
      {sync.enabled && (
        <section className="mt-8">
          <h2 className="ui-section-label">This instance&apos;s sync</h2>
          <Card>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr]">
              <dt className="ui-meta text-ink-subtle">Mode</dt>
              <dd className="text-sm text-ink">
                {sync.mode === "pull-only"
                  ? "Pull-only — this instance never pushes changes to a hub"
                  : "Full — pushes and pulls"}
                <SyncModeToggle mode={sync.mode} />
              </dd>

              <dt className="ui-meta text-ink-subtle">State</dt>
              <dd className="flex items-center gap-2 text-sm text-ink">
                <StatusDot
                  tone={
                    sync.state === "synced" && sync.activeHubIndex === 0
                      ? "ok"
                      : sync.state === "offline" || sync.state === "held"
                        ? "warn"
                        : "info"
                  }
                />
                {sync.state === "synced"
                  ? "Synced"
                  : sync.state === "pending"
                    ? "Changes waiting to sync"
                    : sync.state === "held"
                      ? "Push held (pulling still works)"
                      : "Offline (no hub reachable)"}
              </dd>

              {sync.state === "held" && (
                <>
                  <dt className="ui-meta text-ink-subtle">Why</dt>
                  <dd className="text-sm text-amber-400">
                    {sync.holdReason === "first_push_size" ? (
                      <>
                        {sync.heldOpsCount} pending change
                        {sync.heldOpsCount === 1 ? "" : "s"} exceed the first-push limit — the
                        guard against a bad restore pushing a whole database as edits. If these
                        are real changes (an import, a bulk edit), release them:
                        <br />
                        <ReleasePushButton heldOpsCount={sync.heldOpsCount ?? 0} />
                      </>
                    ) : (
                      `This device's clock differs from the hub's by about ${Math.round(Math.abs(sync.skewMs ?? 0) / 1000)}s, too far to trust which edit is newer. Fix the clock, then restart.`
                    )}
                  </dd>
                </>
              )}

              {sync.state !== "held" && sync.skewWarn && (
                <>
                  <dt className="ui-meta text-ink-subtle">Clock skew</dt>
                  <dd className="text-sm text-amber-400">
                    About {Math.round(Math.abs(sync.skewMs ?? 0) / 1000)}s off from the hub.
                    Still syncing, but worth fixing the clock.
                  </dd>
                </>
              )}

              <dt className="ui-meta text-ink-subtle">Pending</dt>
              <dd className="text-sm text-ink tabular-nums">
                {sync.pendingOps === 0
                  ? "Nothing waiting"
                  : `${sync.pendingOps} change${sync.pendingOps === 1 ? "" : "s"} not yet pushed`}
              </dd>

              <dt className="ui-meta text-ink-subtle">Last sync</dt>
              <dd className="text-sm text-ink">
                {sync.lastSyncAt ? relativeTime(sync.lastSyncAt) : "Not yet this session"}
              </dd>

              {sync.lastError && (
                <>
                  <dt className="ui-meta text-ink-subtle">Last error</dt>
                  <dd className="text-sm text-amber-400">{sync.lastError}</dd>
                </>
              )}
            </dl>
          </Card>
        </section>
      )}

      {/* ── This instance's own addresses (ADR-212) ─────────────────────── */}
      {isLocal && (
        <section className="mt-8">
          <h2 className="ui-section-label">Other devices reach this instance at</h2>
          <Card>
            {myAddresses.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No address to hand out yet. {tailscale.detail ?? "Tailscale is not installed here."}{" "}
                The easy path is Tailscale on both machines, signed into the same
                tailnet: the address then becomes{" "}
                <Mono>http://&lt;machine&gt;.&lt;your-tailnet&gt;.ts.net:3000</Mono>{" "}
                from anywhere, with nothing exposed to the internet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {myAddresses.map((a) => (
                  <li key={a.url} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <StatusDot tone={a.preferred ? "ok" : "info"} />
                    <span className="min-w-0 flex-1 basis-64">
                      <span className="block truncate font-mono text-sm text-ink">{a.url}</span>
                      <span className="ui-meta block text-ink-subtle">
                        {a.label} · {a.note}
                      </span>
                    </span>
                    <CopyAddress value={a.url} />
                  </li>
                ))}
              </ul>
            )}
            <p className="ui-meta mt-3 text-ink-subtle">
              Copy one of these into the other device&apos;s{" "}
              <strong className="font-medium text-ink-muted">Add hub</strong> field,
              along with a token from Devices below. A device that can join your
              tailnet — a phone, a laptop — needs nothing more than this, and
              nothing is exposed to the internet. Publishing this instance
              publicly is only needed for callers that <em>cannot</em> join a
              tailnet, and the one that matters is the Claude connector, because
              that request comes from Anthropic&apos;s servers rather than a
              device of yours.
            </p>
          </Card>
        </section>
      )}

      {/* ── Devices that sync from this instance (hub side) ─────────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Devices that sync from this instance</h2>
        <Card>
          <SyncedDevices initialPeers={peers} />
        </Card>
      </section>

      <p className="mt-8 text-sm text-ink-muted">
        Whether this instance is running the latest Ledgr lives on{" "}
        <Link href="/build/updates" className="hover:underline">
          Updates
        </Link>
        .
      </p>
    </div>
  );
}
