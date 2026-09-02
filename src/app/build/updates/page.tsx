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
import YoutubeTranscripts from "@/components/updates/YoutubeTranscripts";
import JobOwnerControl from "@/components/updates/JobOwnerControl";
import RestartServiceButton from "@/components/updates/RestartServiceButton";
import {
  lastRestartLine,
  readLocalServiceReport,
  serviceLine,
} from "@/lib/local-service";
import { readStartupReport, STARTUP_UNAVAILABLE } from "@/lib/startup";
import { readJobOwners, installLabel } from "@/lib/job-owners-store";
import { getSettings } from "@/lib/settings";
import { ytDlpVersion } from "@/lib/youtube/fetch";
import { pendingVideoCount } from "@/lib/youtube/transcripts";
import { listInstalls } from "@/lib/installs";
import { duplicateLabels, installHealthLine } from "@/lib/installs-plan";
import { readLocalDeviceId } from "@/lib/sync/client";
import {
  MOVABLE_JOBS,
  MOVABLE_JOB_NAMES,
  ownerLine,
  ownershipOf,
  ownershipWarning,
} from "@/lib/job-owners";
import { databaseBytes, readSnapshotKeep, readSnapshotsEnabled } from "@/lib/snapshot-settings";
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
  const snapshotsEnabled = instance.supervisorDir ? await readSnapshotsEnabled() : false;
  const measuredBytes = averageSnapshotBytes(snapshots);
  // Only ask the database its size when there is nothing real to average, and
  // only look for pg_dump when nothing has been dumped — a snapshot on disk is
  // already proof the tools are there.
  const dbBytes =
    instance.supervisorDir && measuredBytes === null ? await databaseBytes() : null;
  const perSnapshotBytes =
    measuredBytes ?? (dbBytes === null ? null : estimateSnapshotBytes(dbBytes));
  const pgToolsMissing = Boolean(
    instance.supervisorDir && snapshots.length === 0 && !(await findPgTool("pg_dump"))
  );
  const snapshotBytes = snapshots.reduce((n, s) => n + s.bytes, 0);

  // Video transcripts. The switch is the owner's and syncs, so it is read on
  // every instance; whether yt-dlp is here is a fact about THIS machine, so it
  // is only asked on a supervised peer (a cloud deploy cannot run it at all,
  // and the card says so instead of spawning a process that will never work).
  const settings = await getSettings(owner.id);
  const ytDlp = instance.supervisorDir ? await ytDlpVersion() : null;
  const ytPending = await pendingVideoCount(owner.id);

  // Which install runs each exclusive job (exploration sync-node-maturity §1).
  // Rendered on EVERY instance, cloud included: the misconfiguration that hurts
  // is two writers on one folder, and you cannot see that from one machine if
  // only local peers show the answer.
  const jobOwners = await readJobOwners(owner.id);
  const service = await readLocalServiceReport(
    process.env.VERCEL_ENV ? null : (process.env.LEDGR_SUPERVISOR_DIR ?? null)
  );
  const selfDeviceId = await readLocalDeviceId();
  // The roster (ADR-220) is what turns the picker from "run it here" into "run
  // it on that machine over there": one row per copy, keyed by the same ids the
  // scheduler compares against.
  const roster = await listInstalls(owner.id);
  const thisMachine = roster.find((i) => i.isSelf)?.label ?? installLabel();
  const dupeLabels = duplicateLabels(roster);

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

      {/* ── The local service itself (ADR-227) ──────────────────────────── */}
      {service.available && (
        <section className="mt-8" id="local-service">
          <h2 className="ui-section-label">This machine&rsquo;s Ledgr service</h2>
          <Card>
            <p className="text-sm text-ink-muted">
              The service is what keeps Ledgr running on this machine: it holds the
              database, serves the app, and triggers the scheduled work below. It
              starts itself with the computer, so most of the time there is nothing
              to do here.
            </p>
            {(() => {
              const line = serviceLine(service);
              const last = lastRestartLine(service);
              return (
                <>
                  {line && (
                    <p className="mt-3 flex items-start gap-2 text-sm text-ink">
                      <span className="mt-1.5">
                        <StatusDot tone={service.staleCode ? "warn" : service.known ? "ok" : "info"} />
                      </span>
                      <span>{line}</span>
                    </p>
                  )}
                  {service.startedAt && (
                    <p className="ui-meta mt-1 text-ink-subtle">
                      Started {when(service.startedAt)}
                      {service.pid ? ` (process ${service.pid})` : ""}.
                    </p>
                  )}
                  {last && (
                    <p
                      className={`ui-meta mt-1 ${last.tone === "warn" ? "text-amber-400" : "text-ink-subtle"}`}
                    >
                      {last.text}
                    </p>
                  )}
                  <RestartServiceButton staleCode={service.staleCode} />
                  <p className="ui-meta mt-3 text-ink-subtle">
                    An update to Ledgr itself is applied here without a restart. A
                    restart is only needed when the update changes the service &mdash;
                    which is when this page says so, rather than leaving you to guess.
                  </p>
                </>
              );
            })()}
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
                  No jobs are scheduled here at all, which is not the normal
                  state: trash never empties and the sync log never prunes on
                  this machine. Either the local service has not written its
                  first record yet, or scheduling was switched off on this
                  machine for testing. Restarting the service restores the
                  standard set.
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
                      {job.detail && (
                        <p className="ui-meta mt-0.5 text-ink-muted">{job.detail}</p>
                      )}
                      {!job.shared && (
                        <p className="ui-meta mt-0.5 text-ink-faint">
                          Only one machine may do this one &mdash; it writes
                          somewhere shared, so it runs here only while{" "}
                          <Link href="#scheduled-work" className="underline decoration-dotted">
                            Scheduled work
                          </Link>{" "}
                          names this machine.
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
              Every job is scheduled on every machine; which one actually does
              the shared ones is <Link href="#scheduled-work" className="underline decoration-dotted">Scheduled work</Link>{" "}
              below, and it needs nothing on disk changed.{" "}
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

          {/* The roster: every copy, so the dropdowns below can name any of
              them and so "which of my copies is quiet?" is answerable here. */}
          {roster.length > 0 && (
            <details className="mt-3 rounded-card border border-line bg-surface-2 p-3">
              <summary className="ui-meta cursor-pointer text-ink-subtle">
                Your copies of Ledgr ({roster.length})
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {roster.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                    <span className="ui-row min-w-0 flex-1 text-ink">
                      {i.label}
                      {i.isSelf && (
                        <span className="ui-meta ml-2 text-ink-subtle">this one</span>
                      )}
                      {i.kind === "cloud" && (
                        <span className="ui-meta ml-2 text-ink-faint">in the cloud</span>
                      )}
                    </span>
                    <span className="ui-meta shrink-0 text-ink-subtle">
                      {installHealthLine(i, new Date())}
                    </span>
                    {i.appVersion && (
                      <span className="ui-meta shrink-0 font-mono text-ink-faint">
                        {i.appVersion.slice(0, 7)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="ui-meta mt-2 text-ink-faint">
                Each copy adds itself to this list and reports in once a day.
                Renaming one, or removing one you are done with, is on{" "}
                <Link href="/build/network#copies" className="underline decoration-dotted">
                  Network
                </Link>
                .
              </p>
            </details>
          )}

          {dupeLabels.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink">
              <span className="mt-1.5">
                <StatusDot tone="warn" />
              </span>
              <span>
                More than one copy is called{" "}
                <strong className="font-medium">{dupeLabels.join(", ")}</strong>, so the
                list below cannot tell you which machine a job is on. Rename one on{" "}
                <Link href="/build/network#copies" className="hover:underline">
                  Network
                </Link>
                .
              </span>
            </p>
          )}

          <ul className="mt-4 divide-y divide-line">
            {MOVABLE_JOB_NAMES.map((name) => {
              const def = MOVABLE_JOBS[name];
              const state = ownershipOf(jobOwners, name);
              const warning = ownershipWarning({ owners: jobOwners, job: name, now: new Date() });
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
                        installs={roster}
                        currentDeviceId={
                          state.state === "claimed" ? state.claim.deviceId : null
                        }
                        isUnset={state.state === "unset"}
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
                It reaches them on their own schedule, though, not instantly: the
                copy you are on stops right away, and the machine you chose picks
                the job up the next time it checks in. Between those two moments
                the job does not run &mdash; harmlessly for these jobs, which all
                catch up on their next run.{" "}
                <Link href="/build/network#hubs" className="underline decoration-dotted">
                  Check in now
                </Link>{" "}
                on that machine closes the gap immediately.
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

            {/* Switched on here but never scheduled: the local service has not
                restarted since this became a scheduled job (ADR-222), so the
                switch above is set and nothing is calling it. */}
            {snapshotsEnabled && !snapshotJob && (
              <p className="mt-3 flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="warn" />
                </span>
                <span>
                  Restore points are switched on, but nothing on this machine is
                  scheduled to take them yet. Restart the local Ledgr service and
                  this will start on the hour.
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
                enabled={snapshotsEnabled}
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
                {!snapshotsEnabled ? (
                  <span className="text-ink-subtle">Switched off</span>
                ) : snapshotJob?.dueAt ? (
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

      {/* ── Video transcripts: the switch, and can this machine do it ──── */}
      <section className="mt-8">
        <h2 className="ui-section-label">Video transcripts</h2>
        <Card>
          <p className="text-sm text-ink-muted">
            Save a YouTube video and a few minutes later that saved link holds
            the whole transcript, written into the item itself. You can search
            it, read it, and quote it without watching the video or typing a
            word.
          </p>

          <div className="mt-4">
            <YoutubeTranscripts enabled={settings.youtubeTranscripts.enabled} />
          </div>

          {/* Can the machine you are looking at actually do the work? Asked
              here rather than left to a log, because "I ticked the box and
              nothing happened" is the whole failure mode. */}
          {instance.supervisorDir ? (
            ytDlp ? (
              <p className="mt-4 flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="ok" />
                </span>
                <span>
                  This machine has the tools. It is using yt-dlp{" "}
                  <span className="font-mono">{ytDlp}</span>.
                </span>
              </p>
            ) : (
              <p className="mt-4 flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5">
                  <StatusDot tone="bad" />
                </span>
                <span>
                  This machine cannot do the work yet: yt-dlp, the tool that
                  fetches a video&rsquo;s captions, is not installed. Install it
                  from a terminal on this machine with{" "}
                  <Mono>py -m pip install -U yt-dlp</Mono>. Run that same command
                  again every few months: YouTube keeps changing how videos are
                  served, and an out-of-date yt-dlp quietly stops working.
                </span>
              </p>
            )
          ) : (
            <p className="mt-4 flex items-start gap-2 text-sm text-ink">
              <span className="mt-1.5">
                <StatusDot tone="bad" />
              </span>
              <span>
                You are looking at the cloud copy, which cannot do this at all.
                YouTube refuses data-center addresses, and a cloud function stops
                after sixty seconds, which any real transcription run passes.
              </span>
            </p>
          )}

          <p className="mt-3 text-sm text-ink-muted">
            Nothing is lost while you are on the cloud copy. The waiting list is
            not a queue that can drain or expire, it is simply the videos you
            have saved that have no transcript yet, so the first run on a machine
            with the tools works through them oldest first.
          </p>

          <p className="mt-3 text-sm text-ink">
            {ytPending === 0
              ? "Nothing is waiting right now."
              : `${ytPending} video${ytPending === 1 ? "" : "s"} waiting.`}
          </p>

          <p className="ui-meta mt-3 text-ink-subtle">
            This switch is yours and follows you to every copy. Which machine
            actually does the work is a separate answer, in{" "}
            <Link href="#scheduled-work" className="underline decoration-dotted">
              Scheduled work
            </Link>{" "}
            above.
          </p>
        </Card>
      </section>

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
