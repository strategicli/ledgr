// Favorites: a small, owner-curated list of items for instant access. State is
// the ordered `favorites` id list in users.settings (see settings.ts) — no
// schema change, owner-scoped like everything else, reorderable by drag. The
// star toggle on any item canvas writes here; the Favorites nav slot reads here
// (resolving ids to body-free list rows, dropping anything deleted/missing).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { listColumns } from "@/lib/items";
import { isIconRef, NAV_ICON_FALLBACK } from "@/lib/nav-icons";
import { getSettings, updateSettings } from "@/lib/settings";
import { listTypes } from "@/lib/types";

// One resolved favorite row for the flyout: enough to render and link, never the
// body (CLAUDE.md rule 8).
export type FavoriteRow = {
  id: string;
  title: string;
  type: string;
  icon: string;
};

// --- Pure list ops (no DB), so the membership/order math is obvious and the
// API/store can stay thin. Each returns a new array; order is meaningful.

export function isFavorited(ids: string[], id: string): boolean {
  return ids.includes(id);
}

// Star: append to the end (newest last) if not already present.
export function addFavorite(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

// Unstar.
export function removeFavorite(ids: string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

// Apply a drag reorder: take the requested order, but only ids that are actually
// favorited (drops anything stale/injected), then append any current favorite
// the request omitted so a reorder can never silently lose a star.
export function applyReorder(current: string[], order: string[]): string[] {
  const set = new Set(current);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (set.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of current) if (!seen.has(id)) out.push(id);
  return out;
}

// --- DB-backed store ops ----------------------------------------------------

// Resolve the owner's favorites to body-free rows, in saved order, dropping any
// id that no longer resolves (soft-deleted or gone). Self-heals: if the resolved
// set is smaller than the stored list, prune the stored list so it doesn't carry
// dead ids forever.
export async function getFavoriteItems(ownerId: string): Promise<FavoriteRow[]> {
  const { favorites } = await getSettings(ownerId);
  if (favorites.length === 0) return [];

  const rows = await getDb()
    .select({ id: listColumns.id, title: listColumns.title, type: listColumns.type })
    .from(items)
    .where(
      and(eq(items.ownerId, ownerId), isNull(items.deletedAt), inArray(items.id, favorites))
    );

  // Type → icon, so each row shows its type's glyph (best-effort; falls back).
  const typeIcon = new Map((await listTypes({ includeHidden: true })).map((t) => [t.key, t.icon]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Emit in the saved order; skip ids that didn't resolve.
  const resolved: FavoriteRow[] = [];
  for (const id of favorites) {
    const r = byId.get(id);
    if (!r) continue;
    const icon = typeIcon.get(r.type);
    resolved.push({
      id: r.id,
      title: r.title,
      type: r.type,
      icon: isIconRef(icon) ? icon : NAV_ICON_FALLBACK,
    });
  }

  // Prune dead ids out of the stored list (one cheap write only when it shrank).
  if (resolved.length !== favorites.length) {
    await updateSettings(ownerId, { favorites: resolved.map((r) => r.id) });
  }
  return resolved;
}

// Star/unstar an item. Verifies the item is the owner's and live before starring
// (so a bad id can't pollute the list). Returns the new favorited state.
export async function setFavorite(
  ownerId: string,
  itemId: string,
  favorite: boolean
): Promise<boolean> {
  const { favorites } = await getSettings(ownerId);
  if (favorite) {
    if (favorites.includes(itemId)) return true;
    const [row] = await getDb()
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId), isNull(items.deletedAt)));
    if (!row) return false; // not the owner's, or trashed — nothing to star
    await updateSettings(ownerId, { favorites: addFavorite(favorites, itemId) });
    return true;
  }
  await updateSettings(ownerId, { favorites: removeFavorite(favorites, itemId) });
  return false;
}

// Persist a drag reorder.
export async function reorderFavorites(ownerId: string, order: string[]): Promise<void> {
  const { favorites } = await getSettings(ownerId);
  await updateSettings(ownerId, { favorites: applyReorder(favorites, order) });
}

// Cheap membership check for the canvas star (one settings read).
export async function isItemFavorited(ownerId: string, itemId: string): Promise<boolean> {
  const { favorites } = await getSettings(ownerId);
  return favorites.includes(itemId);
}
