# Exploration: local-primary Ledgr with P2P sync ("option D")

**Status:** exploration, raised 2026-07-12. Not intent, not a decision.
**Sibling doc:** `local-first-split.md` parked options A/B/C (markdown files as interface or source of truth). This is a different fork that doc never considered, so it gets its own page. If pursued, it needs a both-agree ADR (it touches the provider seams and the deployment story Tyler shares).

## The idea as raised

Am I gaining much by having Ledgr be a remote web app versus local software that syncs across my devices? File-sync tools (OneDrive, Dropbox, Syncthing) have always been sub-optimal: slow, glitchy, conflict-prone, and they fight the app for the file mid-write. But what if Ledgr itself became an installable local web app (Windows/Mac first, mobile later) with a peer-to-peer connection between installs (some handshake or token to unite them) and its own purpose-built sync logic? Offline just works, sync happens whenever it happens. Known costs as raised: the sync logic itself, the security/handshake layer, mobile, and shareable links breaking. Suspected wins: speed, and no hosting bills (Vercel, Neon).

## How this differs from `local-first-split.md`

Options A-C were about markdown *files*: read locally, inbox-import, or files-canonical (C reversed rule #1). Option D keeps the data model and rule #1 fully intact: **the DB stays canonical, it just lives on your machines and replicates**. Same Next.js app, same Postgres schema, same Drizzle. This is a deployment and replication change, not a data-model change. Everything-is-an-item survives untouched; in fact it's what makes the sync tractable.

## The honest ledger: what the cloud buys today

- **Always-on reachability.** Graph webhooks and email-in, GitHub Actions hitting cron endpoints, the remote MCP server for claude.ai and phone Claude, shareable links, and the mobile PWA all need a URL that's up when the laptop is closed.
- **Zero-sync multi-device.** Phone and desktop hit the same DB; there is no sync problem because there is only one copy.
- **Zero ops.** Backups, uptime, and patching are someone else's job (plus our weekly backup).
- **Money: nothing.** The stack is already ~$0/month on free tiers. Going local saves *independence* (free-tier rug pulls, the 6.14 "this thing can't be taken" instinct), not dollars. Don't over-weight the cost argument.

## Why purpose-built sync can win where file sync loses

Every pain named (slow, glitchy, conflicts, the sync layer fighting the app) is a consequence of one design fact: file-sync tools move **opaque blobs at file granularity, with no knowledge of the app writing them**. They can't tell a save from a temp file, a conflict from a rename, or one changed field from a rewritten document. Application-level replication removes each pain structurally rather than heuristically:

- **Granularity.** Sync moves row/field-level changes, not whole files. A title edit is one tiny op, not a re-upload.
- **No mid-write races.** The sync layer *is* the app; writes and replication share one code path and one transaction boundary. There is no external process grabbing a half-written file.
- **Single-user collapses the conflict space.** One human is at one keyboard at a time. Real conflicts only occur when the same item is edited on two devices while offline, which for one person is rare and detectable.
- **The schema is already sync-friendly, almost by accident:**
  - every PK is a **uuid** (no serial-collision problem in multi-master),
  - **soft-delete only** means deletes are just updates, so the classic distributed-deletes/tombstones problem is already solved by an existing rule,
  - the **revisions** table means a merge never destroys anything: the losing body of a conflict is preserved automatically,
  - `updated_at` and owner-scoping are everywhere.
- **Deterministic by default (Principle 3) holds.** Merge rules are plain code with no model in the loop.

So yes: it's doable, and the reason it beats OneDrive-class sync isn't cleverness, it's that we'd be solving a radically smaller problem (one schema, one user, structured rows) than general file sync solves.

## Sketch of the machinery

**1. Packaging (smallest problem).** Next.js runs locally today (runbook local-run procedure), and the pooler guard already exempts local Postgres. Options, in increasing polish: a launcher script plus a Postgres install; a Tauri or Electron wrapper for a real installable-app feel (system tray, auto-start); or PGlite (Postgres in WASM) to avoid a Postgres install entirely. Provider seams cover the rest: auth falls back to local single-user mode (the Clerk seam is real, `verify-provider-seams.mts` enforces it), scheduler becomes local cron hitting the same endpoints, storage points at local disk.

**2. Transport and the "token handshake" (don't build this).** Exactly the software you suspected exists, exists:
- **Tailscale**: a WireGuard mesh, free for personal use. The handshake is "sign both devices into your tailnet"; every device then reaches every other over an encrypted private network, through NAT, with zero app code. Sync then rides plain HTTPS between peers.
- **iroh**: an embeddable P2P library (dial by node id, hole punching, relay fallback), the current favorite of the local-first ecosystem, if we ever want the connection *inside* the app instead of beside it.
- Recommendation: Tailscale first. It converts the entire security/discovery/NAT problem from code into five minutes of setup, and it's swappable later.

**3. Sync logic (the real build, and the part to own).** A per-device **oplog**: every write also appends `(device_id, hybrid-logical-clock, table, row_id, field, new_value)`. When peers connect, they exchange "what do you have since my last cursor" and apply the missing ops. Merge rules:
- **Non-body fields:** field-level last-writer-wins by HLC. For a single user this is correct essentially always, and wrong in only boring ways.
- **Bodies:** also LWW, but the losing version already lands in `revisions` (snapshot-on-save exists today), and the item gets a "merged while offline, check revisions" flag. If real body conflicts ever hurt, upgrade bodies (only) to a text CRDT (Loro/Yjs). Don't start there.
- **Relations:** add/remove ops with set semantics; soft-delete covers removal.
- **Attachments:** keep R2 as the shared blob store in v1 of this (littlest step); content-addressed blob sync between peers later.
- **Schema migrations:** peers refuse to sync across mismatched migration versions; the owner upgrades devices, then sync resumes. Manageable precisely because it's one owner.

**4. Buy vs build, surveyed.** ElectricSQL and PowerSync sync Postgres to clients but want a central service; Evolu/Jazz/Zero are frameworks that want to own the data layer (fights boring-stack and Drizzle); cr-sqlite embeds CRDTs but in SQLite. Honest read: nothing off the shelf does "multi-master Postgres for one user, P2P" cleanly. But the split is favorable: **buy the transport** (Tailscale/iroh, the genuinely hard part), **build the merge** (a few hundred deterministic lines against one schema we control, testable with property tests).

## The shape that probably wins: cloud demoted from landlord to peer

Pure-local kills shareable links, the remote MCP, email-in/Graph webhooks, and mobile. But nothing says every peer is a laptop. Keep **one always-on peer, and let the existing Vercel + Neon deployment be it** (same code; it's just the peer that happens to be reachable from the internet). Then:

- the phone keeps working (PWA hits the cloud peer), shareable links keep resolving, email-in, webhooks, crons, and MCP all keep working;
- desktop work is local-fast and offline-proof, and syncs whenever it syncs;
- Sunday-proof reaches its strongest form ever: the sermon sits in a local DB on the preaching laptop, app and all;
- cost stays ~$0, and *fully* leaving Vercel/Neon later becomes a config decision (drop that peer) instead of a cliff.

This reframes the whole idea: not "leave the cloud," but "make the cloud one replica among several." Almost everything on the loss list evaporates, and the mobile problem defers itself until a native/local mobile story is genuinely wanted.

## Two flavors of the always-on peer (and the MCP question)

The always-on peer doesn't have to be the cloud. There are two flavors, not mutually exclusive:

- **Cloud peer (Vercel + Neon).** Zero hardware, zero ops, ~$0, but keeps the free-tier ceilings (R2 10GB, Neon compute/row limits) and the "someone else can pull it" dependency.
- **Self-hosted peer (an old laptop in the closet, always on, on a tunnel).** No storage limit, no compute limit, no cloud dependency, reuses hardware you own. The cost is that uptime, reachability, and the box not dying become yours. This is the genuinely attractive "no limits" case raised.

**The MCP runs on whichever peer is always-on** — it is a thin layer over the same app + DB (CLAUDE.md: "Claude via a thin MCP server"; machine/MCP calls already use scoped API tokens, separate from Clerk). So a self-hosted closet box answers *every* "needs a public URL" loss at once: MCP for claude.ai and phone Claude, the phone PWA, shareable links, and email-in/Graph webhooks. It's not a separate REST API to build; it's "run Ledgr on that box and expose it."

**Would MCP get slower?** Almost certainly not perceptibly, and the DB half likely gets faster. The latency of an MCP tool call has three parts: (1) network hop from claude.ai's datacenter to the server, (2) app/function warm-up, (3) the DB query. Today: hop to a Vercel edge (~10–40ms), but a **cold start tax** on the first call of a session — Vercel function wake plus Neon scale-to-zero wake — that can be hundreds of ms to multiple seconds. Self-hosted: hop to a residential IP over a tunnel (~30–120ms, a bit higher and payloads are tiny so bandwidth is irrelevant), but the process is **always warm** and local Postgres answers sub-millisecond with **no cold start**. Net: the network hop is slightly worse, the DB and warm-up are meaningfully better, and the cold-start tail disappears. Crucially, **all of it is dwarfed by Claude's own inference time** (seconds per response), so a 50ms vs 100ms round-trip difference is invisible in practice. You are not "losing speed on the AI/MCP end."

**Reachability is the real work, and it's bought, not built.** A residential box needs a stable public HTTPS endpoint despite dynamic IPs and no port-forwarding. **Tailscale Funnel** (or a Cloudflare Tunnel) exposes one local service to the public internet over HTTPS with a stable hostname and automatic TLS, no router config. That's the same Tailscale from the transport section doing double duty: private mesh for peer sync, Funnel for the public MCP/PWA/webhook surface. The existing scoped-token auth on `/api/machine` is what keeps that public surface safe.

The honest tradeoff: the closet box converts recurring free-tier ceilings and cloud dependence into a one-time ops burden (uptime, a tunnel, backups, aging hardware). Every other peer is itself a live backup and the OneDrive export stays as the independent copy, so a dead closet laptop is an inconvenience, not a data-loss event.

## How much faster would it feel?

Neon's free tier scales to zero, so the first query of a session can pay a cold start (hundreds of ms to seconds), then every query pays pooler round-trip, plus Vercel function cold starts on top. Local Postgres answers in sub-millisecond; navigation stops being masked-fast (optimistic UI, SWR) and becomes actually-fast. Biggest felt wins: first open of the day, search, large list views, and everything on bad wifi. But measure before believing: a day of instrumented p50/p95 route timings is the cheap experiment that says whether latency is even the felt problem.

## What genuinely breaks or gets hard

- **Mobile** (named in the raise): no local story yet. The hybrid answers it via the cloud peer; a true local mobile app is a separate, large project.
- **Sync correctness:** the merge is small but distributed-systems-fiddly to test. Mitigations: single user, deterministic rules, revisions as the safety net, property-based tests.
- **Two builders:** this changes the deployment story Tyler shares. Core-frozen territory: both-agree + ADR before any build. (This doc is the free part.)
- **Ops move in-house:** each device's disk is now your problem, though every peer is itself a backup and the OneDrive export stays as the independent copy.

## Cheap probes, in order

1. **Measure the pain** (hours): instrument route timings for a normal day. Is cloud latency actually what feels slow?
2. **Local-run week** (zero new code): restore the backup into local Postgres and live on `localhost` for a week on one machine. Answers "how much faster does it *feel*" and "do I miss the phone mid-week."
3. **Tailscale spike** (an evening, zero code): two machines on a tailnet, one hitting the other's local Ledgr. Answers the handshake/security question empirically.
4. **Oplog spike** (the real test, days): write hooks appending to a `sync_ops` table plus a ~200-line merge endpoint; sync two local DBs back and forth, then try to break it with concurrent offline edits.

## What would promote this to an ADR

Probe 2 shows a big felt difference; or a free tier wobbles or changes terms; or the ownership instinct hardens from a value into a need. Any of those, plus Tyler's agreement, turns Phase 4 from "exploratory" into a scheduled chunk with this doc as its spine.
