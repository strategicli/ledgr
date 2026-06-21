# module-savor-sync.md — Savor Integration

**Status:** Planned — Phase N (after core entities and MCP hub are stable)
**Dependency:** Savor must expose a `/api/ledgr/entries` endpoint (see Savor-side work below)
**Direction:** Read-only. Ledgr consumes from Savor; it never writes back.

---

## What Savor is

Savor is a personal Scripture meditation and journaling webapp (savor.vercel.app or equivalent). It is Tyler's daily devotional surface — the place where reading happens, where journal entries are written, and where study books are managed. It is **not** being replaced or absorbed; it stays the write surface. Ledgr's role is to pull structured data from Savor so that Claude can reason across Tyler's entire life — including his devotional history — from a single MCP hub.

The Savor data model (as of Phase 2) is:

- `books` — a study (expositional/partial/series/topical/theological)
- `study_days` — a single day of a study, with optional author notes
- `passage_items` — the passage(s) for a day (one row per passage, ordered by `ord`)
- `sessions` — one completed journal entry per study day; `content` is markdown
- `user_prefs` — translation preference (NKJV default)

The key insight for Ledgr's intake shape: **one `session` = one journal entry**, tied to one `study_day`, which has one or more `passage_items`. The passage reference is not stored in the session content — it lives on `passage_items` and must be joined at the API layer.

---

## Savor-side work (what Savor needs to expose)

Add a single read-only API route to Savor:

```
GET /api/ledgr/entries
Authorization: Bearer <LEDGR_SYNC_TOKEN>
```

Query params:
- `since` — ISO timestamp; returns only entries with `sessions.end_time > since` (for incremental sync)
- `limit` — default 50, max 200

Response shape (JSON):

```ts
{
  entries: SavorEntry[];
  next_cursor?: string; // ISO timestamp of last entry returned
}

type SavorEntry = {
  session_id: string;
  study_day_id: string;
  book_id: string;
  book_name: string;
  book_kind: "expositional" | "partial" | "series" | "topical" | "theological";
  ended_at: string; // ISO UTC
  duration_seconds: number;
  content: string; // markdown — the journal body
  passages: {
    book_slug: string;       // e.g. "2-timothy"
    chapter: number;
    verses: string;          // e.g. "1-7" or "12-4:1"
    reference: string;       // e.g. "2 Timothy 1:1–7"
    ord: number;
  }[];
  notes_thoughts?: string;       // author notes markdown (may be null)
  notes_application?: string;
  notes_prayer?: string;
};
```

Auth: a single long-lived bearer token stored in both apps as env vars (`LEDGR_SYNC_TOKEN` in Savor, same value in Ledgr as `SAVOR_API_TOKEN`). Not OAuth — this is a personal integration between two apps you own.

**Analytics roll-up note:** Savor computes per-Bible-book stats by joining through `passage_items.book_slug`, never `books.slug`. The API response mirrors this — `passages[].book_slug` is the authoritative field, not anything on the book level.

---

## Ledgr data model

### `journal_entries` table

```sql
journal_entries (
  id            uuid primary key default gen_random_uuid(),
  savor_session_id  text unique not null,   -- Savor's session.id; deduplication key
  savor_day_id      text not null,
  savor_book_id     text not null,
  book_name         text not null,
  book_kind         text not null,          -- expositional|partial|series|topical|theological
  journaled_at      timestamptz not null,   -- sessions.end_time
  duration_seconds  integer,
  content           text,                   -- markdown body; may be null for very old entries
  synced_at         timestamptz not null default now()
)
```

### `journal_passages` table

```sql
journal_passages (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references journal_entries(id) on delete cascade,
  book_slug         text not null,          -- e.g. "2-timothy"
  chapter           integer not null,
  verses            text not null,          -- e.g. "1-7"
  reference         text not null,          -- e.g. "2 Timothy 1:1–7"
  ord               integer not null default 0
)
```

Index: `journal_passages(book_slug)` — enables "have I journaled on 2 Timothy" as a simple index scan.

### Why separate from `notes`?

A `JournalEntry` is not a generic note. It has a required `journaled_at` date, a required passage relation, a duration, a Savor-side source ID for deduplication, and it came from a specific external system. Folding it into notes would mean hanging all of those as arbitrary properties — exactly the pattern this architecture is designed to avoid. It also makes MCP queries significantly cleaner (see below).

---

## Sync mechanism

### Sync job

A background sync job runs on a schedule (Vercel Cron or equivalent):

```
POST /api/sync/savor
Authorization: internal cron secret
```

Logic:
1. Read `last_synced_at` from a `sync_state` record (keyed `"savor"`).
2. Call `GET savor.vercel.app/api/ledgr/entries?since=<last_synced_at>`.
3. For each entry in the response:
   - Check if `savor_session_id` already exists in `journal_entries` (upsert on conflict).
   - Insert/update `journal_entries` row.
   - Delete existing `journal_passages` for that entry and re-insert from response (handles rare passage corrections on the Savor side).
4. Update `last_synced_at` to the `next_cursor` from the response (or `now()` if no cursor).
5. Return `{ synced: N, skipped: M }`.

First run (no `last_synced_at`): fetch all entries with no `since` param, paginate to completion.

### Sync cadence

Daily is sufficient for a devotional app. If Tyler wants near-real-time, a webhook from Savor (`POST /api/sync/savor/webhook` triggered on session completion) is additive and doesn't change the data model.

---

## MCP tools

These are the queries the Savor sync enables from Claude:

```
get_journal_entries(limit, before, after, book_slug?)
  → returns journal entries, optionally filtered by passage or date range

get_passage_history(book_slug, chapter?)
  → "have I journaled on 2 Timothy?" — returns all entries for that book/chapter

get_recent_devotional_themes(days?)
  → last N days of entry content + passage refs, for "what have I been meditating on"

get_bible_book_stats()
  → per-book totals: session count, days journaled, total duration
  → mirrors Savor's per-book-stats.ts but sourced from Ledgr's synced data
```

These give Claude answers to questions like:
- "What passages have I spent the most time in this year?"
- "Have I journaled on the atonement anywhere?"
- "What have I been reading in my devotions lately?"
- "How long have I spent in 2 Timothy total?"

---

## What this module does NOT do

- It does not render or display Savor journal entries in any detail view (Savor is the read surface).
- It does not write back to Savor.
- It does not sync study books, catalog books, or user preferences — only completed sessions.
- It does not replicate Savor's author notes into Ledgr UI — they are available in the raw content for MCP queries but not surfaced in Ledgr views.
- It does not replace Savor. The devotional experience stays in Savor.

---

## Open questions

- **Webhook vs. cron:** Does Tyler want near-real-time sync (requires a webhook endpoint in Savor) or is daily cron sufficient? Start with cron; add webhook later if needed.
- **Content privacy in MCP:** Journal entries are among the most personal data in the system. Should the MCP tools return full `content` text by default, or summarize? Lean toward full content since this is a single-user system, but worth a deliberate decision.
- **Relation to Discipleship module:** If a journal entry references a person (e.g. a prayer for someone), should Ledgr eventually link `journal_entries` to `people`? Not in v1 — that's a future enrichment pass, likely Claude-assisted.
