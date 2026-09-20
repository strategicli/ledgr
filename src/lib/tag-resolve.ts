// Tag NAMES → tag ITEMS, on the server (ADR-266).
//
// The app has always tagged by name: the "#fall-retreat" sigil in quick-add
// finds the tag whose title matches, or creates it, then writes a `tags` edge
// (src/lib/tags.ts has the vocabulary; that file is DB-free on purpose, so the
// resolution that needs the database lives here). Until now that resolve-or-
// create step existed only inside AddTaskCard, in the browser, as three fetches.
// Every other writer — the machine API, the MCP tools — had to do it by hand:
// list the tag type, match titles itself, POST the missing ones, then POST an
// edge per pair. A bulk import of 300 notes carrying a handful of tags each is
// exactly the job that turns into, and exactly the job the HTTP surface exists
// for, so the step becomes one server function every writer calls.
//
// Matching is EXACT and case-blind on the title, the same rule as the sigil
// (tags.ts parseTagTokens): "Outreach" and "outreach" are one tag, "Outreach
// 2026" is a different one. A substring match would silently pile new notes
// onto the wrong tag, which is worse than a duplicate nobody asked for.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { createItem } from "@/lib/item-mutations";
import { ItemError } from "@/lib/items";
import { relateItems } from "@/lib/relations";
import { TAG_TYPE, TAGS_ROLE } from "@/lib/tags";

export const MAX_TAGS_PER_ITEM = 50;
const MAX_TAG_NAME_LENGTH = 120;

export type ResolvedTag = {
  id: string;
  title: string;
  // true when this call created the tag item; false when it already existed.
  created: boolean;
};

// Validate a raw `tags` field into clean names: strings only, trimmed, non-
// empty, deduplicated case-blind, bounded. Pure so a bad shape is a 400 with a
// reason before anything is written. `undefined` (field absent) → [].
export function parseTagNames(raw: unknown, field = "tags"): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ItemError("bad_request", `${field} must be an array of tag names`);
  }
  if (raw.length > MAX_TAGS_PER_ITEM) {
    throw new ItemError(
      "bad_request",
      `${field}: too many tags (max ${MAX_TAGS_PER_ITEM} per item)`
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    if (typeof entry !== "string") {
      throw new ItemError("bad_request", `${field}[${i}] must be a string`);
    }
    const name = entry.replace(/\s+/g, " ").trim();
    if (!name) {
      throw new ItemError("bad_request", `${field}[${i}] must be a non-empty name`);
    }
    if (name.length > MAX_TAG_NAME_LENGTH) {
      throw new ItemError(
        "bad_request",
        `${field}[${i}] is too long (max ${MAX_TAG_NAME_LENGTH} characters)`
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out;
}

// A per-request memo so a batch of 500 notes that all carry "sermon prep"
// resolves that name once, not 500 times. Keyed by the lower-cased name.
export type TagCache = Map<string, ResolvedTag>;
export function newTagCache(): TagCache {
  return new Map();
}

// Resolve every name to a live tag item, creating the ones that don't exist.
// Existing tags come back `created: false`; when several live tags share a
// title (a duplicate the owner made by hand), the oldest wins so repeated
// imports keep landing on the same one.
export async function resolveTags(
  ownerId: string,
  names: string[],
  cache: TagCache = newTagCache()
): Promise<ResolvedTag[]> {
  const out: ResolvedTag[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit) {
      out.push(hit);
      continue;
    }
    const existing = await getDb()
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(
        and(
          eq(items.ownerId, ownerId),
          eq(items.type, TAG_TYPE),
          isNull(items.deletedAt),
          sql`lower(${items.title}) = ${key}`
        )
      )
      .orderBy(asc(items.createdAt))
      .limit(1);
    let resolved: ResolvedTag;
    if (existing.length > 0) {
      resolved = { id: existing[0].id, title: existing[0].title, created: false };
    } else {
      // createItem enforces that the `tag` type exists on this instance (the
      // owner may have deleted it), so a missing type surfaces as its ordinary
      // "unknown type 'tag'" ItemError rather than a stray insert.
      const made = await createItem(ownerId, { type: TAG_TYPE, title: name });
      resolved = { id: made.id, title: made.title, created: true };
    }
    cache.set(key, resolved);
    out.push(resolved);
  }
  return out;
}

// Tag an item by name: resolve (or create) each tag, then write the `tags`
// edge from the item to it. Idempotent — relateItems upserts on
// (source, target, role) — so re-sending the same tags is a no-op, and
// ADDITIVE: tags the item already has and that aren't named here stay.
export async function applyTags(
  ownerId: string,
  itemId: string,
  names: string[],
  cache: TagCache = newTagCache()
): Promise<ResolvedTag[]> {
  if (names.length === 0) return [];
  const resolved = await resolveTags(ownerId, names, cache);
  for (const tag of resolved) {
    // An item can't relate to itself: tagging a tag with its own name is the
    // one way to get here, and it's a caller mistake worth a clear message.
    if (tag.id === itemId) {
      throw new ItemError("bad_request", `a tag cannot be tagged with itself ('${tag.title}')`);
    }
    await relateItems(ownerId, itemId, tag.id, TAGS_ROLE);
  }
  return resolved;
}

// The optional `relateTo: [{ targetId, role? }]` shape the in-app POST
// /api/items already accepts (ADR-202 addendum 5), validated for the machine
// API so a malformed entry is a named 400 rather than a skipped edge.
export type RelateToEntry = { targetId: string; role?: string };
export const MAX_RELATE_TO = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRelateTo(raw: unknown, field = "relateTo"): RelateToEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ItemError("bad_request", `${field} must be an array of { targetId, role? }`);
  }
  if (raw.length > MAX_RELATE_TO) {
    throw new ItemError("bad_request", `${field}: too many edges (max ${MAX_RELATE_TO} per item)`);
  }
  return raw.map((entry, i) => {
    // A bare uuid string is accepted as shorthand for { targetId } — it's what
    // the MCP create_item relateTo has always taken.
    const e = typeof entry === "string" ? { targetId: entry } : entry;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new ItemError("bad_request", `${field}[${i}] must be { targetId, role? } or a uuid`);
    }
    const { targetId, role } = e as Record<string, unknown>;
    if (typeof targetId !== "string" || !UUID_RE.test(targetId)) {
      throw new ItemError("bad_request", `${field}[${i}].targetId must be a UUID`);
    }
    const out: RelateToEntry = { targetId };
    if (role !== undefined) {
      if (typeof role !== "string" || !role.trim()) {
        throw new ItemError("bad_request", `${field}[${i}].role must be a non-empty string`);
      }
      out.role = role.trim();
    }
    return out;
  });
}

// Write the edges named by a parsed relateTo list, source = the item.
export async function applyRelateTo(
  ownerId: string,
  itemId: string,
  entries: RelateToEntry[]
): Promise<{ targetId: string; role: string }[]> {
  const out: { targetId: string; role: string }[] = [];
  for (const e of entries) {
    const row = await relateItems(ownerId, itemId, e.targetId, e.role);
    out.push({ targetId: e.targetId, role: row.role });
  }
  return out;
}
