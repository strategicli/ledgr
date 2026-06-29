# Exploration: Notification Center

**Status:** RESOLVED → ADR-129 (2026-06-28). Brandon answered the open-Qs; **Tyler agreed**. Building.
**Raised:** 2026-06-28 (Brandon).
**Classification:** **CORE** (touches `schema.md`: a new table). Both-agree satisfied (Tyler acked 2026-06-28).

## The ask

A place where all notifications live, read and unread. Mark read / unread,
archive, etc. **One row per event** (Brandon, 2026-06-28): if three tasks
notify at once, that is three entries, each with its own state and its own
deep-link. No rolled-up digest at the row level.

## What exists today (the reusable half)

Web Push is already built (ADR-034, slice 30): hand-rolled VAPID JWT + RFC 8291
encryption over `node:crypto`, a service-worker v3 `push`/`notificationclick`
handler that navigates to the message `url`, and a `push_subscriptions` table
(one row per enabled browser, self-healing on 404/410). Two deterministic
senders fire today: the morning agenda (daily) and meeting-prep-ready (hourly),
both via `/api/machine/notify-*` cron endpoints and `src/lib/push/notify.ts`.

The gap is that delivery is **fire-and-forget**: once a push goes out it
evaporates. No history, no read/unread state, no archive, no in-app surface.
So the *transport* is done; what is missing is **persistence + a UI to manage
it**. The notification center is that persistence layer plus its surface.

## Storage decision (Brandon, 2026-06-28): dedicated table, not items

Considered "everything is an item" (Principle 2): a `notification` item type,
one item per event, reusing ViewRenderer / list surfaces / multi-select /
soft-delete + revisions / item MCP tools for free. **Rejected** because:
- read/unread does not map onto the `status_category` enum
  (not_started / in_progress / done / archived) without abuse;
- notifications are high-churn system ephemera that *point at* items, not
  content, so they would pollute the `items` table, FTS tsvector, search, and
  Discover/relatedness (the same reasoning that kept `item_relatedness` off
  `items.properties` in ADR-127).

Chosen: a narrow dedicated table. The Principle-2 bend is justified the same
way `revisions` and `item_relatedness` are: derived/system machinery, not user
content.

## Proposed schema (`notifications`, migration 0037)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id`; owner-scope every query |
| `kind` | text | enum-ish: `task_due`, `agenda`, `meeting_prep`, `sync_error`, `email_in`, `calendar_soon`, … |
| `title` | text | render line |
| `body` | text null | optional secondary line (NOT the `{format,text}` item body; plain text) |
| `url` | text null | in-app deep link (mirrors `PushMessage.url`) |
| `related_item_id` | uuid null | FK `items.id`, cascade with item purge; the source task/meeting |
| `state` | text | `unread` \| `read` \| `archived` (default `unread`) |
| `read_at` | timestamptz null | |
| `archived_at` | timestamptz null | |
| `created_at` | timestamptz | |

Indexes: `(owner_id, state, created_at desc)` for the list + unread badge count;
`(related_item_id)` for cascade/lookup.

`state` as one text column with timestamps (rather than three booleans) keeps the
lifecycle linear and the badge query a single `where state = 'unread'`.

## Write path

A small `recordNotification(...)` helper writes a row, called from the same
places that already (or could) push. Phase 1 wires it into the two existing
senders so every agenda / prep push also lands a row. The push send and the row
write are independent: a user with push disabled still accumulates a history;
a push that fails to deliver still has its row.

**Scope of sources is an open question** (see below). Start with the two that
exist; the table is source-agnostic so adding `sync_error` / `email_in` /
`task_due` later is just more callers, no schema change.

## UI surface

- **`/notifications` Work page** (server page + client list leaf): filter tabs
  Unread / All / Archived; each row = icon (by `kind`) + title + body + relative
  time, click → `url`. Per-row actions: mark read/unread, archive.
- **Multi-select** per ADR-118: wrap in `SelectionProvider`, `SelectModeToggle`,
  `SelectCheckbox` per row, `BulkActionBar` offering Mark read / Mark unread /
  Archive. "Mark all read" is the common case (a header button is fine too).
- **Bell + unread badge in Work nav.** Add a built-in destination in
  `src/lib/nav-slot-options.ts` (`href: "/notifications", icon: "bell",
  badgeEligible: true`) alongside Inbox, which is the only `badgeEligible`
  destination today, so the count-badge plumbing already exists and is reused.
  Distinct from Inbox: Inbox is triage of inbound *content*; notifications are
  read/dismiss of *events*. They coexist.

## MCP parity (later)

The Ledgr MCP server (ADR-047) has no notification tools. A later slice could
add `list_notifications` / `mark_read` / `archive_notification` for parity, but
v1 of the center does not need them.

## Resolved answers (Brandon, 2026-06-28)

1. **Source scope.** The three areas as laid out: task-due, calendar-soon, and
   sync/health errors (on top of the two existing pushes, agenda + prep).
   **Each source must be individually on/off-toggleable** by the owner. So a
   per-source preference store is part of the build, not a later add. Lives in
   `users.settings` (the navSlots/favorites/listTabs posture, no schema):
   `settings.notificationPrefs = { task_due: true, calendar_soon: true,
   sync_error: true, agenda: true, meeting_prep: true }` (default all on).
   `recordNotification` checks the pref for its `kind` and no-ops if off (so the
   toggle gates both the row AND the push, one switch).
2. **Retention.** 30-day auto-purge of archived rows (matches Trash). A daily
   cron sweep `delete from notifications where state='archived' and
   archived_at < now() - interval '30 days'`.
3. **Push ↔ row coupling.** Yes: write a row for every (enabled) event even when
   push delivery is off. History is independent of delivery; the only gate is
   the per-source on/off toggle from (1).
4. **Badge scope.** **PWA app-icon badge wanted ASAP** (in v1, not deferred).
   Use the Badging API: `navigator.setAppBadge(unread)` /
   `navigator.clearAppBadge()`. Set it from the service-worker `push` handler
   (increment) and from the client on read/archive actions and on load
   (authoritative count from an unread-count endpoint). Platform note: app-icon
   badging works on **installed** PWAs (desktop Chromium, Android, iOS 16.4+ for
   installed web apps); the in-app bell badge is the universal fallback. Ship
   both.

## Phasing

1. **Persistence + center + prefs + both badges:** `notifications` table
   (migration 0037), `recordNotification` (pref-gated), per-source toggle UI in
   User Settings, wire the two existing senders, `/notifications` page with
   Unread/All/Archived filters + per-row read/unread/archive + multi-select bulk
   bar, bell + unread badge in Work nav, **and the PWA app-icon badge** (SW
   increment + client authoritative set). `verify-notifications.mts`.
2. **The three new sources** as pref-gated callers: task-due, calendar-soon,
   sync/health errors.
3. **30-day archived purge** cron + MCP tools (`list_notifications`,
   `mark_read`, `archive_notification`).
