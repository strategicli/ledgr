// Server side of live item tokens (LT1): load one item's current state into the
// plain ItemTokenContext the pure resolver (item-tokens.ts) consumes. Owner-
// scoped and body-free (the list-query rule) — it reads scalar fields, the
// parent's fields, the children's titles, and the related items' titles, never
// another item's body. Callers (print / share / live-preview routes, later
// export + MCP) resolve tokens BEFORE building the mention map, so any mention
// links a token emits are collected and rendered type-aware like hand-authored
// ones.
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items, relations, types } from "@/db/schema";
import { bodyMarkdown, isItemBody, MARKDOWN_FORMAT } from "@/lib/body";
import { priorityLabel, type Priority } from "@/lib/priority";
import { dateToYmdUtc } from "@/lib/recurrence";
import { getAppTimezone, ymdInZone } from "@/lib/today";
import {
  hasItemTokens,
  resolveItemTokens,
  type ItemTokenContext,
  type TokenItemFields,
  type TokenRef,
} from "@/lib/item-tokens";

// A calendar-day column (due/scheduled, stored at UTC midnight, ADR-008) → YMD.
function calDayYmd(d: Date | null): string | null {
  return d ? dateToYmdUtc(d) : null;
}

// A YMD triple → "YYYY-MM-DD".
function ymdString(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// A real timestamp (created/meeting) → its YMD in the owner's timezone.
function instantYmd(d: Date | null, tz: string): string | null {
  return d ? ymdString(ymdInZone(d, tz)) : null;
}

// Flatten a properties jsonb value to a display string. A YYYY-MM-DD string is
// left intact so the resolver can format/offset it; arrays join with ", ".
function propToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => propToString(x)).filter(Boolean).join(", ");
  return "";
}

function propsMap(properties: unknown): Record<string, string> {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(properties as Record<string, unknown>)) {
    out[k] = propToString(v);
  }
  return out;
}

// The columns we read for an item's scalar token fields.
const itemFieldCols = {
  id: items.id,
  title: items.title,
  status: items.status,
  type: items.type,
  typeLabel: types.label,
  url: items.url,
  urgency: items.urgency,
  dueDate: items.dueDate,
  scheduledDate: items.scheduledDate,
  meetingAt: items.meetingAt,
  createdAt: items.createdAt,
  properties: items.properties,
  parentId: items.parentId,
} as const;

type ItemFieldRow = {
  id: string;
  title: string;
  status: string;
  type: string;
  typeLabel: string | null;
  url: string | null;
  urgency: number | null;
  dueDate: Date | null;
  scheduledDate: Date | null;
  meetingAt: Date | null;
  createdAt: Date | null;
  properties: unknown;
  parentId: string | null;
};

function toFields(row: ItemFieldRow, tz: string): TokenItemFields {
  return {
    title: row.title,
    status: row.status,
    type: row.typeLabel ?? row.type,
    url: row.url ?? "",
    priority: row.urgency ? priorityLabel(row.urgency as Priority) : "",
    dates: {
      due: calDayYmd(row.dueDate),
      scheduled: calDayYmd(row.scheduledDate),
      meeting: instantYmd(row.meetingAt, tz),
      created: instantYmd(row.createdAt, tz),
    },
    props: propsMap(row.properties),
  };
}

// Build the token context for `itemId`. Returns null if the item isn't the
// owner's live item. `todayYmd` is app-timezone today (the caller may pass `now`
// for tests); every date token resolves against it.
export async function buildItemTokenContext(
  ownerId: string,
  itemId: string,
  now: Date = new Date()
): Promise<ItemTokenContext | null> {
  const db = getDb();
  const [self] = await db
    .select(itemFieldCols)
    .from(items)
    .innerJoin(types, eq(types.key, items.type))
    .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId), isNull(items.deletedAt)))
    .limit(1);
  if (!self) return null;

  const tz = await getAppTimezone(ownerId);
  const todayYmd = ymdString(ymdInZone(now, tz));

  // Parent (one row, optional).
  let parent: TokenItemFields | undefined;
  if (self.parentId) {
    const [p] = await db
      .select(itemFieldCols)
      .from(items)
      .innerJoin(types, eq(types.key, items.type))
      .where(and(eq(items.id, self.parentId), eq(items.ownerId, ownerId), isNull(items.deletedAt)))
      .limit(1);
    if (p) parent = toFields(p, tz);
  }

  // Children (subtasks) in authoring order, titles only.
  const childRows = await db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(
      and(
        eq(items.parentId, itemId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt)
      )
    )
    .orderBy(asc(items.createdAt));
  const children: TokenRef[] = childRows.map((r) => ({ id: r.id, title: r.title }));

  // Related items: every outgoing edge, joined to the live target. Keyed by BOTH
  // role and target type so {{item.related.person}} and {{item.related.assignee}}
  // both resolve. Owner-scoped, non-deleted, non-template targets only.
  const relRows = await db
    .select({
      role: relations.role,
      id: items.id,
      title: items.title,
      type: items.type,
    })
    .from(relations)
    .innerJoin(items, eq(items.id, relations.targetId))
    .where(
      and(
        eq(relations.sourceId, itemId),
        eq(items.ownerId, ownerId),
        isNull(items.deletedAt),
        eq(items.isTemplate, false)
      )
    );
  const related: Record<string, TokenRef[]> = {};
  const pushRel = (key: string, ref: TokenRef) => {
    const k = key.toLowerCase();
    (related[k] ??= []).push(ref);
  };
  for (const r of relRows) {
    const ref: TokenRef = { id: r.id, title: r.title };
    pushRel(r.role, ref);
    pushRel(r.type, ref);
  }
  // De-dup within a key (an edge whose role equals its type would double up).
  for (const k of Object.keys(related)) {
    const seen = new Set<string>();
    related[k] = related[k].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }

  return {
    todayYmd,
    self: toFields(self, tz),
    parent,
    children,
    related,
  };
}

// Resolve live tokens in an item's title + markdown body for a render (print /
// share / export). Only markdown-family bodies are token-resolved; a chordpro
// chart passes through untouched (v1). Returns the item's title/body unchanged
// when there are no tokens or the context can't be built — so a caller can always
// use the result. Callers must resolve BEFORE collecting @-mentions, so tokens
// that emit mention links get resolved type-aware like hand-authored ones.
export async function resolveItemBodyTokens(
  ownerId: string,
  item: { id: string; title: string; body: unknown },
  now: Date = new Date()
): Promise<{ title: string; body: unknown }> {
  const md = bodyMarkdown(item.body);
  const format = isItemBody(item.body) ? item.body.format : MARKDOWN_FORMAT;
  const wantsBody = format === MARKDOWN_FORMAT && hasItemTokens(md);
  const wantsTitle = hasItemTokens(item.title);
  if (!wantsBody && !wantsTitle) return { title: item.title, body: item.body };

  const ctx = await buildItemTokenContext(ownerId, item.id, now);
  if (!ctx) return { title: item.title, body: item.body };

  return {
    title: wantsTitle ? resolveItemTokens(item.title, ctx) : item.title,
    body: wantsBody
      ? { format: MARKDOWN_FORMAT, text: resolveItemTokens(md, ctx) }
      : item.body,
  };
}
