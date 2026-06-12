# schema.md: Ledgr Data Model

The concrete data model. This is what Claude Code implements against in Drizzle. It restates PRD §3 in implementable form; when this and the PRD disagree, the PRD's intent wins and this file should be corrected. Phase tags note when each piece ships, but the structural pieces (`items`, `types`, `relations`, `properties`) all land in Phase 1 even where the UI for them comes later.

## Design rules that shape the schema

- **Everything is an item.** Tasks, meetings, notes, links, entities, and user-defined types are all rows in `items`.
- **Owner-scoped.** Every item carries `owner_id`; every query filters on it. One user in v1, but the column and the discipline ship day one.
- **Hot fields are columns; everything custom is JSONB.** Queried fields (`status`, `due_date`, etc.) are real columns. User-defined fields live in `properties` (GIN-indexed).
- **Containment vs association are different.** Containment (subtask, project tree) uses the self-referential `parent_id`. Association (tags, references) uses the `relations` edge table.

---

## `users`
Real table, one row in v1. Exists so `owner_id` foreign keys are honest and multi-user is a non-event later.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `clerk_id` | text | maps to Clerk identity |
| `email` | text | |
| `created_at` | timestamptz | |

---

## `types` (Phase 1 table, builder UI Phase 3)
Extensible type registry. `items.type` is a FK to `types.key`. Five system rows seed it; user types are just more rows (Gmail system-vs-user-label pattern).

| Field | Type | Notes |
|---|---|---|
| `key` | text PK | stable key: `task`, `meeting`, `note`, `link`, `entity`, then user keys |
| `label` | text | display name |
| `icon` | text | |
| `is_system` | boolean | true for the five built-ins; code keys bespoke behavior off system keys |
| `property_schema` | jsonb | property definitions for this type (Phase 3 builder writes this) |
| `default_view_id` | uuid | FK to `views.id`, nullable |
| `created_at` | timestamptz | |

Seed rows (Phase 1): `task`, `meeting`, `note`, `link`, `entity`, all `is_system = true`.

---

## `items` (the one big table)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id`. **Filter every query on this.** |
| `type` | text | FK `types.key` |
| `title` | text | the "one-liner"; may be the entire content |
| `body` | jsonb | BlockNote document (canonical JSON); null until "gone deeper". **Never selected in list queries.** |
| `body_text` | text | plain-text extraction of `body`, maintained by app code on save; feeds the generated FTS column (ADR-003). Never selected in list queries. |
| `status` | enum | `open` \| `done` \| `archived`; non-task types default `open` |
| `due_date` | timestamptz | nullable |
| `urgency` | enum | `low` \| `normal` \| `high` \| `critical`; nullable |
| `meeting_at` | timestamptz | meetings only |
| `url` | text | links only; original web address |
| `kind` | text | entities only: `person` \| `org` \| `project` \| `topic` \| `campus` |
| `todoist_id` | text | nullable; set when synced to Todoist |
| `ms_event_id` | text | nullable; set when created from a calendar event (dedupe key) |
| `parent_id` | uuid | nullable; self-FK to `items.id` (containment, §hierarchy) |
| `properties` | jsonb | nullable; user-defined custom fields; GIN-indexed |
| `deleted_at` | timestamptz | nullable; soft-delete marker (Trash; purge after 30 days) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Notes:
- `kind` is a real column (decided at build, ADR-003): a hot filterable field, plain text rather than an enum so new kinds need no migration. The PRD describes it as "a `kind` field on entity items."
- Entities are items with `type = 'entity'`. They have bodies, so "Roger" can hold notes about Roger.

### Hierarchy (parent/child)
- Single parent: an item has at most one `parent_id` (its container).
- Projects are emergent: a task with children renders as a mini-project with a progress rollup (percent of children done), computed deterministically. No separate project table.
- Guard against cycles (an item can't become its own ancestor).
- Fetch trees with `WITH RECURSIVE`.
- Soft-deleting a parent cascades `deleted_at` to children so the unit restores together.

---

## `relations` (the unified tag + link system)
A single generic page-to-page edge table. Tags are edges to entity items; item-to-item references use the same table.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_id` | uuid | FK `items.id`; edge start |
| `target_id` | uuid | FK `items.id`; edge end (often an entity, but any item is valid) |
| `role` | text | default `'related'`; optional label: `tagged`, `attendee`, `references`, ... |
| `match_state` | enum | `confirmed` \| `suggested`; default `confirmed` |
| | | **unique (`source_id`, `target_id`, `role`)** |

- `match_state = 'suggested'` is provisional (fuzzy/auto matches). It renders dotted/grayed and is **excluded from trusted queries** until confirmed. Manual and wizard-confirmed links are `confirmed`.
- Backlinks query both directions: `WHERE source_id = :me OR target_id = :me`.
- Example (Roger's open tasks): `SELECT i.* FROM items i JOIN relations r ON r.source_id = i.id WHERE r.target_id = :roger AND i.type = 'task' AND i.status = 'open' AND r.match_state = 'confirmed' AND i.deleted_at IS NULL`.

---

## `attachments`
Metadata only. Bytes live in R2 (presigned URLs; bytes never proxy through the app server). OneDrive export holds a backup copy.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id`; per-user quota (~10GB) |
| `parent_item_id` | uuid | FK `items.id` |
| `filename` | text | |
| `content_type` | text | |
| `size_bytes` | bigint | |
| `storage_key` | text | R2 object key (behind the storage-provider interface) |
| `created_at` | timestamptz | |

---

## `revisions` (Phase 1)
Body snapshots for restore. Debounced on save; cap ~50 per item with a prune step.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid | FK `items.id` |
| `body` | jsonb | snapshot of BlockNote JSON |
| `created_at` | timestamptz | |

---

## `views` (Phase 1 system seeds; full builder Phase 2)
Every view is a stored View Definition. Built-in views (Today, Inbox, per-type lists) ship as `system`-flagged rows that Brandon can tweak or clone. Same engine powers embedded query views (§4.9) and, in Phase 2, dashboard widgets (PRD §4.11): a widget is a view rendered as a card.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id` |
| `name` | text | |
| `is_system` | boolean | built-in seed vs user-built |
| `filter` | jsonb | types, entities, status, date horizon, custom-property conditions |
| `sort` | jsonb | |
| `grouping` | jsonb | |
| `layout` | enum | `list` \| `table` \| `board` \| `calendar` \| `agenda` (gallery/Gantt parked) |
| `date_property` | text | for time-based layouts: which date drives placement |
| `created_at` | timestamptz | |

---

## `matchers` (Phase 2; calendar event → template/entity)
Ordered, user-built rules (no seeded list). Editable without redeploy. Populated via setup wizard and learn-by-confirmation.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | |
| `priority` | int | evaluation order |
| `condition` | jsonb | one of: attendee-email, calendar series id, title regex, title fuzzy (`pg_trgm` `similarity()` fallback) |
| `action` | jsonb | apply named template, attach default entities/tags, set default urgency |
| `created_at` | timestamptz | |

Condition priority order: attendee email → series id → title regex → fuzzy title (last resort, only when no attendee/series match).

---

## `error_log` (Phase 1; or use a free Sentry tier)
No silent failures. Failed crons/webhooks captured here and surfaced through `/health` and the UI.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `correlation_id` | text | ties to structured logs |
| `source` | text | which job/route |
| `message` | text | human-readable |
| `detail` | jsonb | verbose context (shown when debug mode on) |
| `created_at` | timestamptz | |

---

## Property kinds (for `types.property_schema` and `items.properties`)
A core set covers nearly everything: `text`, `number`, `date`, `select`, `multi-select`, `checkbox`, `url`, `relation` (relation reuses the `relations` edge table). Formulas and rollups are out of scope (parking lot), except the deterministic subtask progress rollup.

---

## Index plan
- B-tree: `items.type`, `items.owner_id`, `items.status`, `items.due_date`, `items.parent_id`.
- `relations.source_id` and `relations.target_id` indexed **separately** so both-direction backlink queries use bitmap index scans.
- GIN on `items.properties`.
- FTS: a `GENERATED ALWAYS AS ... STORED` `tsvector` column on `items` over `title + body_text`, GIN-indexed. Not computed per query. (`body_text` is app-maintained; generating from raw BlockNote JSONB would index structural noise, ADR-003.)
- Composite indexes as query patterns prove them out; log additions in `decisions.md`.

## Phase 2+ structures, noted ahead (don't build in Phase 1)
- **Dashboard widgets (PRD §4.11):** a widget references a `views` row plus per-widget config (item count N, position, badge on/off). Likely a small `widgets` table (owner_id, view_id, position, item_count, show_badge) or a JSONB layout doc per user; decide at Phase 2 and log it.
- **Navigation slots (PRD §4.12):** 4-5 ordered slots per user (target view/type/item, badge source). Small enough to be a JSONB config on `users` or a tiny `nav_slots` table; decide at Phase 2.
- **Meeting AI (PRD §4.15):** needs no new tables. Audio is an `attachments` row; transcript/summary are sections in the meeting `body`; suggested tasks are task items related to the meeting with `match_state = 'suggested'`.

## Known schema-adjacent gaps (track, don't block)
- **Custom property values aren't full-text searched.** FTS covers title + body; `properties` is filterable via GIN but not necessarily searchable. Minor; flagged.
- **Embedded query-view blocks have no faithful markdown form.** They export as a static snapshot/placeholder, not a live view (fine for the pulpit fallback since sermons are prose).
- ~~Entity `kind` placement~~ resolved: column on `items` (ADR-003).
