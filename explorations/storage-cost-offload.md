# Exploration: storage-cost offload (keep Postgres lean, push bulk to object storage)

**Status:** ACCEPTED (Tyler + Brandon — Brandon signed off per Tyler, 2026-07-15). Sequenced after the desktop foundation; ships on cloud first (solves Brandon's ceiling). Not merged to `main` without an explicit go.
**What this doc is:** a design for keeping the database under the free-tier ceiling by moving the two largest consumers (revision snapshots and large item bodies) out of Postgres and onto the object-storage seam. It is CORE (touches the schema and the body/revision contract), so nothing merges without Brandon + an ADR. Companion: `local-desktop-build.md` (they share the `StorageProvider` seam). Builds directly on the measurements in ADR-125.

## The problem, measured

Brandon hit the storage ceiling on Neon's free tier (~0.5 GB). ADR-125 already measured why, on 2026-06-27:

- The DB was **187 MB**, of which **revisions were 44 MB** (~24%), the single largest identified consumer after item bodies.
- Every item body is effectively stored **three times** in Postgres: `items.body` (jsonb, the canonical `{format, text}`), `items.body_text` (a plain-text extraction maintained on save for FTS), and the generated `items.search` tsvector.
- Body sizes are heavily skewed: median 152 chars, p99 ~96 K, a tail of ~60 notes over 100 K chars, and 3 docs over 1 M chars (Notion-imported books, a scanned magazine, syllabi; one outlier ~2.4 M). The tail dominates the body footprint.
- Binary bytes (images, audio, PDFs) already live on Cloudflare R2, not Postgres, confirmed: no base64 inlining in bodies. So files are not the DB problem.

Goal: keep users at ~$0/month. The chosen strategy is to keep Postgres holding metadata + search + small bodies, and push the bulk (revision snapshots, large bodies) onto the storage seam, which is free R2 in the cloud (10 GB) and the local filesystem in the desktop build. This fits DB-canonical (the DB still points at everything) and boring-stack (reuses the existing `StorageProvider`, no new dependency).

## The design

### 1. Revision snapshots → object storage

Today `revisions.body` holds a **whole-body jsonb copy** per snapshot, up to 50 per item (10 for bodies over 100 K, throttled by ADR-125). Whole copies, not diffs, so this is the biggest multiplier of body size and the measured 44 MB.

Proposal: store each snapshot as an object through the `StorageProvider` (key e.g. `revisions/{itemId}/{revisionId}`), and keep only metadata + a new `revisions.storage_key` in Postgres. Revisions are read rarely (the history panel, a restore), so a fetch-from-storage on demand is acceptable and fits the existing "bodies load only when opened" posture. This removes almost the entire 44 MB from Postgres.

- Cloud: snapshots go to R2. Local desktop build: they go to the filesystem provider. Same code path, the seam decides.
- The `snapshotRevision` / `restoreRevision` paths in `src/lib/item-mutations.ts` and the reads in `src/lib/items.ts` (`listRevisions`, `getRevision`) change to write/read via the seam. `listRevisions` already returns metadata only, so the history *list* is unaffected; only the by-id body read fetches from storage.

### 2. Large item bodies → object storage (threshold-based)

The tail (docs over `LARGE_BODY_THRESHOLD`, already defined as 100 K in `src/lib/body.ts`) is where the triple-copy hurts. Proposal, for large bodies only:

- Store the full markdown as an object (key e.g. `bodies/{itemId}`), keep a **capped** `body_text` in Postgres via `left(body_text, N)` (the exact lever ADR-125 named as the future FTS bound) for search + preview, plus the generated tsvector over that capped text (already bounded well under Postgres's 1 MiB tsvector cap).
- **Small bodies stay inline in Postgres.** With a median of 152 chars, offloading tiny bodies would cost an object round-trip on every open to save nothing. The threshold keeps the common case fast.

Net: Postgres holds metadata + all small bodies inline + a capped preview/tsvector for large ones + revision metadata. The 1 M+ char imported docs and all revision snapshots move to cheap storage. The DB should drop well under the ceiling and stay roughly flat as content grows, since new bulk lands in object storage.

### 3. Symmetry with the local build

Both offloads go through the one `StorageProvider` seam, so the cloud target uses R2 and the local desktop target uses the filesystem provider with no branching in the offload logic. This is why the two docs are designed together.

## Migration safety (production data, ADR-115)

Brandon's instance holds real, hard-to-reproduce data, so this is additive-only, no destructive reseed:

1. Add the new columns (`revisions.storage_key`, whatever body pointer the large-body path needs), all nullable, old columns kept.
2. Backfill: write existing large bodies and revision snapshots to storage, populate the keys.
3. Only then flip writes to stop persisting the inline copy for the offloaded cases. Keep the read path tolerant of both shapes during and after the transition (a null key means "still inline," a present key means "fetch from storage").

Failure posture: reads must degrade gracefully when storage is briefly unavailable. Editing a large body needs the storage backend up, which is acceptable because that is **not** the Sunday-proof path (the offline export copy and Save Offline PDF still exist, Principle 4). The offload touches the DB-canonical write path, not the offline fallback.

## Immediate relief for Brandon (ops, not architecture)

Independent of the offload build, to buy headroom now:

- The large-body revision throttle already shipped (ADR-125): >100 K bodies snapshot at most 10 times / 60 min instead of 50 / 5 min.
- Optionally one-time prune the revision history of the 3 giant imported docs, then `VACUUM FULL` to reclaim the pages (Postgres does not return freed space to the OS without it).
- Document these in `runbook.md` as a stopgap, distinct from the architectural offload.

## Open items

1. **Threshold and cap values.** Reuse `LARGE_BODY_THRESHOLD` (100 K) as the offload trigger, and pick `N` for `left(body_text, N)`. Larger docs than the current tail may appear; the cap is the safety valve.
2. **Read-path latency.** Confirm the on-open fetch for a large body is acceptable with optimistic UI / caching (it already only loads on open).
3. **Trashed-item cleanup on R2.** ADR-125 / the purge code flag that trashed-item R2 bytes are not fully reclaimed today (only the audio-retention path deletes R2 objects). Offloaded bodies/revisions add more R2 objects that a purge must now also delete. Fold this into the purge job as part of the offload.

## Phasing

See `roadmap.md` Phase 4 step (2), gated on the joint ADR. It can ship on the cloud target ahead of the desktop build (it directly solves Brandon's current problem), then the desktop build inherits it for free through the shared seam.
