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

## `types` (Phase 1 table, builder UI Phase 3 — built slice 33, ADR-044)
Extensible type registry. `items.type` is a FK to `types.key`. Five system rows seed it; user types are just more rows (Gmail system-vs-user-label pattern). **Not owner-scoped** (no `owner_id`): types are an instance-global registry (one user per deploy). The Build surface CRUD is in `src/lib/types.ts`, guarded by `requireOwner`. The DB owns label/icon/`property_schema`/enumeration; the **module registry** (`src/lib/modules.ts`, ADR-043) owns a type's *code behavior* (canvas/format/exporters) — a user type isn't registered, so it falls back to the default markdown canvas + markdown format.

| Field | Type | Notes |
|---|---|---|
| `key` | text PK | stable key: `task`, `meeting`, `note`, `link`, `person`, then user keys. **Immutable** (PK + FK target; the builder never lets it change). Slug-shaped: `^[a-z][a-z0-9_]*$` |
| `label` | text | display name |
| `icon` | text | optional icon name |
| `is_system` | boolean | true for the five built-ins; code keys bespoke behavior off system keys. System types are extendable in the builder but never deletable |
| `property_schema` | jsonb | the type's custom fields as an **ordered `PropertyDef[]`**: `{key, label, kind, options?}` (slice 33 builder writes this; per-item values live in `items.properties`). See "Property kinds" below |
| `show_in_quick_capture` | boolean | not null, default true (migration 0008). Whether the type appears in the quick-capture dropdown (data-driven + opt-in, PRD §4.4 / exploration type-and-kind-ux §2) |
| `default_view_id` | uuid | FK to `views.id`, nullable |
| `created_at` | timestamptz | |

Seed rows (Phase 1): `task`, `meeting`, `note`, `link`, `person`, all `is_system = true`. Deleting a user type is blocked while any item references it (the FK, plus a counted pre-check in the store).

> **`person` replaced `entity` (ADR-055).** The former `entity` meta-type — a single type subdivided by a `kind` column into person/org/project/topic/campus — was retired once the Build surface let any type carry its own properties and relate freely. `person` is now just a bespoke system type like the others (calendar attendee matching points at it); org/project/topic/campus are no longer built in (create them as types if needed). The `items.kind` column was dropped with it.

---

## `items` (the one big table)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id`. **Filter every query on this.** |
| `type` | text | FK `types.key` |
| `title` | text | the "one-liner"; may be the entire content |
| `body` | jsonb | Canonical body as `{format, text}` — `format: "markdown"` (default; extended dialect, PRD §4.1) or a markdown-family format like `chordpro` per type; `text` is the markdown source of truth. Null until "gone deeper". **Never selected in list queries.** *(Markdown-canonical since ADR-037; was BlockNote JSON through v0.17.)* |
| `body_text` | text | plain-text extraction of `body.text`, maintained by app code on save; feeds the generated FTS column (ADR-003). With markdown canonical this is a near-identity strip of markdown syntax, not a JSON walk. Never selected in list queries. |
| `status` | enum | `open` \| `done` \| `archived`; non-task types default `open` |
| `due_date` | timestamptz | nullable |
| `urgency` | enum | `low` \| `normal` \| `high` \| `critical`; nullable |
| `meeting_at` | timestamptz | meetings only |
| `url` | text | links only; original web address |
| `inbox` | boolean | not null, default false; untriaged flag (PRD §4.2 Inbox). Arrival paths (quick capture; later email-in/Todoist/share-target) set it, triage clears it |
| `todoist_id` | text | nullable; set when synced to Todoist |
| `ms_event_id` | text | nullable; set when created from a calendar event (dedupe key) |
| `parent_id` | uuid | nullable; self-FK to `items.id` (containment, §hierarchy) |
| `exported_at` | timestamptz | nullable; when the OneDrive export last wrote this item (machine state, ADR-017). Incremental selection is `updated_at > exported_at` |
| `export_path` | text | nullable; where the export file lives, so renames clean up their old file and trash/archive moves to `/_archive/` |
| `properties` | jsonb | nullable; user-defined custom fields; GIN-indexed |
| `deleted_at` | timestamptz | nullable; soft-delete marker (Trash; purge after 30 days) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Notes:
- People are items with `type = 'person'`. They have bodies, so "Roger" can hold notes about Roger, and relate to his meetings/tasks/prayer through the `relations` table. (Sub-classifying people — staff/volunteer — is a `select` property on the type, not a built-in column; the former `kind` column was dropped with the entity type, ADR-055.)

### Hierarchy (parent/child)
- Single parent: an item has at most one `parent_id` (its container).
- Projects are emergent: a task with children renders as a mini-project with a progress rollup (percent of children done), computed deterministically. No separate project table.
- Guard against cycles (an item can't become its own ancestor).
- Fetch trees with `WITH RECURSIVE`.
- Soft-deleting a parent cascades `deleted_at` to children so the unit restores together.

---

## `relations` (the unified tag + link system)
A single generic page-to-page edge table with no type restriction: any item links to any item. Tagging a task with a person is an edge; item-to-item references use the same table.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_id` | uuid | FK `items.id`; edge start |
| `target_id` | uuid | FK `items.id`; edge end (often a person, but any item is valid) |
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
| `exported_at` | timestamptz | nullable; when the export copied the bytes to OneDrive. Attachment bytes are immutable, so one stamp is done forever (ADR-017) |
| `created_at` | timestamptz | |

---

## `job_state` (Phase 1, slice 17)
Per-job persistent state, one row per job key: the export job's last-run record now (`onedrive_export` → `{lastRunAt, lastSuccessAt, lastResult}`, read by `/health`); calendar delta links and Todoist sync tokens land here in Phase 2. Machinery, not user content, so it is deliberately not an item.

| Field | Type | Notes |
|---|---|---|
| `key` | text PK | job identifier |
| `value` | jsonb | not null; job-defined shape |
| `updated_at` | timestamptz | |

---

## `revisions` (Phase 1)
Body snapshots for restore. Debounced on save; cap ~50 per item with a prune step.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid | FK `items.id` |
| `body` | jsonb | snapshot of the canonical `{format, text}` body (markdown since ADR-037) |
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
| `dashboard_order` | integer | dashboard config (slice 29, migration 0005): null = not a widget; a number = position in the widget grid. One dashboard per owner in v1 — the config rides the view it shows, no separate table. |
| `created_at` | timestamptz | |

---

## `matchers` (Phase 2, built slice 23; calendar event → template/entity)
Ordered, user-built rules (no seeded list). Editable without redeploy. Populated via setup wizard and learn-by-confirmation. Created in migration 0004, which also enables the `pg_trgm` extension for the fuzzy condition (ADR-024).

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

## `push_subscriptions` (Phase 2, slice 30; Web Push)
One row per browser/device the owner enabled notifications on (PRD §4.11). The push service `endpoint` is the unique key; `p256dh`/`auth` are the RFC 8291 message-encryption keys the browser supplies at subscribe time. Owner-scoped; a subscription the push service reports Gone (404/410) is pruned, so the table self-heals to live endpoints. Migration 0006.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id` |
| `endpoint` | text | **unique**; the push service URL |
| `p256dh` | text | base64url; subscription public key |
| `auth` | text | base64url; subscription auth secret |
| `created_at` | timestamptz | |

VAPID keys live in env (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`), not the DB; the Web Push protocol (VAPID JWT + RFC 8291 encryption) is hand-rolled over `node:crypto`, no `web-push` dependency (ADR-034).

---

## `share_tokens` (Phase 2, slice 31; public share links)
One row per issued public link (PRD §4.12): an unguessable `token` grants read-only access to one item's print render with no Clerk on the path. Owner-scoped issuance; revocation is a `revoked_at` stamp, not a delete, so the history is auditable and a revoked string can't be silently reissued. Cascade-deletes with the item at purge. Migration 0007.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | FK `users.id` |
| `item_id` | uuid | FK `items.id`, `ON DELETE CASCADE` |
| `token` | text | **unique**; 24 random bytes base64url (~192 bits) |
| `revoked_at` | timestamptz | nullable; set on revoke (the link stops resolving) |
| `created_at` | timestamptz | |

The public resolve joins token→item in one query so it only ever yields a live (non-revoked) token bound to a live (non-trashed) item. Indexes on `item_id` (list a page's links) and `owner_id`.

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
A core set covers nearly everything. **Built in the slice-33 builder (ADR-044):** `text`, `number`, `date`, `checkbox`, `url`, `select`, `multi_select` (the last two carry an `options: string[]`). `property_schema` is an **ordered array** of `{key, label, kind, options?}` (`key` is a stable slug, immutable once created, so renaming a label never orphans `items.properties` values). **`relation` is deferred** in the builder — item-to-item links already have the `@`-mention + Related panel, so a relation "property" would duplicate that surface (it can be added later if a distinct use appears). **ADR-055 confirmed the `relation` kind was *not* needed to retire the `entity` meta-type** — the universal interactive `RelatedPanel` and the type-agnostic `relations` table cover the critical needs — so it stays deferred. It lands later for *typed* relation fields (a Meeting's "Attendees", `@`-relate-at-capture). The pre-built Bible/passage hub (ADR-060) is built on plain item-to-item relations, not this kind. Formulas and rollups are out of scope (parking lot), except the deterministic subtask progress rollup.

**`include_in_share` (forthcoming, ADR-062):** a per-`PropertyDef` flag deciding whether a property is exposed when an item is shared/printed — Share/Print renders the canvas plus the opted-in fields. Mirrors the type-level `show_in_quick_capture` toggle but lives on the property. Per-type default field sets are decided type by type.

---

## Index plan
- B-tree: `items.type`, `items.owner_id`, `items.status`, `items.due_date`, `items.parent_id`; partial on `items.owner_id where inbox and deleted_at is null` (nav badge count + Inbox view).
- `relations.source_id` and `relations.target_id` indexed **separately** so both-direction backlink queries use bitmap index scans.
- GIN on `items.properties`.
- FTS: a `GENERATED ALWAYS AS ... STORED` `tsvector` column on `items`, GIN-indexed, weighted (ADR-014): title (`A`), body_text (`B`), then url (punctuation-split so URL words match) and `properties` string values via `jsonb_to_tsvector` (both `C`). Status/urgency/dates deliberately excluded (enums are filters, not prose). Not computed per query. (`body_text` is app-maintained: it strips markdown syntax from `body.text`. Generating the tsvector straight from the raw `body` jsonb would index structural noise, ADR-003; with markdown canonical the extraction is a light strip rather than a JSON walk.)
- B-tree on `push_subscriptions.owner_id` and `share_tokens.owner_id`/`share_tokens.item_id` (slices 30/31); `endpoint` and `token` are unique constraints.
- Composite indexes as query patterns prove them out; log additions in `decisions.md`.

## Phase 2+ structures, noted ahead (don't build in Phase 1)
- **Dashboard widgets (PRD §4.11):** a widget references a `views` row plus per-widget config (item count N, position, badge on/off). Likely a small `widgets` table (owner_id, view_id, position, item_count, show_badge) or a JSONB layout doc per user; decide at Phase 2 and log it.
- **Navigation slots (PRD §4.12):** 4-5 ordered slots per user (target view/type/item, badge source). Small enough to be a JSONB config on `users` or a tiny `nav_slots` table; decide at Phase 2.
- **Bible/passage relational structure (ADR-060, 2026-06-14 meeting; post-foundation module):** the canon pre-built as a relational structure — **book → chapter → verse, verse atomic**. Any item relates to one or more verses via the existing `relations` table (no new edge mechanism); a passage range links each verse in the range. A deterministic RefTagger-style auto-tagger (cron, no model) wires references in many surface forms. Modeled as a **bespoke `passage` type** (a verse is an item of that type), **not** as a `kind` of a generic entity — the `entity` meta-type and `kind` column were retired in ADR-055, so the old "passage as an `entity.kind`" framing in `explorations/scripture-passages-as-entities.md` is superseded. The exact row shape (one row per verse + chapter/book containers) is decided at build, but the relations + FTS reuse is the point. Touches core invariants (relations/search), so it's both-agree + ADR (done: ADR-060); the build itself is module-level.
- **Per-owner settings/profile store (cross-cutting; mostly shipped, ADR-053):** the V5 UI work added a `users.settings` jsonb (accent/highlight color, trash retention, nav position; migration 0012, ADR-053). The Papers "enter author/school once" (next_steps P2) and any future per-user module config (paragraph-titles on/off, etc.) want the same store. Consolidate on that one settings blob rather than per-feature columns; the author-name piece is core-adjacent (flag for an ADR when the profile surface is formalized).
- **Meeting AI (PRD §4.15):** needs no new tables. Audio is an `attachments` row; transcript/summary are sections in the meeting `body`; suggested tasks are task items related to the meeting with `match_state = 'suggested'`.

## Known schema-adjacent gaps (track, don't block)
- ~~Custom property values aren't full-text searched~~ resolved 2026-06-12: `properties` string values and link URLs joined the FTS document at weight `C` (ADR-014, migration 0002). The entity-kind term was dropped from the document when the column was removed (ADR-055, migration 0013).
- **Embedded query-view blocks have no faithful markdown form.** They export as a static snapshot/placeholder, not a live view (fine for the pulpit fallback since sermons are prose).
- ~~Entity `kind` placement~~ resolved: column on `items` (ADR-003); later removed with the entity type (ADR-055) — sub-classification is now a `select` property on a type.
