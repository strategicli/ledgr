# Exploration: sync-node maturity (export from a local peer, plainer vocabulary, real cadences)

**Status:** exploration, raised 2026-08-25 (Brandon, brainstorm session on the two-peer rig). Not intent, not a decision. Anything here that touches the sync engine, the export contract, or ADR-206 vocabulary graduates through an ADR before it is built.

**Where it came from:** the first days of running two local peers (a prod-data hub and a dev-data hub on one machine) alongside the cloud. Four observations, then a list of maturity options worth weighing when this work is picked up.

## 1. The OneDrive export should run from a local peer

**The itch.** The cloud export runs in a 60-second Vercel lambda, capped at 30 items and 45 seconds per run (`src/lib/export/engine.ts`). Measured on 2026-08-25: the queue no longer drains. About 30 items export per night while more than 30 change per day, so `remaining` climbed from 24 to 38 in two days and `lastSuccessAt` (zero errors AND nothing remaining) stopped advancing. Nothing is failing; throughput fell behind the edit rate, which is exactly the ceiling the `ponytail:` comment in the engine predicted.

**What already exists (this is nearly config, not a build):**

- The supervisor's job runner already knows the export job and already treats it as exclusive: `crons.export` is off by default with the reason recorded in the README table ("One OneDrive folder, and `items.exported_at` is synced"). Turning it on is a config line: `"export": { "at": "04:10" }`.
- The engine already writes through an `ExportTarget` interface (`src/lib/export/target.ts`), and a `LocalExportTarget` (`local.ts`) already implements it against a plain folder. The Graph/OneDrive target is just the production binding.

**The GUI (the actual proposal).** One card, plain words, no new page. It lives on Build → Updates on a machine that could do the work (the same gating the other local sections already use), and the whole design goal is: the owner reads a sentence, clicks one button, and never learns the words "cron", "target", or "Graph".

The card, on the local machine:

> **Offline backup**
> Every night, Ledgr writes a copy of everything to your OneDrive as plain files. That copy is what you'd open if the internet were down.
>
> Runs from: **the cloud** · 38 items behind, catching up ~30 per night
>
> This machine has no time limit, so it can keep the backup fully current.
> **[ Move the nightly backup to this machine ]**

After clicking, the same card reads:

> Runs from: **this machine (BC-EDGEWOOD)** · up to date · last night: 412 items, 0 errors
> **[ Move it back to the cloud ]**

And on every *other* instance (the cloud, another peer), the card is one status line, no controls: "Offline backup runs from BC-EDGEWOOD · up to date." Nobody trips over a control that isn't theirs, and everybody can see who owns the job — which is the misconfiguration that actually hurts (two writers on one folder).

**What the button does under the hood (so "graceful" is real, not a euphemism for config editing):** ownership is a synced setting ("the scheduled work runs on device X"), stored where the peers already share settings. The local supervisor reads it and starts running the job; every other instance reads it and renders the read-only line.

**What it must NOT do, and the first draft got this backwards (Brandon, 2026-08-25).** The first version had the cloud's cron keep firing, check ownership, and quietly no-op — which sounds elegant and directly fights the point of the whole exercise. Neon autosuspends five minutes after the last query, so **the cost of a cron is the wake, not the work**: a daily job that fires only to discover it has nothing to do still spins the cloud database up, every day, forever. Worse, it leaves the cloud doing *scheduled work of its own*, which is precisely what "the cloud becomes a backup peer" (ADR-206 decision 4) is supposed to end.

So the cloud's export cron comes **out of `vercel.json` in the same slice**, and the ownership flag is what the local peers read among themselves. The honest consequence, worth stating plainly rather than designing around: **moving the job back to the cloud is then not a one-click operation** — it needs the cron restored and a deploy. That asymmetry is correct. Moving work off the cloud is the direction of travel and should be easy; moving it back is a rare recovery act (the PC died) and deserves deliberateness. For the one-off case, a "Run backup now" button on any instance covers it without a scheduled wake, because a human clicking is a wake worth paying for.

**One collapsed detail, for exactly one person.** Behind a "Details" fold on that card, a single choice with honest labels:

- **Upload to OneDrive over the internet** (default — works the same way the cloud does it today)
- **Write straight into the OneDrive folder on this PC** — fastest; the OneDrive app on this computer finishes the upload. Only makes sense on a machine that runs the OneDrive app. [folder path field]

That second option exists because the export engine already knows how to write plain files to a folder (it's how the test suite runs it); pointing it at the folder the OneDrive app watches means no tokens, no rate limits, and the backup lands on disk *and* in the cloud. It's collapsed because Brandon is likely its only user — defer-by-hiding, but findable and explained where it lives.

**Recommendation when picked up:** ship the card with just the move-ownership button first (the synced-ownership flag is the one real piece of engineering); add the folder option inside Details second. The exclusivity rule is the whole safety story, and the card's design *is* the exclusivity rule made visible.

## 1b. The real prize: every wake window the cloud stops needing

The export is one job among several, and once ownership exists as a concept it should not be export-shaped. Measured from `vercel.json` and `.github/workflows/` on 2026-08-25, a weekday wakes the cloud database in **seven distinct windows** (autosuspend is 5 minutes, so each cron is its own wake unless two share a minute):

| Time | Job | Scheduled from | Exclusive? |
| --- | --- | --- | --- |
| 06:30 | export | Vercel | yes |
| 07:00 | neon-snapshot | Actions | cloud-specific |
| 08:00 | purge | Vercel | no — every instance must run its own |
| 09:00 | relatedness | Vercel | no — per-instance cache |
| 13:00 | calendar-sync + email-import | Actions | yes (both) |
| 18:00 | calendar-sync | Actions | yes |
| 22:00 | calendar-sync + email-import | Actions | yes |

(The 13:00 and 22:00 pairing is deliberate — the runbook notes the weekday shaping exists to share wake windows. `todoist-sync` and `transcription-poll` fire often but are config-gated no-ops that return before touching the database, so they are not wakes today.)

Four of those seven windows exist only for **exclusive** jobs — the ones ADR-214 already says exactly one peer may run. Moving all of them to the always-on local machine, and deleting their cloud schedules in the same slices, leaves the cloud waking for its own housekeeping (purge, relatedness, its snapshot) plus whenever a peer syncs to it or a human opens it. That is what "the cloud is a backup peer" actually looks like in the billing, and it is a far bigger lever than the export alone.

**So build ownership once, generically.** One synced setting naming the machine that runs the scheduled work, one card that lists the movable jobs with their current owner, and one rule enforced everywhere: a job may have exactly one owner, and an instance that is not the owner does not schedule it at all (rather than scheduling it and declining). Export is simply the first job to move, because it is the one already failing.

**The honest trade to weigh before moving calendar and email:** those jobs stop happening when the PC is off. Today the cloud runs them whether or not any machine of Brandon's is awake. That is the actual argument for keeping some work in the cloud, and it is a reliability judgement, not a cost one — which is why ADR-214 made each job opt-in per peer rather than moving them wholesale. Export is the safe first move because a late backup is recoverable; a missed email import silently consumes the mailbox.

## 2. The Network page needs a user-friendliness pass, not just decluttering

ADR-209 moved sync here; ADR-210 added per-hub cadence and fallback trust; ADR-212 added the addresses section; ADR-213 added retention holds to the devices table. Each earned its place, and together they are getting dense — but density is the smaller half of the problem. The page currently explains itself in the system's vocabulary (hubs, cursors, oplog, fallback trust, retention holds), and the owner's questions are simpler than that: *is my stuff safe, is everything talking, and what do I do if not?*

When this pass happens, the ideas to explore, roughly in order:

- **Answer-first layout.** The top of the page is one plain sentence, not a status grid: "Everything is syncing normally. Last change reached your other devices 2 minutes ago." Amber and red states swap in an equally plain sentence *plus the one action that fixes it* ("The cloud copy hasn't answered since 4pm. It usually fixes itself; if this persists past an hour, check your internet or [use the backup]"). The existing pill/dot grammar stays, but as decoration on the sentence, not the message itself.
- **Task-shaped flows over settings-shaped forms.** The real tasks are countable: add a device, retire a device, check on a device, move to a new primary. Each deserves a short guided flow (the add-device flow already half-exists via the token mint); the settings grid is what's left over for the rare manual tweak.
- **Progressive disclosure per row.** Cadence, fallback trust, retention, remove — fold behind the row (the RowMenu pattern the rest of the app already uses), so a row at rest is name + one status phrase + one timestamp.
- **A plain-language pass on every string**, applying the existing house rule ("standardized, generic language in the tool's UI") to sync: "fallback trust" becomes something like "use this backup automatically / ask me first"; "retention hold" becomes "keep changes for this device while it's away"; "pull-only" becomes "receive changes but never send". The concepts are fine; the words are engineering.
- **Explain-on-first-sight.** Each section keeps one collapsible "what is this?" written for a non-technical owner (the tooltip standard, or a details fold), so the page teaches itself instead of assuming ADR knowledge.
- **Resist a second page** until a real task can't be done on one screen; splitting status from configuration is the fallback shape if one screen genuinely fails.

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
