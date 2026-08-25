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
import { getUpdateReport } from "@/lib/updates";
import UpdateButton from "@/components/updates/UpdateButton";
import StartupToggle from "@/components/updates/StartupToggle";
import SnapshotKeep from "@/components/updates/SnapshotKeep";
import SnapshotNowButton from "@/components/updates/SnapshotNowButton";
import JobOwnerControl from "@/components/updates/JobOwnerControl";
import { readStartupReport, STARTUP_UNAVAILABLE } from "@/lib/startup";
import { readJobOwners, installLabel } from "@/lib/job-owners-store";
import { readLocalDeviceId } from "@/lib/sync/client";
import {
  MOVABLE_JOBS,
  MOVABLE_JOB_NAMES,
  ownerLine,
  ownershipOf,
  ownershipWarning,
} from "@/lib/job-owners";
import { databaseBytes, readSnapshotKeep } from "@/lib/snapshot-settings";
import { estimateSnapshotBytes, humanBytes } from "@/lib/snapshots-plan";
import {
  averageSnapshotBytes,
  findPgTool,
  listSnapshots,
  PG_TOOLS_MISSING,
  snapshotsDir,
} from "@/lib/snapshots";
import {
  jobCadence,
  readLocalJobsReport,
  worstJobState,
  LOCAL_JOBS_UNAVAILABLE,
  type LocalJobState,
} from "@/lib/local-jobs";

export const dynamic = "force-dynamic";

function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "info" }) {
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "bad"
          ? "bg-rose-500"
          : "bg-neutral-500";
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

// The three read-only bits of vocabulary the jobs list needs. Local to this
// page on purpose: nothing else renders a job row yet.
function jobTone(state: LocalJobState): "ok" | "warn" | "bad" | "info" {
  return state === "ok" ? "ok" : state === "failing" ? "bad" : state === "late" ? "warn" : "info";
}

function jobLine(state: LocalJobState): string {
  switch (state) {
    case "ok":
      return "Running.";
    case "failing":
      return "The last run failed.";
    case "late":
      return "Overdue — it has not succeeded in a while.";
    default:
      return "Scheduled, not run yet.";
  }
}

/** Coarse relative time, both directions. Good enough for a daily job. */
function when(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "at an unknown time";
  const mins = Math.round(Math.abs(ms) / 60_000);
  const span =
    mins < 1 ? "less than a minute" : mins < 90 ? `${mins} min` : mins < 60 * 36 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return ms < 0 ? `${span} ago` : `in ${span}`;
}

/** A due time already past is "due now", never "next 40 seconds ago". */
function nextRunLine(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  return Number.isFinite(ms) && ms <= 0 ? "Due now." : `Next ${when(iso)}.`;
}

export default async function Updates() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { instance, code, schema, canApply, blockedReason } = await getUpdateReport();

  // The same reader the client island polls through /api/startup, so the first
  // paint and every refresh can never disagree about it.
  const startup = await readStartupReport(instance.supervisorDir).catch(
    () => STARTUP_UNAVAILABLE
  );

  // Scheduled jobs on this machine (ADR-214). Only a supervised peer has any:
  // a cloud deploy's scheduler is Vercel cron plus GitHub Actions.
  const localJobs = await readLocalJobsReport(instance.supervisorDir).catch(
    () => LOCAL_JOBS_UNAVAILABLE
  );
  const worstJob = worstJobState(localJobs.jobs);

  // Snapshots (restore points) on this machine. A cloud deployment has no disk
  // and no local cluster to dump, so the whole section renders only on a peer
  // with a supervisor — the same test every other local-only surface uses.
  const snapshots = instance.supervisorDir
    ? listSnapshots(snapshotsDir(instance.supervisorDir))
    : [];
  const snapshotJob = localJobs.jobs.find((j) => j.name === "snapshot") ?? null;
  const snapshotKeep = instance.supervisorDir ? await readSnapshotKeep() : 0;
  const measuredBytes = averageSnapshotBytes(snapshots);
  // Only ask the database its size when there is nothing real to average, and
  // only look for pg_dump when nothing has been dumped — a snapshot on disk is
  // already proof the tools are there.
  const dbBytes =
    instance.supervisorDir && measuredBytes === null ? await databaseBytes() : null;
  const perSnapshotBytes =
    measuredBytes ?? (dbBytes === null ? null : estimateSnapshotBytes(dbBytes));
  const pgToolsMissing = Boolean(
    instance.supervisorDir && snapshots.length === 0 && !findPgTool("pg_dump")
  );
  const snapshotBytes = snapshots.reduce((n, s) => n + s.bytes, 0);

  // Which install runs each exclusive job (exploration sync-node-maturity §1).
  // Rendered on EVERY instance, cloud included: the misconfiguration that hurts
  // is two writers on one folder, and you cannot see that from one machine if
  // only local peers show the answer.
  const jobOwners = await readJobOwners(owner.id);
  const selfDeviceId = await readLocalDeviceId();
  const thisMachine = installLabel();

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

      {/* ── This device: does it come back after a reboot? (ADR-211) ───── */}
      {startup.available && (
        <section className="mt-8">
          <h2 className="ui-section-label">Start with the computer</h2>
          <Card>
            <p className="text-sm text-ink-muted">
              Ledgr runs on this machine as a local service. Unless it starts on
              its own, a reboot leaves it down until someone starts it by hand —
              and anything pointed at it (your phone, Claude, your other devices)
              stays down with it.
            </p>
            <div className="mt-3">
              <StartupToggle initial={startup} />
            </div>
            <p className="ui-meta mt-3 text-ink-subtle">
              From a terminal on this machine: <Mono>npm run local:status</Mono>{" "}
              answers &ldquo;is it running?&rdquo;, <Mono>npm run local:stop</Mono>{" "}
              stops it cleanly, and <Mono>npm run local:startup</Mono> shows or
              changes this same setting.
            </p>
          </Card>
        </section>
      )}

      {/* ── Scheduled jobs on this machine (ADR-214) ───────────────────── */}
      {localJobs.available && (
        <section className="mt-8">
          <h2 className="ui-section-label">Scheduled jobs on this machine</h2>
          <Card>
            <p className="text-sm text-ink-muted">
              A cloud deployment gets its scheduled work from outside: the
              platform&rsquo;s own timer plus a few workflow runners. This machine
              has neither, so the local service triggers the same jobs itself.
            </p>
            {localJobs.jobs.length === 0 ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
                <span className="mt-1.5">
                  <StatusDot tone="warn" />
                </span>
                <span>
                  No jobs are scheduled here. Trash never empties and the sync
                  log never prunes on this machine until at least{" "}
                  <Mono>purge</Mono> is on &mdash; see{" "}
                  <Mono>crons</Mono> in <Mono>supervisor/config.json</Mono>.
                </span>
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {localJobs.jobs.map((job) => (
                  <li key={job.name} className="flex items-start gap-2 py-2">
                    <span className="mt-1.5">
                      <StatusDot tone={jobTone(job.state)} />
                    </span>
                    <div className="min-w-0">
                      <p className="ui-row text-ink">
                        {job.label}{" "}
                        <span className="ui-meta text-ink-subtle">
                          &middot; {jobCadence(job)}
                        </span>
                      </p>
                      <p className="ui-meta mt-0.5 text-ink-subtle">
                        {jobLine(job.state)}
                        {job.lastOkAt
                          ? ` Last success ${when(job.lastOkAt)}.`
                          : " No successful run recorded yet."}
                        {job.dueAt ? ` ${nextRunLine(job.dueAt)}` : ""}
                      </p>
                      {job.ok === false && job.detail && (
                        <p className="ui-meta mt-0.5 text-ink-muted">{job.detail}</p>
                      )}
                      {!job.shared && (
                        <p className="ui-meta mt-0.5 text-ink-faint">
                          Only one device should run this one &mdash; it writes
                          somewhere shared.
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {worstJob && worstJob !== "ok" && (
              <p className="ui-meta mt-3 text-ink-muted">
                A failure is also written to this instance&rsquo;s error log, so it
                counts on the health report rather than passing quietly.
              </p>
            )}
            <p className="ui-meta mt-3 text-ink-subtle">
              Which jobs run, and how often, is the <Mono>crons</Mono> block in{" "}
              <Mono>supervisor/config.json</Mono>.{" "}
              <Mono>npm run local:status</Mono> shows this same list from a
              terminal.
            </p>
          </Card>
        </section>
      )}

      {/* ── Scheduled work: which machine runs each shared job ──────────── */}
      <section className="mt-8" id="scheduled-work">
        <h2 className="ui-section-label">Scheduled work</h2>
        <Card>
          <p className="text-sm text-ink-muted">
            Some jobs write somewhere shared &mdash; one OneDrive folder, one
            mailbox, one Todoist account &mdash; so exactly one of your machines
            may do each of them. This is where you say which. Everything here is
            visible from every device, because two machines doing the same job is
            the mistake worth catching.
          </p>
          <p className="ui-meta mt-2 text-ink-subtle">
            This machine is <span className="text-ink">{thisMachine}</span>.
          </p>

          <ul className="mt-4 divide-y divide-line">
            {MOVABLE_JOB_NAMES.map((name) => {
              const def = MOVABLE_JOBS[name];
              const state = ownershipOf(jobOwners, name);
              const warning = ownershipWarning({ owners: jobOwners, job: name, now: new Date() });
              const isOwner = state.state === "claimed" && state.claim.deviceId === selfDeviceId;
              return (
                <li key={name} className="py-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5">
                      <StatusDot tone={warning ? "warn" : state.state === "claimed" ? "ok" : "info"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="ui-row text-ink">
                        {def.label}{" "}
                        <span className="ui-meta text-ink-subtle">
                          &middot; {ownerLine({ owners: jobOwners, job: name, selfDeviceId })}
                        </span>
                      </p>
                      <p className="ui-meta mt-0.5 text-ink-subtle">{def.what}</p>
                      {warning && <p className="ui-meta mt-1 text-amber-400">{warning.text}</p>}
                      {state.state === "claimed" && state.claim.lastRunAt && (
                        <p className="ui-meta mt-0.5 text-ink-faint">
                          Last ran {when(state.claim.lastRunAt)}.
                        </p>
                      )}
                      <JobOwnerControl
                        job={name}
                        jobLabel={def.label}
                        consequence={def.consequence}
                        isOwner={isOwner}
                        claimed={state.state !== "unset"}
                        blocked={def.movable ? undefined : def.blocked}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <details className="mt-4 rounded-card border border-line bg-surface-2 p-3">
            <summary className="ui-meta cursor-pointer text-ink-subtle">
              What happens when I move one?
            </summary>
            <div className="mt-2 space-y-2 text-sm text-ink-muted">
              <p>
                The choice is stored with your data, so it reaches your other
                devices the same way a note does, and each one checks it before it
                starts work. There is only ever one answer, so two machines cannot
                both think the job is theirs.
              </p>
              <p>
                If the machine holding a job is switched off, the job simply does
                not happen, and this page says so rather than looking fine. You can
                hand it back from any device, including this one.
              </p>
              <p>
                The offline backup is the one worth moving. In the cloud it has to
                finish inside a one-minute limit, so it copies about 30 items a
                night; on your own machine there is no limit and it clears the whole
                queue in one pass.
              </p>
            </div>
          </details>
        </Card>
      </section>

      {/* ── Snapshots: point-in-time recovery on this machine ──────────── */}
      {instance.supervisorDir && (
        <section className="mt-8">
          <h2 className="ui-section-label">Snapshots</h2>
          <Card>
            <p className="text-sm text-ink-muted">
              A snapshot is a complete copy of this machine&rsquo;s database at one
              moment. Keeping a spread of them means a mistake bigger than one
              item&rsquo;s history &mdash; a bad import, a batch delete, a wrong bulk
              edit &mdash; can be answered by looking at how things were an hour
              ago, rather than waiting for the weekly backup.
            </p>

            {!snapshotJob && (
              <p className="mt-3 flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="warn" />
                </span>
                <span>
                  Snapshots are not running on this machine. Add{" "}
                  <Mono>&quot;snapshot&quot;: true</Mono> to the <Mono>crons</Mono>{" "}
                  block in <Mono>supervisor/config.json</Mono> and restart the
                  local service.
                </span>
              </p>
            )}

            {pgToolsMissing && (
              <p className="mt-3 flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="bad" />
                </span>
                <span>{PG_TOOLS_MISSING}</span>
              </p>
            )}

            <div className="mt-4">
              <SnapshotKeep
                keep={snapshotKeep}
                perSnapshotBytes={perSnapshotBytes}
                measured={measuredBytes !== null}
              />
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr]">
              <dt className="ui-meta text-ink-subtle">On disk now</dt>
              <dd className="text-sm text-ink">
                {snapshots.length === 0 ? (
                  <span className="text-ink-subtle">None yet</span>
                ) : (
                  <>
                    {snapshots.length} restore point
                    {snapshots.length === 1 ? "" : "s"}, {humanBytes(snapshotBytes)}
                    {/* "oldest" says nothing when it is also the newest. */}
                    {snapshots.length > 1 &&
                      `, oldest ${when(snapshots[snapshots.length - 1].at)}`}
                  </>
                )}
              </dd>

              <dt className="ui-meta text-ink-subtle">Last snapshot</dt>
              <dd className="text-sm text-ink">
                {snapshots.length > 0 ? (
                  when(snapshots[0].at)
                ) : (
                  <span className="text-ink-subtle">Never</span>
                )}
                {snapshotJob?.ok === false && snapshotJob.detail && (
                  <span className="ui-meta ml-2 text-amber-400">
                    Last attempt failed: {snapshotJob.detail}
                  </span>
                )}
              </dd>

              <dt className="ui-meta text-ink-subtle">Next snapshot</dt>
              <dd className="text-sm text-ink">
                {snapshotJob?.dueAt ? (
                  nextRunLine(snapshotJob.dueAt)
                ) : (
                  <span className="text-ink-subtle">Not scheduled</span>
                )}
              </dd>
            </dl>

            <SnapshotNowButton disabled={pgToolsMissing} />

            {snapshots.length > 0 && (
              <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto border-y border-line">
                {snapshots.map((s) => (
                  <li key={s.name} className="flex items-baseline gap-3 py-1.5">
                    <span className="ui-row min-w-0 flex-1 text-ink">
                      {new Date(s.at).toLocaleString()}
                    </span>
                    <span className="ui-meta shrink-0 text-ink-subtle">{when(s.at)}</span>
                    <span className="ui-meta shrink-0 tabular-nums text-ink-subtle">
                      {humanBytes(s.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="ui-meta mt-3 text-ink-subtle">
              Opening one is read-only, and deliberately never replaces the live
              database: from a terminal on this machine,{" "}
              <Mono>npm run local:snapshot -- browse &lt;time&gt;</Mono> starts a
              throwaway copy on a spare port so you can look through it and copy
              what you need back out.{" "}
              <Mono>npm run local:snapshot -- list</Mono> names them.
            </p>
          </Card>
        </section>
      )}

      {/* ── Sync surfaces moved to Build → Network (ADR-209) ───────────── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Sync</h2>
        <Card>
          <p className="text-sm text-ink-muted">
            The sync topology — the hubs this instance syncs to and the devices
            that sync from it — moved to its own page:{" "}
            <Link href="/build/network" className="text-ink hover:underline">
              Network
            </Link>
            .
          </p>
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
