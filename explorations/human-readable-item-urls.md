# Exploration: human-readable item URLs (slug + id)

**Status:** parked (Brandon, 2026-06-24); explicitly **post-v1.0**. Not intent, not a decision. **Non-core** in the recommended form below (it's URL/routing, the "move fast, solo" lane) because it adds no schema and keeps the UUID canonical. The pure-slug variant *would* be core (it changes the `items` data model), which is one of the reasons to prefer the recommended form.

## The problem

Every item link today is `/items/{uuid}`, for example `/items/3f8a9c2e-1b4d-4e5f-8a9c-2e1b4d4e5f8a`. That token is the `items.id` primary key (`uuid().primaryKey().defaultRandom()`, `src/db/schema.ts`), and the page resolves it with a strict `WHERE id = ...` lookup (`getItem`, `src/lib/items.ts`). The URL carries no hint of what the item is: a list of these in browser history, a pasted link, or Claude's output is unreadable.

## Recommended shape: slug + id, UUID stays canonical

```
/items/sunday-sermon-john-3-3f8a9c2e1b4d4e5f8a9c2e1b4d4e5f8a
        └────────── slug ─────────┘└──────────── uuid ───────────┘
```

The slug is cosmetic and derived from `title` when the link is built. The UUID stays in the URL and stays the thing we resolve by. This is the Notion / Linear / GitHub-gist pattern, and it buys most of the readability at a fraction of the cost:

- **No schema change.** The slug is computed at link-build time, nothing new is stored. That keeps it off the frozen-core list (no `items` change, no ADR-with-Tyler gate, no migration).
- **No collisions.** The UUID guarantees uniqueness, so two notes both titled "Notes" need no `-2` suffix logic.
- **Rename-safe.** Change the title and old links still resolve, because the UUID is what's matched. Optionally `redirect()` to the fresh slug so the address bar self-heals.
- **Existing links keep working.** A bare `/items/{uuid}` still matches (the UUID is still in the path, just un-prefixed). This protects the OneDrive export links, the Save-Offline cache keys, block-ref deep links, MCP-emitted URLs, and any saved bookmark. That last point matters for the Sunday-proof rule, so it is not cosmetic.
- **Small blast radius.** One `itemHref(item)` helper to build links, one `parseItemId(param)` at the single chokepoint both routes flow through, and a mechanical swap of the ~20 call sites.

Keep it as **one path segment** (`slug-uuid`, not `slug/uuid`). The `[id]` route, the `@modal/(.)items/[id]` intercept, and `/items/[id]/print` all stay structurally unchanged that way.

## How it would work

1. **`itemHref(item)`** builds `slugify(title).slice(0, ~50) + "-" + item.id`. Empty/emoji titles fall back to just the UUID. One helper, imported everywhere a link is built.
2. **`parseItemId(param)`** pulls the trailing UUID off the param with a fixed-shape regex (UUID v4 has a rigid `8-4-4-4-12` hex form, so the tail is unambiguous). Put it once at the top of `ItemCanvas` (`src/components/canvas/ItemCanvas.tsx`), the shared shell both the full page and the modal pass through, so neither route needs its own parsing.
3. **Mandatory gotcha:** `items.id` is a Postgres `uuid` column, so handing `getItem` a slug-decorated string raw throws `invalid input syntax for type uuid`. The parse in step 2 has to happen *before* `getItem`. This is the one thing that cannot be skipped.
4. **Optional canonical redirect:** if the slug in the param doesn't match the current title's slug (item was renamed), `redirect()` (308) to the canonical URL. Cheap in Next, keeps the address bar honest, and is purely additive.

## Privacy consideration (the one Ledgr-specific downside)

A slug puts the **title into the URL**, which means it leaks into places the bare UUID never did: browser history, server logs, referrer headers, and link previews when a URL is pasted into chat or email. For a pastoral tool that is a real concern. A counseling note titled with someone's name currently exposes nothing in its URL; with a slug it would.

This connects to `confidential-tier.md` (ADR-075 declined a confidential flag/encryption for v1.0, but the underlying concern is live). The clean answer: **suppress the slug for `person` items and any future confidential tier**, falling back to the bare UUID for those. `itemHref` is the single place that decision lives, so it's a one-line policy, not a scatter of special cases. Worth settling before building.

## Why not a pure human slug (`/items/sunday-sermon-john-3`, no UUID)

It looks cleanest but costs the most and trips several Ledgr rules:

- A unique `slug` column on `items` is a **core schema change** (both-agree + ADR with Tyler, plus a migration).
- Collision handling (`notes`, `notes-2`, ...) and a rename policy: either freeze the slug at creation (it drifts from the title, confusing) or regenerate on rename (breaks every existing link unless you keep an alias/redirect table, which is *more* schema).
- It breaks every existing UUID link (export, offline cache keys, block-ref anchors, MCP output, bookmarks) unless the route *also* keeps resolving bare UUIDs, at which point you've built both paths anyway.

Net: more surface, more risk, and it works against the "existing links keep working" win that makes the recommended form safe.

## Relationship to existing design

These all keep working untouched precisely because the UUID stays in the path:

- **OneDrive export** and the **Save-Offline** cache, which key on `/items/{id}` and `/items/{id}/print` (`src/components/canvas/SaveOffline.tsx`).
- **Block-ref deep links**, `/items/{id}#^{blockId}` (`src/components/markdown-editor/MarkdownEditor.tsx`), and the **print route** `src/app/items/[id]/print/route.ts`.
- **MCP / machine API** output: decorated links are friendlier for the human reading Claude's reply, with no contract change.
- **Export filenames** already derive from `title` (`export_path`), so a title-derived URL slug and the export path naming would read consistently.

## Open questions

- Slug length cap and the `slugify` rules (lowercase, strip punctuation, collapse spaces to `-`, transliterate accents?). Pick a simple, dependency-free version (Principle 5).
- Confirm the `person`/confidential suppression policy above before shipping.
- Canonical 308 redirect on title-drift: worth it, or leave stale slugs to just resolve silently?
- Do block-ref copy links and the `/print` route get decorated too, or stay bare UUID (they resolve either way; decorating is only for prettiness)?
