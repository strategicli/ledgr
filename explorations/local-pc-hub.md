# Exploration: local Ledgr on an always-on PC hub ("the box in the closet")

**Status:** exploration, consolidated 2026-08-15 from a Brandon + Claude working session. Not intent, not a decision. Any build touches the provider seams and the deployment story Tyler shares, so it is **core: both-agree + ADR first**.

**This doc supersedes and replaces** `local-first-split.md` (2026-06-11) and `local-p2p-sync.md` (2026-07-12), both deleted in the same commit; git history keeps them. Their essentials are folded in below ("For the record") so nothing is lost.

**Tyler:** this is written so you can read it cold and have your Claude poke holes in it. Questions, objections, and "you forgot X" all wanted. Nothing here is scheduled.

---

## The landed shape, in one paragraph

Same Next.js app, same Postgres schema, same Drizzle, on every device. Each device runs its own local Postgres, so the DB stays canonical (rule #1 intact); it just lives on your machines and replicates. Devices sync near-instantly over a Tailscale mesh (free, and the transport is bought, not built). **Brandon's always-on PC is the hub peer:** always warm, it hosts the MCP server, the phone PWA, email-in, webhooks, and crons, exposed through a Tailscale Funnel (stable public HTTPS hostname, automatic TLS, no router config). Neon is demoted to a lazy nightly backup peer costing pennies, or dropped entirely in favor of the existing weekly pg_dump + OneDrive export. Attachments move off R2 to local disk: the PC holds the full blob store, laptops hold a hot subset, OneDrive holds the independent backup copy.

A nuance worth keeping: with an always-on hub, plain **hub-and-spoke sync to the PC is sufficient**. Direct laptop-to-laptop P2P over the tailnet is a latency optimization you can add later, not a requirement. That deletes the fiddliest part of pure P2P (pairwise cursors between every peer pair) while keeping the near-instant feel, since the hub is always awake to relay.

## How we got here (the conversation arc)

1. **"Local app, keep Neon"** was assessed first: cheap as insurance (a local-auth stub + launcher is days of work), but lateral as a daily driver. It keeps the dependency that matters (Neon), is probably *slower* (your desk is farther from Neon than Vercel's functions are), and breaks every always-on surface (crons, webhooks, MCP, phone) unless something stays hosted.
2. **"Local DB, sync to Neon as hub"** fixed local speed but surfaced a tension: minimizing sync events to save Neon warmth directly makes the cloud copy stale, and the cloud copy is what the phone and MCP read.
3. **The always-on PC resolves the tension.** It is already owned, already always on (it runs scheduled Claude agent jobs today), stays warm for free, and can host every "needs a public URL" surface at once. Neon's remaining jobs (reachability, backup) shrink to "lazy backup," which is where the warmth bill goes to zero.

## The facts that changed the math

- **Neon is no longer free.** Brandon is on the lowest paid tier: small storage cost plus **~$5-6/month in CPU hours**, driven by every read and write hitting Neon and the autosuspend warmth tail. The old doc's line "going local saves independence, not dollars" is stale; there is now a real bill.
- **The always-on PC already exists.** No new hardware, no closet box to buy.
- **Blob growth is real:** 20-30GB projected fairly quickly, against R2's 10GB free ceiling, so storage was heading toward a second bill anyway.

## What we landed on (decisions-in-principle, none final)

- **Hub = the always-on PC**, not Neon, not new hardware. Tailscale mesh for sync transport; Tailscale Funnel (or Cloudflare Tunnel) for the public surface. Buy the transport, build the merge.
- **The MCP runs on the PC**, and this was stress-tested hardest because a stale or slow MCP would be a dealbreaker:
  - **Staleness: better, not worse.** The MCP reads the peer that receives near-instant sync, so Claude sees data seconds behind the keyboard. One genuinely new staleness class: edits made on an offline laptop are invisible to the MCP until it reconnects. Rare, self-healing, and a capability trade (today an offline laptop can't edit at all), but real.
  - **Speed: p50 a wash, tail much better.** The residential hop is slightly worse than Vercel's edge, but the process is always warm and local Postgres answers sub-millisecond, so today's multi-second first-call cold start (Vercel wake + Neon wake) disappears. All of it is dwarfed by Claude's own inference time.
  - **The real MCP risk is uptime, not latency.** When the box is down (power, ISP, Windows Update), the MCP is not slow, it is gone, along with the phone PWA and email-in. Mitigations: app + tunnel as auto-start services, scheduled update windows, maybe a UPS; and keep the Vercel + Neon deployment as a **lazy fallback peer** (nightly sync). If the PC dies mid-trip, flip the MCP connector URL to the cloud peer, work against data at most a day old, and it all merges when the PC returns. Degraded, not dead.
- **Phone = the PWA over the tailnet/Funnel**, pointed at the PC. Tailscale's Android app puts the phone on the mesh with zero new code, and Save Offline covers the gaps. **True local-on-Android is parked:** Next.js needs a Node server, Android doesn't run one pleasantly (Termux), and Tauri v2 is a webview + Rust shell, not a Node host, so a local Android build means rebuilding the server layer client-side. That is a second codebase in practice; defer until a native mobile story is genuinely wanted.
- **Blobs tiered:** content-addressed attachments; the PC holds everything; laptops fetch-on-open plus pinning (the "Netflix model" from the 6.14 notes); the PC's blob store syncs into OneDrive as the independent backup. Every peer is a live DB backup automatically, but blobs are only as backed up as your full-copy peers, so the OneDrive leg is not optional.
- **The sync engine (the one real build):** a per-device oplog, `(device_id, hybrid-logical-clock, table, row_id, field, new_value)`. Merge rules: field-level last-writer-wins for properties (correct essentially always for one user); bodies also LWW but the losing version lands in `revisions` (which already exists) plus a "merged while offline, check revisions" flag; relations as add/remove set ops; peers refuse to sync across mismatched migration versions until the owner upgrades them. If body conflicts ever actually hurt, upgrade bodies (only) to a text CRDT; don't start there.
- **The schema is accidentally sync-friendly**, which is most of why this is tractable: uuid PKs everywhere (no collisions), soft-delete only (deletes are just updates, tombstones solved by an existing rule), revisions (a merge never destroys anything), `updated_at` and owner-scoping everywhere. Deterministic merge rules, no model in the loop (Principle 3 holds).
- **Buy-vs-build survey (from the old doc, still accurate):** ElectricSQL and PowerSync want a central service; Evolu/Jazz/Zero want to own the data layer (fights boring-stack and Drizzle); cr-sqlite is SQLite. Nothing off the shelf does "multi-master Postgres for one user" cleanly. The merge is a few hundred deterministic lines against one schema we control, property-testable.

## Assumed but not tested

Everything below was asserted in the conversation from general knowledge, not measured. Each one is cheap to check and should be checked before an ADR.

- **The latency numbers.** "claude.ai to Vercel ~10-40ms, to a residential Funnel ~30-120ms, local Postgres sub-millisecond, Neon cold start seconds": folklore-grade estimates, not measurements from this stack.
- **That a Funnel-hosted MCP feels fine from claude.ai.** Never tried. This is the single most important untested assumption, and probe 3 settles it in an evening.
- **That Neon-as-lazy-peer actually costs pennies.** Plausible (one nightly wake), unverified against the real billing meter.
- **That the merge engine is "a few hundred lines."** An estimate until the oplog spike exists.
- **That Neon latency is even the felt pain.** Probe 1 (instrument a normal day of route timings) has never run; optimistic UI and SWR may be masking it well enough that the whole speed argument is weaker than it sounds.
- **PGlite vs. a real Postgres install per machine.** Unexamined; affects how heavy "install Ledgr on a new laptop" is.
- **Clerk auth through a Funnel hostname** for the phone PWA (allowed origins/redirects). Probably fine, unverified.
- **Windows-box uptime in practice** (how often the tunnel or app fails to come back after an update reboot).
- **HLC behavior across devices with drifting clocks.** Standard technique, untested here.

## Extra work vs. today

Today's ops story: push to a branch, merge, `release:prod`, done. Vercel and Neon do everything else. The hub model replaces that with:

| Work item | Size | Notes |
|---|---|---|
| Sync engine (oplog + merge + cursors + tests) | The real build | Days for the spike; more to production-harden |
| Local single-user auth mode | Small | The Clerk seam exists and is enforced (`verify-provider-seams.mts`); the local mode is planned but unbuilt |
| Postgres per machine (or PGlite) | Small per machine | Plus restore-from-backup on first install |
| Tailscale on every device + Funnel on the PC | An evening | Bought, not built |
| Re-point MCP, webhooks, email-in, crons at the PC | Small-medium | GitHub Actions can hit the Funnel hostname, or become local cron on the PC |
| Blob store off R2: local FS provider + tiering + OneDrive backup job | Medium | Storage provider interface already exists |
| Migration + app-version skew protocol across peers | Small but permanent | Peers refuse to sync across version mismatch; owner upgrades all devices |
| Per-machine updates forever | Recurring | `git pull && npm run build` per device, vs. push-once today |
| Uptime hardening on the PC | Small | Auto-start services, scheduled updates, optional UPS |

And the permanent cost: **sync correctness is yours forever.** Single-user makes conflicts rare, but rare merge bugs are the worst kind (silent, found weeks later). Revisions plus backups are the net; it is still a standing maintenance surface, which cuts against Principle 5.

## Multi-user someday

Brandon's read: the PC is powerful enough to serve many users before load matters, so probably nothing changes. That's right on hardware, and `owner_id`-everywhere survives untouched. The real multi-user friction is different: **every peer holds the whole database**, so a second user's data would sit on every synced laptop unless replication becomes owner-scoped (each op carries `owner_id`, so filtered sync is buildable, but it is a real design constraint to remember, not a freebie). The "multi-user-ready, not multi-user" posture is unchanged either way.

## Not yet weighed (flagged during compilation, no analysis yet)

- **Two builders, two instances.** Tyler's instance can stay pure cloud (deployment is per-instance), but the sync machinery lands in shared code and touches provider seams: core, both-agree + ADR.
- **Dev workflow.** What the dev DB and preview story look like when prod is a box in Brandon's house; what `release:prod` and "verify the deploy" even mean.
- **Security posture.** Funnel TLS + Clerk + the scoped machine tokens all carry over, but the public endpoint is now a residential machine you patch yourself.
- **App-version skew** between peers (distinct from schema skew): two peers on different builds writing ops the other doesn't expect.
- **Sunday-proof gets its strongest form ever** (the sermon sits in a local DB on the preaching laptop, app included), worth stating as a win, not just risks.

## Cheap probes, in order

1. **Measure the pain** (hours): instrument p50/p95 route timings for a normal day. Is Neon latency actually what feels slow?
2. **Localhost week** (zero new code): restore the backup into local Postgres, live on `localhost` on one machine for a week. Answers "how much faster does it feel" and "do I miss the phone mid-week."
3. **Tailscale spike** (an evening, zero code): two machines on a tailnet, one hitting the other's Ledgr; then Funnel the PC and **point a claude.ai MCP connector at the funneled endpoint**. Settles the handshake question and the MCP-feel question empirically.
4. **Oplog spike** (days, the real test): write hooks appending to a `sync_ops` table plus a small merge endpoint; sync two local DBs back and forth; try to break it with concurrent offline edits.

## What would promote this to an ADR

Probes 2-3 feel meaningfully better; or the Neon bill grows; or a free tier wobbles; or the ownership instinct ("this thing can't be taken," 6.14) hardens from a value into a need. Any of those, **plus Tyler's agreement**, turns Phase 4 from "exploratory" into a scheduled chunk with this doc as its spine.

---

## For the record: what the deleted docs held

**`local-first-split.md` (2026-06-11, parked).** Explored markdown *files* as the interface or source of truth: **A** read the OneDrive export locally, write through the API; **B** a watched inbox folder with a deterministic importer (one-way in, one-way out, DB wins, file edit lands as a revision); **C** MD files canonical on disk (rejected: reverses rule #1 and fights everything-is-an-item and boring-stack). Parked because the wins actually wanted (Claude reads everything locally, offline resilience) were already covered by the export and the PWA. ADR-037's markdown pivot later removed C's format objection, but C still reverses DB-canonical. Two things from it live on: the 6.14 insight that local-running reframes Ledgr as "the app *and* the data are user-owned," and the **"Netflix model"** of per-type, user-selectable offline caching, reused above for blob tiering. Its carried open question (how much formatting must survive hand-editing MD files) only matters if A/B ever reopen; the hub model makes them unnecessary, since local Claude gets a local DB and local MCP instead of files.

**`local-p2p-sync.md` (2026-07-12, "option D").** The spine of this doc: DB canonical but local per device, replicated, cloud demoted to one peer. Everything above about the oplog, merge rules, the sync-friendly schema, buy-vs-build, the probes, and the MCP-on-the-always-on-peer analysis originated there. What this doc changes: its preferred flavor was "keep Vercel + Neon as the always-on peer" back when the stack was $0; the paid Neon tier plus the already-owned always-on PC flip the recommendation to the PC-hub shape, with Vercel + Neon retained only as the lazy fallback peer. Its cost line ("saves independence, not dollars") is superseded by the ~$5-6/month fact.
