// Updates (Build → MAINTAIN): is this instance running the latest Ledgr, and is
// its database in step with the code it's running?
//
// Two axes, because they fail independently and for different people:
//
//   • CODE — a satellite instance deploys from a fork, so a change someone
//     pushes upstream sits there until the fork is synced. The Update button is
//     that sync, so the person using the instance can take an update without
//     needing a terminal, a GitHub account, or a builder on call.
//   • SCHEMA — there is no migrate-on-deploy, so a push carrying a migration
//     reaches every instance's CODE while each database stays put. That one
//     catches source instances too (the deploy follows main automatically, the
//     database does not), which is the failure COLLAB.md keeps re-learning.
//
// Everything is read server-side; the only client island is the button.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { relativeTime } from "@/lib/relative-time";
import { gatherSyncStatus, type FullSyncStatus } from "@/lib/sync/client";
import { listPeers, type PeerSummary } from "@/lib/sync/peers";
import { getUpdateReport } from "@/lib/updates";
import SyncedDevices from "@/components/updates/SyncedDevices";
import UpdateButton from "@/components/updates/UpdateButton";

export const dynamic = "force-dynamic";

function StatusDot({ tone }: { tone: "ok" | "warn" | "info" }) {
  const color =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-neutral-500";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-card border border-line bg-surface-1 p-4">{children}</div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">
      {children}
    </code>
  );
}

export default async function Updates() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { instance, code, schema, canApply, blockedReason } = await getUpdateReport();

  // Sync surfaces (ADR-206 phase 3). gatherSyncStatus is {enabled: false} with
  // zero queries when this instance isn't a spoke; the peers list renders on
  // every instance (any instance CAN be a hub) but fails quiet if the sync
  // tables aren't migrated in yet.
  let sync: FullSyncStatus = { enabled: false };
  try {
    sync = await gatherSyncStatus();
  } catch {
    // An unreadable cursor must not take the page down; the pill/API surface it.
  }
  let peers: PeerSummary[] = [];
  try {
    peers = await listPeers();
  } catch {
    // Same posture: a database without the sync tables just shows the empty state.
  }

  const commitUrl =
    instance.sha && instance.deployRepo
      ? `https://github.com/${instance.deployRepo}/commit/${instance.sha}`
      : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="ui-title">Updates</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Ledgr is one shared codebase running as separate instances, one per
        person. This page tells you whether yours is running the latest version,
        and whether its database has caught up with the version it is running.
      </p>

      {/* ── This version ─────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">This instance</h2>
        <Card>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr]">
            <dt className="ui-meta text-ink-subtle">Version</dt>
            <dd className="text-sm text-ink">
              {instance.shortSha ? (
                commitUrl ? (
                  <a
                    href={commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono hover:underline"
                  >
                    {instance.shortSha}
                  </a>
                ) : (
                  <span className="font-mono">{instance.shortSha}</span>
                )
              ) : (
                <span className="text-ink-subtle">
                  Unknown (this looks like local development)
                </span>
              )}
            </dd>

            <dt className="ui-meta text-ink-subtle">Deploys from</dt>
            <dd className="text-sm text-ink">
              {instance.deployRepo ? (
                <a
                  href={`https://github.com/${instance.deployRepo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {instance.deployRepo}
                </a>
              ) : (
                <span className="text-ink-subtle">Not connected to a repository</span>
              )}
              {instance.isSatellite && (
                <span className="ui-meta ml-2 text-ink-subtle">
                  (a copy of {instance.upstreamRepo})
                </span>
              )}
            </dd>

            <dt className="ui-meta text-ink-subtle">Migrations</dt>
            <dd className="text-sm text-ink tabular-nums">{schema.total}</dd>
          </dl>
        </Card>
      </section>

      {/* ── Code ─────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Ledgr version</h2>
        <Card>
          {code.state === "source" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="ok" />
              </span>
              <span>
                This instance deploys straight from the shared repository, so it
                picks up every change automatically. There is nothing to pull
                here.
              </span>
            </p>
          )}

          {code.state === "not_configured" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="info" />
              </span>
              <span>
                Not connected to GitHub, so this instance cannot tell whether a
                newer version exists. Set <Mono>GITHUB_TOKEN</Mono> to turn this
                on (runbook §1g).
              </span>
            </p>
          )}

          {code.state === "unknown" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="info" />
              </span>
              <span>
                Could not check for updates. {code.detail}
              </span>
            </p>
          )}

          {code.state === "current" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="ok" />
              </span>
              <span>Up to date. You are running the latest version of Ledgr.</span>
            </p>
          )}

          {code.state === "behind" && (
            <div>
              <p className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="warn" />
                </span>
                <span>
                  <strong className="font-medium">
                    {code.count} update{code.count === 1 ? "" : "s"} available.
                  </strong>{" "}
                  <span className="text-ink-muted">
                    {code.truncated
                      ? "Showing the most recent changes."
                      : "Here is what changed since your version."}
                  </span>
                </span>
              </p>

              <ul className="mt-3 divide-y divide-line border-y border-line">
                {code.commits.slice(0, 20).map((c) => (
                  <li key={c.sha} className="flex gap-3 py-2">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ui-meta shrink-0 font-mono text-ink-subtle hover:underline"
                    >
                      {c.shortSha}
                    </a>
                    <span className="ui-row min-w-0 flex-1 text-ink">{c.subject}</span>
                    <span className="ui-meta shrink-0 text-ink-subtle">{c.authorName}</span>
                  </li>
                ))}
              </ul>

              {code.touchesSchema && (
                <p className="mt-3 text-sm text-amber-400">
                  This update changes the database structure, so the database has
                  to be migrated as part of applying it.
                </p>
              )}

              <div className="mt-4">
                {canApply ? (
                  <UpdateButton count={code.count} />
                ) : (
                  <p className="text-sm text-ink-muted">
                    {blockedReason ?? "Updating is not available on this instance."}{" "}
                    {instance.isSatellite && instance.selfUpdate === "off" && (
                      <>
                        Ask whoever set this up to run the update, or turn on{" "}
                        <Mono>LEDGR_SELF_UPDATE</Mono> to allow it from here.
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ── Schema ───────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Database</h2>
        <Card>
          {schema.state === "current" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="ok" />
              </span>
              <span>
                In step with the code. All {schema.total} database changes have
                been applied.
              </span>
            </p>
          )}

          {schema.state === "pending" && (
            <div>
              <p className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="warn" />
                </span>
                <span>
                  <strong className="font-medium">
                    {schema.pending.length} database change
                    {schema.pending.length === 1 ? "" : "s"} not yet applied.
                  </strong>{" "}
                  <span className="text-ink-muted">
                    This instance is running code that expects a newer database
                    than it has, which is the usual cause of pages failing right
                    after an update.
                  </span>
                </span>
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {schema.pending.map((tag) => (
                  <li key={tag}>
                    <Mono>{tag}</Mono>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-muted">
                Fix it by running <Mono>npm run db:migrate</Mono> against this
                instance&apos;s database.
              </p>
            </div>
          )}

          {schema.state === "empty" && (
            <p className="flex items-start gap-2 text-sm text-ink">
              <span className="mt-1.5">
                <StatusDot tone="warn" />
              </span>
              <span>
                This database has never been set up. Run{" "}
                <Mono>npm run instance:new</Mono> against it before using this
                instance.
              </span>
            </p>
          )}

          {schema.state === "unknown" && (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <span className="mt-1.5">
                <StatusDot tone="info" />
              </span>
              <span>Could not read the database migration state. {schema.detail}</span>
            </p>
          )}
        </Card>
      </section>

      {/* ── Sync (spoke side; only when this instance syncs to a hub) ──── */}
      {sync.enabled && (
        <section className="mt-8">
          <h2 className="ui-section-label">Sync</h2>
          <Card>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr]">
              <dt className="ui-meta text-ink-subtle">State</dt>
              <dd className="flex items-center gap-2 text-sm text-ink">
                <StatusDot
                  tone={
                    sync.state === "synced" && sync.activeHubIndex === 0
                      ? "ok"
                      : sync.state === "offline"
                        ? "warn"
                        : "info"
                  }
                />
                {sync.state === "synced"
                  ? "Synced"
                  : sync.state === "pending"
                    ? "Changes waiting to sync"
                    : "Offline (no hub reachable)"}
              </dd>

              <dt className="ui-meta text-ink-subtle">Hub</dt>
              <dd className="text-sm text-ink">
                {sync.activeHubIndex === 0
                  ? "Primary"
                  : `Backup (hub ${sync.activeHubIndex + 1} of ${sync.hubCount})`}
                {sync.hubCount > 1 && sync.activeHubIndex === 0 && (
                  <span className="ui-meta ml-2 text-ink-subtle">
                    ({sync.hubCount - 1} backup configured)
                  </span>
                )}
              </dd>

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

      {/* ── Synced devices (hub side; any instance can be a hub) ────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Synced devices</h2>
        <Card>
          <SyncedDevices initialPeers={peers} />
        </Card>
      </section>

      <p className="mt-8 text-sm text-ink-muted">
        Looking for what actually changed in each release? The{" "}
        <Link href="/changelog" className="hover:underline">
          Changelog
        </Link>{" "}
        has the full history.
      </p>
    </div>
  );
}
