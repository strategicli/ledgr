# Exploration: sync-node maturity (export from a local peer, plainer vocabulary, real cadences)

**Status:** exploration, raised 2026-08-25 (Brandon, brainstorm session on the two-peer rig). Not intent, not a decision. Anything here that touches the sync engine, the export contract, or ADR-206 vocabulary graduates through an ADR before it is built.

**Where it came from:** the first days of running two local peers (a prod-data hub and a dev-data hub on one machine) alongside the cloud. Four observations, then a list of maturity options worth weighing when this work is picked up.

## 1. The OneDrive export should run from a local peer

**The itch.** The cloud export runs in a 60-second Vercel lambda, capped at 30 items and 45 seconds per run (`src/lib/export/engine.ts`). Measured on 2026-08-25: the queue no longer drains. About 30 items export per night while more than 30 change per day, so `remaining` climbed from 24 to 38 in two days and `lastSuccessAt` (zero errors AND nothing remaining) stopped advancing. Nothing is failing; throughput fell behind the edit rate, which is exactly the ceiling the `ponytail:` comment in the engine predicted.

**What already exists (this is nearly config, not a build):**

- The supervisor's job runner already knows the export job and already treats it as exclusive: `crons.export` is off by default with the reason recorded in the README table ("One OneDrive folder, and `items.exported_at` is synced"). Turning it on is a config line: `"export": { "at": "04:10" }`.
- The engine already writes through an `ExportTarget` interface (`src/lib/export/target.ts`), and a `LocalExportTarget` (`local.ts`) already implements it against a plain folder. The Graph/OneDrive target is just the production binding.

**The two shapes, smallest first:**

- **A. Local peer runs the same Graph export.** Flip `crons.export` on in the hub's `supervisor/config.json`, remove the export cron from the cloud (one `vercel.json` line). Same code, same OneDrive folder, same tokens (the Graph secrets go in `extraEnv`). The 60-second lambda ceiling disappears because the supervisor has no such ceiling, so the batch cap can be raised or removed for local runs and the backlog drains in one night. UI cost: zero. The Updates page already lists local scheduled jobs.
- **B. Local peer writes the OneDrive *folder* instead of the OneDrive *API*.** The PC already runs the OneDrive sync client. Pointing `LocalExportTarget` at the local OneDrive directory makes every export a plain file write: no Graph tokens, no rate limits, no upload sessions, and OneDrive's own client handles the cloud copy. This is also the Phase 4 story the target interface was built for. Costs: the export becomes machine-dependent (that PC must be on for files to reach the cloud), and two writers must never share the folder, same exclusivity rule as today.

**Recommendation when picked up:** A first (a config flip, reversible in an evening), B when the local hub is trusted as the always-on machine. Either way the cloud cron turns off in the same change; the exclusivity rule is the whole safety story.

**"Don't clutter the UI" is already satisfied.** This is a supervisor-config decision surfaced on the existing Updates jobs list, not a new surface. Defer-by-hiding: no new settings page. The one UI nicety worth considering: the health page could say "exports run on [machine]" so the owner remembers which instance owns the job.

## 2. The Network page is growing past glanceable (a note, not a plan)

ADR-209 moved sync here; ADR-210 added per-hub cadence and fallback trust; ADR-212 added the addresses section; ADR-213 added retention holds to the devices table. Each earned its place, and together they are getting dense. Nothing needs doing yet. When it starts to hurt, the likely shape is progressive disclosure rather than a split: the page keeps three glanceable strips (state pill, hub rows, device rows) and everything per-row (cadence, fallback, retention, remove) folds behind the row the way RowMenu already works elsewhere. Resist a second page until a real task can't be done on one screen.

## 3. Hub/spoke may be one layer of vocabulary too many

**Brandon's instinct:** "Really, it's just sync nodes and we determine which pushes and pulls to what."

**What the code says:** the instinct is nearly already true. `role` in the supervisor config is documented as "informational: it changes no behavior on its own." What actually distinguishes peers is three per-node or per-link facts:

- **Reachability:** does this node have a URL others can reach (published, always-on)?
- **Initiative:** who dials? The initiating side runs the sync loop; the listening side just answers `/api/machine/sync`. This asymmetry is real and worth keeping (it is what makes NAT and sleep a non-problem: the node behind the laptop lid always dials out).
- **Per-link posture:** cadence, fallback trust, pull-only mode, retention hold. All already per-hub (ADR-210/213).

So the simplification is mostly words, not wire: keep the initiator/listener protocol exactly as is, and let "hub" dissolve into "a peer that others point at." The Network page already speaks this language ("it can sync TO hubs, and other devices can sync FROM it"); the remaining hub/spoke vocabulary lives in docs, the wizard's role question, and ADR-206 prose. Renaming is cheap in UI copy, expensive in docs, and the docs can drift toward "peer" naturally as they are touched. One honest counterpoint before dropping the words entirely: "hub" compresses a real bundle (published + always-on + runs the exclusive jobs + others point at it), and a name for that bundle keeps the wizard's first question answerable by a non-technical owner. Candidate resolution: the wizard asks "will other devices sync from this machine?" instead of "hub or spoke?", and the word hub survives only as a label the UI derives, never a mode the owner sets.

## 4. Real cadence options (continuous/daily is too coarse)

`HubCadence` is a two-value enum today ("continuous" | "daily", `src/lib/sync/client.ts`). Brandon wants the ordinary ladder: continuous, 1 min, 5 min, 15 min, hourly, daily, weekly.

**Shape that fits the existing code:** store an interval, not an enum. `cadenceIntervalMs()` already reduces the enum to a number; let the config carry `{ everyMinutes: N }` with the presets as UI sugar, parse-tolerant so stored "continuous"/"daily" read as their equivalents (same tolerant-additive pattern as ADR-210's hub fields). The GUI stays a dropdown of presets; no cron expressions (the supervisor's job config already made that call and says why).

**The two interactions that make this more than a dropdown:**

- **Retention.** A weekly hub pins the oplog for a week (ADR-213 measured ~8.3 KB per op; ~25 MB/month per parked peer). The cadence picker should surface the consequence: choosing weekly on a device warns what it holds, and `grace_days` should default sensibly from cadence rather than requiring separate tuning.
- **Staleness.** A cursor older than `sync:prunedThrough` is refused with 410 (ADR-208). Long cadences raise the odds. The refusal is the safety working as designed, but the picker should keep the owner out of the trap: refuse or warn on any cadence longer than the effective retention window.

**Also worth deciding then:** anchored vs relative. "Daily" today means "24h after the last exchange," which drifts. An anchored form ("daily at 03:00", like the supervisor's `{ at: "HH:MM" }` jobs) is what people expect from the word; the interval form is what "every 15 minutes" expects. Supporting `{ everyMinutes }` OR `{ at }` per hub mirrors the jobs config exactly, one grammar across both systems.

## Other maturity options to weigh (the brainstorm answer)

Ordered roughly by value-for-effort as of today:

1. **A per-hub "Sync now" button.** The single most-wanted control on any sync UI, and it makes long cadences livable (weekly hub + one click before a trip). Cheap: the loop already knows how to exchange with one hub.
2. **Job-ownership legibility.** The exclusive-jobs table (ADR-214) is the quiet contract that prevents double-export and mailbox races. Surface it: each instance's Updates page already lists its own jobs; a small "nobody runs export" / "two peers claim export" detection would catch the misconfiguration that hurts. (The `exported_at`-is-synced fact makes double-export corrupting, not just wasteful.)
3. **Local snapshot + restore drill.** The supervisor already has `snapshot` (hourly pg_dump to local disk, off by default). A documented quarterly restore drill ("prove the dump restores") is the difference between having backups and believing in them. Pairs with #1 in a "this machine owns the data safety" story.
4. **Staleness alerting on the owner's terms.** The weekly cloud health check exists; a local analog ("push me if any peer hasn't synced in N x its cadence") turns the quiet-hold problem into a notification instead of a page to remember to visit.
5. **Conflict visibility.** LWW merges are deterministic and silent by design; the "merged offline, check revisions" flag exists in the model but has no surface. A small "recent merges" list (item, when, which device lost) closes the loop without changing semantics.
6. **Attachment strategy for peers.** Blobs are R2-only through cutover (ADR-206 decision 8). When that reopens (the "Netflix model"), cadence and retention thinking from #4 above applies to blobs too; keep one vocabulary.
7. **Per-peer boot registration.** Already queued in next_steps: `STARTUP_TASK_NAME` is one constant, so one machine can boot-start only one peer. Small, and it unblocks the "two peers, one machine" rig from being fully hands-off.
8. **Wizard question rewrite** (from §3): replace "hub or spoke?" with "will other devices sync from this machine?" and derive the rest.

## What this doc deliberately does not propose

- No second sync protocol, no P2P mesh changes, no CRDTs. The initiator/listener shape and LWW merge semantics are locked (ADR-206) and nothing here strains them.
- No new settings surface for the export move (§1); config plus the existing jobs list is the whole UI.
- No immediate rename ("hub" stays in code identifiers; only owner-facing copy drifts toward "peer").
