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
  jsonb,
  pgEnum,
  pgTable,
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

export const itemStatus = pgEnum("item_status", ["open", "done", "archived"]);
export const urgency = pgEnum("urgency", ["low", "normal", "high", "critical"]);
export const matchState = pgEnum("match_state", ["confirmed", "suggested"]);
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
  layout: viewLayout("layout").notNull().default("list"),
  dateProperty: text("date_property"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Extensible type registry (Gmail system-vs-user-label pattern). Five system
// rows are seeded; user types are more rows (builder UI lands Phase 3).
export const types = pgTable("types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  isSystem: boolean("is_system").notNull().default(false),
  propertySchema: jsonb("property_schema"),
  defaultViewId: uuid("default_view_id").references(() => views.id),
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
    // BlockNote document (canonical JSON); null until "gone deeper".
    body: jsonb("body"),
    // Plain-text extraction of body, maintained by app code on save, so the
    // generated tsvector below indexes real words instead of BlockNote JSON
    // structure (ADR-003).
    bodyText: text("body_text"),
    status: itemStatus("status").notNull().default("open"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    urgency: urgency("urgency"),
    meetingAt: timestamp("meeting_at", { withTimezone: true }),
    url: text("url"),
    // Entities only: person | org | project | topic | campus. Text rather
    // than an enum so new kinds don't need a migration (ADR-003).
    kind: text("kind"),
    // Untriaged flag (PRD §4.2 Inbox): set by arrival paths (quick capture
    // now; email-in/Todoist/share-target later), cleared by triage. A real
    // column, not a properties key: it is hot (nav badge counts it on every
    // page) and filterable.
    inbox: boolean("inbox").notNull().default(false),
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
    properties: jsonb("properties"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Weighted FTS document (ADR-014): title (A) outranks body (B) outranks
    // metadata (C: url + kind + custom property string values). URLs/kinds
    // are split on punctuation so "youtube" matches a youtube.com link;
    // status/urgency/dates stay out on purpose (they're filters, not prose).
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${items.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${items.bodyText}, '')), 'B') || setweight(to_tsvector('english', regexp_replace(coalesce(${items.url}, '') || ' ' || coalesce(${items.kind}, ''), '[^a-zA-Z0-9]+', ' ', 'g')), 'C') || setweight(jsonb_to_tsvector('english', coalesce(${items.properties}, '{}'::jsonb), '["string"]'), 'C')`
    ),
  },
  (t) => [
    index("items_owner_idx").on(t.ownerId),
    index("items_type_idx").on(t.type),
    index("items_status_idx").on(t.status),
    index("items_due_date_idx").on(t.dueDate),
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

// Unified tag + link system: one generic item-to-item edge table. Tags are
// edges to entity items. suggested edges are provisional and excluded from
// trusted queries until confirmed.
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
