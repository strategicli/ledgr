// Drizzle schema for Ledgr, implemented against schema.md (repo root).
// Phase 1 tables: users, types, items, relations, attachments, revisions,
// views, error_log. matchers is Phase 2 and is deliberately absent.
//
// Conventions from CLAUDE.md / schema.md:
// - Everything is an item; hot fields are columns, custom fields live in
//   items.properties (JSONB, GIN-indexed).
// - Every items/views/attachments row carries owner_id; queries filter on it.
// - Soft delete via items.deleted_at; hard deletes happen only at the 30-day
//   purge, so child tables cascade on delete to make the purge complete.
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Postgres tsvector, for the maintained FTS column (schema.md index plan).
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// The configurable status categories (Tasks Polish S2, ADR-082). Statuses
// themselves are user-defined per type (types.status_schema); this fixed enum is
// the *category* each status maps to — the bucket every hot query, the
// done-checkbox, and recurrence-complete key off. items.status holds the user's
// status key (text); items.status_category holds its bucket.
export const statusCategory = pgEnum("status_category", [
  "not_started",
  "in_progress",
  "done",
  "archived",
]);
// Retired (Tasks Polish S2, ADR-082): items.status is now text (a user-defined
// status key), not this enum. Kept defined-but-unused so the migration diff
// stays additive — dropping the type would make drizzle-kit prompt to
// disambiguate a rename. The Postgres type lingers harmlessly; no column uses it.
export const itemStatus = pgEnum("item_status", ["open", "done", "archived"]);
// Priority P1–P6 (ADR-096): the `urgency` column is now a smallint 1..6 (1
// highest … 6 lowest, null = unset). The old `urgency` pgEnum is dropped by
// migration 0030. The column keeps its name to avoid a wide rename; surfaced as
// "Priority" everywhere. See src/lib/priority.ts.
export const matchState = pgEnum("match_state", ["confirmed", "suggested"]);

// Activity-log event kinds (Project Type, ADR-111). A closed, code-owned
// vocabulary (unlike items.status, which users define) so the Recent Activity /
// Digest / Story-weave narrators can switch exhaustively over it. Adding a kind
// is a small additive migration. See src/lib/activity.ts.
export const activityKind = pgEnum("activity_kind", [
  "record_created",
  "status_changed",
  "task_added",
  "task_completed",
  "note_added",
  "meeting_held",
  "milestone_added",
  "milestone_passed",
  "record_related",
  "checkin_reviewed",
  "overview_woven",
]);
export const viewLayout = pgEnum("view_layout", [
  "list",
  "table",
  "board",
  "calendar",
  "agenda",
]);

// One row in v1. Exists so owner_id FKs are honest (multi-user-ready, not
// multi-user). clerk_id stays nullable until Clerk is wired (slice 3).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique(),
  email: text("email").notNull().unique(),
  // Per-owner UI/preferences blob (v5): highlight-accent color, Trash retention
  // days, nav position, etc. A single jsonb keeps adding a preference from being
  // a migration each time. Shape parsed/defaulted in src/lib/settings.ts.
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Stored View Definitions. Built-ins ship as is_system rows (seeded when the
// views land); user-built views are just more rows.
export const views = pgTable("views", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  filter: jsonb("filter"),
  sort: jsonb("sort"),
  grouping: jsonb("grouping"),
  // Which columns/properties the list + table layouts show (Brandon feedback,
  // 2026-06-14): an ordered ViewColumn[] (src/lib/views.ts) of built-in fields
  // and the type's custom property keys. null = the layout's default columns,
  // so every pre-existing view is unchanged.
  columns: jsonb("columns"),
  layout: viewLayout("layout").notNull().default("list"),
  dateProperty: text("date_property"),
  // Planner display config (ADR-131): a tolerant jsonb holding the calendar
  // layout's interactive options — mode (month|timegrid), dayCount, slotMinutes,
  // placeBy (scheduled|due), work-hours window, showWeekends. null = the
  // layout's defaults, so every pre-existing calendar view is unchanged. Parsed
  // leniently in src/lib/views.ts (the navSlots/ADR-056 pattern); additive.
  display: jsonb("display"),
  // (views.dashboard_order was retired in the dashboards epoch, ADR-064 —
  // dashboards are now first-class rows in the dashboards table.)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Customizable dashboards (dashboards epoch). Supersedes the single-dashboard
// views.dashboard_order model: an owner has many named dashboards, each a
// resizable/draggable grid of widgets. A widget references a saved view (or is
// a non-view action block) and carries its own display settings + per-breakpoint
// grid layout — all in one jsonb array, matching how views store filter/sort as
// jsonb and keeping a dashboard load to one row + a batched per-widget fan-out.
// Shape parsed/defaulted in src/lib/dashboards.ts. focus_item_id is an optional
// dashboard-level scope: when set, every view/stat widget merges relatedTo into
// its query (confirmed edges only). ON DELETE SET NULL so deleting the focus
// item just clears focus, never drops the dashboard.
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    // Order in the dashboard switcher / nav (lower first; ties broken by name).
    position: integer("position").notNull().default(0),
    focusItemId: uuid("focus_item_id").references((): AnyPgColumn => items.id, {
      onDelete: "set null",
    }),
    widgets: jsonb("widgets"),
    // Dashboard-canvas stage (ADR-111 DC2): background (color/gradient/image +
    // scrim/blur), title visibility, density. Nullable — null = today's plain
    // dark dashboard, untouched. Shape parsed/defaulted in src/lib/dashboards.ts.
    appearance: jsonb("appearance"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("dashboards_owner_idx").on(t.ownerId)]
);

// Extensible type registry (Gmail system-vs-user-label pattern). Five system
// rows are seeded; user types are more rows the Build surface writes (slice 33,
// PRD §3.6/§4.10). property_schema holds the type's custom field definitions
// (an ordered PropertyDef[], parsed in src/lib/types.ts); the per-item values
// live in items.properties. Not owner-scoped: types are an instance-global
// registry (one user per deploy), and the FK items.type -> types.key keeps a
// type in use from being deleted.
export const types = pgTable("types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  isSystem: boolean("is_system").notNull().default(false),
  propertySchema: jsonb("property_schema"),
  // Per-type configurable statuses (Tasks Polish S2, ADR-082): an ordered list
  // of { key, label, category, color, isDefault } (src/lib/status.ts). null =
  // inherit the system default (To Do / Done / Archived). The user adds/colors
  // statuses here; each maps to a fixed category the plumbing keys off.
  statusSchema: jsonb("status_schema"),
  // Per-type status DISPLAY MODE (ADR-106): 'none' | 'checkbox' | 'select', the
  // user's choice on Build → Types for how this type presents completion. text
  // (not an enum) so adding a mode never needs a migration, matching items.status.
  // null = resolve by src/lib/status.ts resolveStatusMode ('none', or 'select'
  // when a custom status_schema is present). This is ONLY presentation — the
  // category plumbing (status_category) is unchanged and stays the source of
  // truth for "is it done". See the StatusMode block in src/lib/status.ts before
  // touching this; do NOT collapse status into a boolean to "simplify" it.
  statusMode: text("status_mode"),
  // Whether this type appears in the quick-capture type dropdown (PRD §4.4,
  // exploration type-and-kind-ux §2). Default true keeps the five core types
  // capturable; the builder toggles it so a "data only" custom type can stay
  // out of the curated dropdown.
  showInQuickCapture: boolean("show_in_quick_capture").notNull().default(true),
  // Hidden from everyday surfaces (ADR-059): a hidden type still exists and its
  // items still work, but it drops out of quick capture, the +New menus, the
  // list tabs, and the nav destination options. Lets the user turn off built-in
  // types they don't use (e.g. Link) without deleting them. Toggled from the
  // Build → Types page; distinct from show_in_quick_capture (capture-only) and
  // deleted_at (in Trash).
  hidden: boolean("hidden").notNull().default(false),
  // SPIKE (bespoke-tool catalog, next_steps.md:94): the id of an attached
  // module capability (ModuleCapability.id, e.g. "chord-chart"). When set, the
  // registry resolves this user type's canvas/format/exporters from the
  // capability instead of the default markdown canvas — decoupling a module's
  // behavior from a fixed type key. Null for a plain custom type.
  capability: text("capability"),
  // Per-type item canvas layout (ADR-069, Feature B): an arrangeable, field-level
  // 2D grid (react-grid-layout) describing where each card — title, body, each
  // system/custom/relation field, related panel — sits, per breakpoint, plus its
  // flow/fixed mode. null = the generated default arrangement (today's stacked
  // render is untouched). Shape parsed/defaulted in src/lib/canvas-layout.ts;
  // applies only to the default markdown canvas, not bespoke module canvases.
  canvasLayout: jsonb("canvas_layout"),
  // Per-type default widget composition (Layer 2, ADR-111/PJ2): the default
  // widget set + arrangement + behaviors (e.g. Digest) every new record of this
  // type inherits, when the type's homepage is widget-composed (Project first,
  // any type via the Build editor in PJ10). null = the generated default. Lives
  // on the type, never the record; per-record overrides go in items.composition.
  // Parsed tolerantly in src/lib/composition.ts (PJ3), the canvas_layout pattern.
  defaultWidgets: jsonb("default_widgets"),
  defaultViewId: uuid("default_view_id").references(() => views.id),
  // Soft-delete (ADR-058): a deleted type stays as a row (its trashed items'
  // FK still points here) but drops out of the registry/pickers. Restored from
  // Trash, or hard-purged with its items after the retention window. Null =
  // live.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The one big table. List queries never select body or bodyText.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    type: text("type")
      .notNull()
      .references(() => types.key),
    title: text("title").notNull().default(""),
    // Canonical body: { format, text } (markdown by default; ADR-037/ADR-040).
    // jsonb so the format tag travels with the text and markdown-family formats
    // (chordpro, etc.) are per-type. null until "gone deeper".
    body: jsonb("body"),
    // Plain-text extraction of the body's markdown, maintained by app code on
    // save (body-text.ts), so the generated tsvector below indexes real words
    // instead of markup, URIs, or color hexes (ADR-003).
    bodyText: text("body_text"),
    // The item's status KEY (Tasks Polish S2, ADR-082): a slug from its type's
    // status_schema (open/done/archived in the inherited default). Free text, not
    // an enum, because statuses are now user-defined per type.
    status: text("status").notNull().default("open"),
    // The fixed category that status key maps to — denormalized here so the hot
    // queries (Today, the default filter, recurrence) and the done-checkbox key
    // off an indexed enum, never the label. Kept in sync with `status` on every
    // write (items.ts); re-synced for affected items when a type's schema
    // recategorizes a status (types.ts setTypeStatusConfig).
    statusCategory: statusCategory("status_category").notNull().default("not_started"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    // The concrete date the task is planned for (native tasks, ADR-073/076),
    // distinct from due_date (the deadline). A real column, not a property,
    // because it is hot: Today, the focus layer, the ICS feed, and the overdue
    // auto-roll all query it (schema rule "hot fields are columns"). Stored as a
    // UTC-midnight calendar day like due_date (ADR-008). For a recurring task it
    // auto-advances on completion to the next uncompleted occurrence; the rule +
    // completion log live in properties.recurrence (src/lib/recurrence.ts).
    scheduledDate: timestamp("scheduled_date", { withTimezone: true }),
    urgency: integer("urgency"),
    meetingAt: timestamp("meeting_at", { withTimezone: true }),
    // The date a NOTE was actually taken (ADR-110), distinct from created_at
    // (the row's birth) and updated_at (last edit). Defaults to the creation
    // day for notes and is user-editable in the canvas. A real column, not a
    // property, because it's hot: the natural sort/group key for notes and what
    // the notes list and future "notes from last week" views key off (schema
    // rule "hot fields are columns"). Stored UTC-midnight like
    // scheduled_date/due_date (ADR-008). Note-scoped in behavior; physically on
    // items like the other type-specific date columns.
    noteDate: timestamp("note_date", { withTimezone: true }),
    url: text("url"),
    // Untriaged flag (PRD §4.2 Inbox): set by arrival paths (quick capture
    // now; email-in/Todoist/share-target later), cleared by triage. A real
    // column, not a properties key: it is hot (nav badge counts it on every
    // page) and filterable.
    inbox: boolean("inbox").notNull().default(false),
    // Template-prototype flag (ADR-093). A template's content is a real item
    // (and subtree): the prototype carries is_template = true, and every child
    // inherits it (createItem propagates it from a template parent). Excluded
    // from every owner-scoped enumeration — list/search/FTS/views/export/
    // counts/Today/Inbox/related/ICS — the same discipline as deleted_at, so a
    // template never leaks into user-facing surfaces. By-id reads (getItem,
    // subtree, clone) still see it: that's the authoring/apply path.
    // cloneItemSubtree never copies this, so applying a template yields real
    // (is_template = false) items.
    isTemplate: boolean("is_template").notNull().default(false),
    todoistId: text("todoist_id"),
    msEventId: text("ms_event_id"),
    // OneDrive export state (slice 17): when this row was last written to
    // the export tree and where. Machine state like todoist_id/ms_event_id,
    // not a user property. The incremental selection is
    // updated_at > exported_at; export_path lets renames clean up their old
    // file and deletes move it to _archive (PRD §5.4).
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    exportPath: text("export_path"),
    parentId: uuid("parent_id").references((): AnyPgColumn => items.id),
    // Next Action (Project Type, ADR-111/PJ2): a record's single pinned next step.
    // A pointer to a task (auto-advances on completion) OR free text when there's
    // no backing task. On the base because the Next Action header reads it hot on
    // every record page. SET NULL so completing/deleting the pinned task clears it.
    nextActionTaskId: uuid("next_action_task_id").references(
      (): AnyPgColumn => items.id,
      { onDelete: "set null" }
    ),
    nextActionText: text("next_action_text"),
    properties: jsonb("properties"),
    // Per-record widget composition OVERRIDE (Layer 3, ADR-111/PJ2). null =
    // inherit the type's default_widgets (Layer 2) verbatim — the common case, so
    // a fresh record stores nothing. Set lazily the first time a widget is
    // toggled/arranged on THIS record. Disabling a widget hides it here (keeps its
    // data); the shape is parsed tolerantly in src/lib/composition.ts (PJ3).
    composition: jsonb("composition"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Weighted FTS document (ADR-014): title (A) outranks body (B) outranks
    // metadata (C: url + custom property string values). The URL is split on
    // punctuation so "youtube" matches a youtube.com link; status/urgency/
    // dates stay out on purpose (they're filters, not prose).
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${items.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${items.bodyText}, '')), 'B') || setweight(to_tsvector('english', regexp_replace(coalesce(${items.url}, ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'C') || setweight(jsonb_to_tsvector('english', coalesce(${items.properties}, '{}'::jsonb), '["string"]'), 'C')`
    ),
  },
  (t) => [
    index("items_owner_idx").on(t.ownerId),
    index("items_type_idx").on(t.type),
    index("items_status_idx").on(t.status),
    index("items_status_category_idx").on(t.statusCategory),
    index("items_due_date_idx").on(t.dueDate),
    index("items_scheduled_date_idx").on(t.scheduledDate),
    index("items_note_date_idx").on(t.noteDate),
    index("items_parent_idx").on(t.parentId),
    // Partial: the badge count and Inbox view only ever read live inbox
    // rows, and those should stay few by design.
    index("items_inbox_idx")
      .on(t.ownerId)
      .where(sql`${t.inbox} and ${t.deletedAt} is null`),
    index("items_properties_gin").using("gin", t.properties),
    index("items_search_gin").using("gin", t.search),
  ]
);

// Unified tag + link system: one generic item-to-item edge table. Any item
// can link to any item (e.g. tagging a task with a person). suggested edges
// are provisional and excluded from trusted queries until confirmed.
export const relations = pgTable(
  "relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("related"),
    matchState: matchState("match_state").notNull().default("confirmed"),
    // Containment residence flag (Project Type, ADR-111): on a containment edge
    // (child -> parent, e.g. the task->project edge), home=true marks this as the
    // child's PRIMARY residence; home=false is a referenced/surfaced-elsewhere
    // edge. Orthogonal to role (what kind of edge) and match_state (trusted vs
    // suggested). Default false leaves every existing edge (tags, mentions,
    // typed relation fields) untouched and non-home. "A note is still a note":
    // containment is purely this edge, no schema fork. A record has at most one
    // home parent, enforced by the partial unique index below.
    home: boolean("home").notNull().default(false),
  },
  (t) => [
    // Indexed separately (not composite) so both-direction backlink queries
    // use bitmap index scans (schema.md index plan).
    index("relations_source_idx").on(t.sourceId),
    index("relations_target_idx").on(t.targetId),
    uniqueIndex("relations_source_target_role_uq").on(
      t.sourceId,
      t.targetId,
      t.role
    ),
    // At most one home (primary residence) edge per child item, across all
    // roles/parents. Partial so only home edges are constrained (ADR-111).
    uniqueIndex("relations_one_home_per_source_uq")
      .on(t.sourceId)
      .where(sql`${t.home}`),
  ]
);

// Deterministic relatedness cache (Discover, ADR-127). Derived machinery like
// revisions / the search tsvector — NOT user content (rule 2) and NOT on
// items.properties (that would bump items.updated_at on every recompute,
// re-triggering export + a rescore loop, and pollute the FTS tsvector). A
// bounded nightly job (src/lib/discovery/refresh.ts) runs the pure scorer
// (src/lib/discovery/score.ts) and upserts each item's top-N scored candidates
// here; the suggested-relations endpoint reads it (live-compute fallback on a
// miss). signals is the reason-chip list ([{kind,label}]) so the guess can show
// its work. Both FK columns cascade so a purged item drops its cache rows as
// anchor AND as candidate (self-healing). Score is unitless and comparable only
// within one anchor; computed_at vs items.updated_at drives the dirty rescore.
export const itemRelatedness = pgTable(
  "item_relatedness",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    signals: jsonb("signals"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The read path: an anchor's candidates, and the upsert key (one row per
    // anchor→candidate pair).
    uniqueIndex("item_relatedness_item_candidate_uq").on(
      t.itemId,
      t.candidateId
    ),
    // So a candidate's cache rows are reachable for cleanup independent of the
    // FK cascade.
    index("item_relatedness_candidate_idx").on(t.candidateId),
  ]
);

// Passage reference edges (ADR-143). A purpose-built linking substrate for the
// Bible canon, kept OUT of both `items` (a passage is fixed, shared reference
// data, NOT the owner's authored content — so the owner-scope invariant stays
// unbroken and `items` keeps meaning exactly "the owner's content") and
// `relations` (which is strictly item↔item; a passage target is a canon integer,
// not an item id). One row = one item referencing one passage interval
// [start_ref, end_ref] (ADR-143 pt 4); start==end is a single verse, and a range
// is stored as ONE row — never fanned out to per-verse edges — so a range stays
// a first-class object (the reversible-direction argument in the ADR). Owner
// scope rides the FK to items (as `relations` does), plus a deleted_at filter on
// the read path. B-tree indexes on the interval endpoints answer the two hot
// queries at library size ("what touches verse V": start<=V AND end>=V; "what
// overlaps [a,b]": start<=b AND end>=a); a GiST int-range index is the scale-up
// if true interval search is ever needed.
export const passageRefs = pgTable(
  "passage_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    startRef: integer("start_ref").notNull(),
    endRef: integer("end_ref").notNull(),
    // Its OWN edge role, distinct from the mention role — so the later ADR-060
    // auto-tagger's suggested edges (Tyler review pt 2a) can coexist here without
    // the on-save body sync (syncPassageRefs) ever deleting a tagger-written row.
    // Default "passage" = a body-authored @/ref link.
    role: text("role").notNull().default("passage"),
  },
  (t) => [
    // The source item's passages: the Related-panel read + the on-save diff.
    index("passage_refs_source_idx").on(t.sourceItemId),
    // The passage-page overlap query probes both endpoints.
    index("passage_refs_start_idx").on(t.startRef),
    index("passage_refs_end_idx").on(t.endRef),
    // One row per (item, interval, role): the on-save upsert key, so re-saving a
    // body that still contains the same link never duplicates the edge.
    uniqueIndex("passage_refs_source_interval_role_uq").on(
      t.sourceItemId,
      t.startRef,
      t.endRef,
      t.role
    ),
  ]
);

// Metadata only; bytes live in R2 behind the storage-provider interface.
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    parentItemId: uuid("parent_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    // Attachment bytes are immutable once uploaded, so one stamp marks the
    // export copy done forever (slice 17).
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    // Audio-retention marker (meeting recording v1b, ADR-089): when set, the
    // daily purge deletes this attachment (R2 bytes + row) once now() passes
    // it. Stamped now()+30d when a transcript is produced from the audio — the
    // audio has done its job, the transcript is what Ledgr keeps. Null = keep
    // (the default for every non-audio attachment).
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_parent_idx").on(t.parentItemId)]
);

// Body snapshots for restore. Debounced on save; capped ~50 per item by a
// prune step in app code (slice 4).
export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    body: jsonb("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("revisions_item_idx").on(t.itemId)]
);

// The activity log (Project Type, ADR-111): an append-only, owner-scoped record
// of what happened on a container record (a project, later a pursuit). Recent
// Activity, the Digest, and the Overview Story weave are all downstream of this
// — the narrative is only as good as the log is rich, so payload carries enough
// context to narrate later without re-joining. The SUBJECT is the record the
// event narrates (usually the project); the ACTOR is the thing that triggered it
// (the completed task, the added note) when distinct from the subject.
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    // The record this event is ABOUT. Cascade so a purged record takes its log
    // with it (the 30-day purge stays complete).
    subjectId: uuid("subject_id")
      .notNull()
      .references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    // The item that triggered it (task completed, note added) when distinct from
    // the subject; null for subject-level events (the project's own status
    // change). SET NULL so deleting the actor keeps the history line.
    actorId: uuid("actor_id").references((): AnyPgColumn => items.id, {
      onDelete: "set null",
    }),
    kind: activityKind("kind").notNull(),
    // Pre-rendered human-readable line ("3 tasks closed", "booklet to printer").
    summary: text("summary").notNull(),
    // Rich denormalized context: { fromStatus, toStatus, title, ... }.
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The hot read: a record's timeline, newest first (Recent Activity, Digest,
    // weave all key off (subjectId, occurredAt)).
    index("activity_events_subject_idx").on(t.subjectId, t.occurredAt),
    index("activity_events_owner_idx").on(t.ownerId, t.occurredAt),
    // The staleness clock: latest checkin_reviewed per subject. last_reviewed_at
    // is DERIVED from this (no column), reset when the user responds to a Digest.
    index("activity_events_checkin_idx")
      .on(t.subjectId, t.occurredAt)
      .where(sql`${t.kind} = 'checkin_reviewed'`),
  ]
);

// Per-job persistent state, one row per job key (slice 17): the export
// job's last-success record now; calendar delta links and Todoist sync
// tokens land here in Phase 2. Not items (CLAUDE.md rule 2 covers user
// content; sync bookkeeping is machinery) and not env (it changes at
// runtime).
export const jobState = pgTable("job_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Calendar event -> entity/template matching rules (slice 23, PRD §5.1).
// Ordered, user-built (no seeded list); editable without a redeploy. The
// calendar sync runs them on a new meeting; deterministic, no model in the
// loop. condition is one of attendee-email / series-id / title-regex /
// title-fuzzy (pg_trgm similarity, the last resort); action attaches default
// entities/tags, names a template, sets default urgency. Populated by the
// setup wizard and learn-by-confirmation.
export const matchers = pgTable(
  "matchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    // Evaluation order within a condition kind (lower first). The kind itself
    // also ranks: attendee-email -> series-id -> title-regex -> fuzzy (PRD).
    priority: integer("priority").notNull().default(0),
    condition: jsonb("condition").notNull(),
    action: jsonb("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("matchers_owner_priority_idx").on(t.ownerId, t.priority)]
);

// Calendar feed cache (ADR-094 E3). The calendar sync no longer auto-creates an
// item per event (the firehose, ADR-023); it upserts every polled event here,
// keyed by ms_event_id. A MATCHED event (a matcher recognizes it — a standing
// 1:1, a series) auto-promotes to an `event` item and sets promoted_item_id;
// everything else stays here as a one-click "Add" in the calendar feed on
// /events. Not items (CLAUDE.md rule 2 is user content; this is sync bookkeeping
// until the user promotes it). promoted_item_id ON DELETE SET NULL: a purged
// event item just frees its feed row, never a dangling FK.
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    msEventId: text("ms_event_id").notNull(),
    title: text("title").notNull().default(""),
    // Event start/end as real instants (UTC), like items.meeting_at. Nullable
    // start guards a malformed feed row; the feed query orders by it.
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    // The CalendarMeta blob (attendees/location/series/join url/body preview).
    meta: jsonb("meta"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    // Set once this event becomes an `event` item (auto-promote on match, a
    // manual Add, or a pre-existing item detected by ms_event_id). Non-null =
    // promoted, so it drops out of the feed.
    promotedItemId: uuid("promoted_item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    lastModified: text("last_modified"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("calendar_events_owner_idx").on(t.ownerId),
    uniqueIndex("calendar_events_owner_event_uq").on(t.ownerId, t.msEventId),
    // The feed query: an owner's un-promoted upcoming events, ordered by start.
    index("calendar_events_feed_idx").on(t.ownerId, t.startAt),
  ]
);

// Web Push subscriptions (slice 30, PRD §4.11). One row per browser/device
// the owner enabled notifications on; the endpoint is the push service URL
// (unique), p256dh/auth are the RFC 8291 encryption keys the browser hands us
// at subscribe time. Owner-scoped like everything else (multi-user-ready). A
// subscription the push service reports Gone (404/410) is pruned, so this
// table self-heals to live endpoints only.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("push_subscriptions_owner_idx").on(t.ownerId)]
);

// Notification center (ADR-129). One row per notification EVENT (three tasks
// notifying at once = three rows; never a rolled-up digest). Persists what Web
// Push (ADR-034) only ever delivered fire-and-forget, so the owner has a
// history they can mark read/unread and archive. NOT notifications-as-items
// (rule 2 bend, justified): read/unread doesn't map onto status_category, and
// as items they'd pollute items/FTS/Discover — same call as revisions /
// item_relatedness / push_subscriptions (derived/system machinery, not user
// content). `kind` is the source (agenda/meeting_prep/task_due/calendar_soon/
// sync_error); the per-source on/off toggle lives in users.settings
// (notificationPrefs), not here. `state` + its timestamps are the linear
// lifecycle (unread → read → archived); the badge query is a single
// state='unread' count. related_item_id deep-links the source item and cascades
// at item purge. Owner-scoped like everything else. recordNotification writes;
// the 30-day archived purge (machine/purge) reclaims.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    // The source/category. Free text (not an enum) so a new source never needs
    // a migration, matching items.status; validated in src/lib/notifications.
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    // Optional secondary line. Plain text — NOT the items.body {format,text}
    // contract; a notification is not a content item.
    body: text("body"),
    // Where the row's click navigates (same-origin path), mirroring
    // PushMessage.url. Null = no deep link.
    url: text("url"),
    relatedItemId: uuid("related_item_id").references(() => items.id, {
      onDelete: "cascade",
    }),
    // Lifecycle: 'unread' (default) → 'read' → 'archived'. Free text for the
    // same migration-free reason as kind; the set is fixed in app code.
    state: text("state").notNull().default("unread"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The list + the unread-count badge: an owner's notifications in a state,
    // newest first.
    index("notifications_owner_state_idx").on(
      t.ownerId,
      t.state,
      t.createdAt
    ),
    // So a purged item's notifications are reachable for cleanup independent of
    // the FK cascade.
    index("notifications_related_item_idx").on(t.relatedItemId),
  ]
);

// Public share links (slice 31, PRD §4.12). One row per issued link: an
// unguessable token that grants read-only access to one item's print render,
// no Clerk on the public path. Owner-scoped issuance; revocation is a stamp
// (revoked_at), not a delete, so a revoked token can't be silently reissued to
// the same string and the history is auditable. Cascade-deletes with the item
// at purge (a purged item has no shareable render).
export const shareTokens = pgTable(
  "share_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    // Per-link render options (type-aware mentions): a small jsonb blob the
    // public render reads, e.g. { showIcons: false } to drop @-mention icons for
    // a cleaner shared document. Stored on the token so the setting travels with
    // the URL — a recipient can't change it. Additive; old links default to {}.
    options: jsonb("options").notNull().default(sql`'{}'::jsonb`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("share_tokens_item_idx").on(t.itemId),
    index("share_tokens_owner_idx").on(t.ownerId),
  ]
);

// Per-type item templates — now a thin REGISTRY pointing at a prototype item
// (ADR-093, reverses ADR-045). A template's content is a real item + subtree
// (is_template = true), authored in the normal canvas; this row holds only the
// metadata: name, which type it makes, its prototype, whether it's the type's
// default, and an apply_config blob (date-field rules / variable defaults,
// filled by TPL3). Apply = cloneItemSubtree(prototype). The old
// body/property_defaults/relation_defaults columns are gone — that content now
// lives on the prototype's real body, properties, and relation edges (the
// clone's carryRelations re-creates the preset edges). Still owner-scoped
// personal config, like views/matchers. prototype_item_id cascades, so a
// purged prototype takes its registry row with it; a normal delete is
// registry-aware (templates.ts deleteTemplate).
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    type: text("type")
      .notNull()
      .references(() => types.key, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The hidden prototype item this template clones on apply. Cascade: if the
    // prototype is ever hard-purged (30-day Trash purge), the registry row goes
    // with it.
    prototypeItemId: uuid("prototype_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    // The type's default template, used automatically by "+ New" (TPL4). At
    // most one per (owner, type), enforced by the partial unique index below.
    isDefault: boolean("is_default").notNull().default(false),
    // Apply-time configuration (TPL3): date-field rules, variable defaults.
    // Reserved now (null), populated when variable resolution lands.
    applyConfig: jsonb("apply_config"),
    // Calendar match rule (EM1, ADR-123): { condition: MatcherCondition;
    // autoApply: boolean }. NULL = a plain content template (no rule). When set
    // on an `event` template, the condition decides which calendar events this
    // template governs; autoApply=true makes a matching event apply it on Add.
    // This is the rule source that supersedes the (now-dormant) `matchers` table.
    matchConfig: jsonb("match_config"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("templates_owner_type_idx").on(t.ownerId, t.type),
    // At most one default template per type per owner.
    uniqueIndex("templates_one_default_per_type")
      .on(t.ownerId, t.type)
      .where(sql`${t.isDefault}`),
    // The rule-source hot path: the owner's match-rule templates for a type.
    index("templates_match_idx")
      .on(t.ownerId, t.type)
      .where(sql`${t.matchConfig} is not null`),
  ]
);

// No silent failures: failed crons/webhooks land here and surface through
// /health and the UI. detail is shown only when debug mode is on.
export const errorLog = pgTable("error_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  correlationId: text("correlation_id"),
  source: text("source").notNull(),
  message: text("message").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
