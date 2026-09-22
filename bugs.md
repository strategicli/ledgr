# bugs.md: Ledgr Known Bugs

Confirmed, reproducible defects with a root cause already traced. Fix one, delete its section, and note it in `next_steps.md` if it was user-visible. For work that is a *feature* rather than a defect, use `next_steps.md` instead.

Each entry carries a repro you can run, the exact file:line of the cause, and the blast radius, so nobody re-derives the diagnosis.

---

## 🐛 OPEN — the relation picker can't find "Theology I" when you type "Theology 1" (Tyler + Claude, 2026-08-31)

**Searching the "+ Relate" box for a near-miss title returns zero hits and then offers to create a duplicate.** Tyler's seminary class is titled **"Theology I"** (Roman numeral I, type `seminary_class`, id `afbba4e0-f45e-4124-9d67-081035b76eb3`). Typing `Theology 1` finds everything *except* the class.

**Root cause.** The picker's title filter is a strict AND of literal substrings, one per whitespace-separated word (`src/lib/items.ts:163-165`):

```js
for (const word of escapedQ.split(/\s+/).filter(Boolean)) {
  where.push(ilike(items.title, `%${word}%`));
}
```

`"Theology I"` does not contain the substring `1`, so the row is filtered out before ranking ever runs. `pg_trgm similarity()` *is* in the query (`src/lib/items.ts:186`) but only inside `ORDER BY` — it ranks the survivors, it never rescues a row the `WHERE` already dropped. So the fuzzy matching that would obviously handle `1` ≈ `I` is present in the code and structurally unable to fire.

Both relation pickers read through this same path: `AddRelation.tsx:71-77` and `RelationField.tsx:111-113` both fetch `/api/items?q=…&limit=8` → `listItemsQuery()`. The three "@" mention pickers use it too, so this is every typeahead in the app, not just Relate.

**Repro.**

1. Open any item, click **+ Relate**, type `Theology 1`.
2. Hits: the `tag` "Theology 1", the note "Theology 1: Paper Recommended Resources", and the Unit-1 lecture notes. **Not** the class "Theology I".
3. Type `Theology` instead and the class appears immediately (prefix-match ordering puts it near the top).

**Why it matters more than a spelling nit.** Because `showCreate` fires whenever nothing *exactly* matches (`AddRelation.tsx:55-57`, `RelationField.tsx:92-94`), a filter miss doesn't fail quietly — it renders **Create "Theology 1"** as the next thing to click. The picker's answer to "I can't find your item" is "let me make you a second one." There is already a `tag` item literally titled `Theology 1` (`0e392721-5c15-4665-981f-7ced837d7e1a`) sitting next to the class, which is what this path produces.

Blast radius: any title where the user's mental spelling differs by a character from the stored one. Roman vs Arabic numerals (`I`/`1`, `II`/`2`) are the obvious family, but so are `&`/`and`, `St.`/`Saint`, and singular/plural.

**Suggested fix**, smallest first:

1. **Don't require every word to be a substring.** Keep the AND-of-words filter as the *fast* path, but fall back to a trigram threshold (`similarity(lower(title), lower(q)) > 0.3`) when it returns nothing, so the ranking function already in the query gets to answer. One extra query on the miss path only.
2. **Or widen the filter** to `AND-of-words OR similarity-above-threshold` in a single `WHERE`, which is one query but changes the plan for every picker keystroke — measure before choosing this over (1).
3. **Normalize numerals in the match term.** Cheap and targeted, but it only fixes this family and adds a translation table nobody will maintain.
4. **Suppress create-on-miss when a fuzzy hit exists.** Independent of the above and worth doing regardless: offering "Create X" while a 0.8-similar item exists is how the near-duplicate gets made.

The `AND-of-words` filter was itself a deliberate fix (the comment at `items.ts:157-162` records "Ask, Seek, Knock" failing a single `%q%`), so keep that behavior — this is about what happens when it still misses, not about reverting it.

---

## 🐛 OPEN — a mention quoted inside a code fence still becomes a real relation (Tyler + Claude, 2026-08-31; narrowed 2026-09-21)

**What's left of the `ledgr://item/` bug.** The crash half is fixed (see below); this half is not. `collectMentionIdsFromMarkdown()` scans raw markdown with no awareness of code spans or fences, so a note that *documents* the mention syntax with a real id inside backticks — `` `[@Title](ledgr://item/9f8c2b14-…)` `` — silently creates a relation edge nobody asked for. It no longer throws, it just quietly wires up a link the writer meant as an example.

**Suggested fix.** Skip code spans and fences when collecting mentions. Worth writing an ADR for, since it changes what counts as a mention (ADR-037/ADR-040 territory) and could drop edges that already exist in bodies where the mention sits in a fence.

**Fixed 2026-09-21 (was: "a malformed `ledgr://item/` id 500s every body save"):** any body holding a `ledgr://item/` link whose id was not a UUID failed to save with `internal error` and a correlation id. The trigger was documentation about Ledgr itself — the placeholder `ledgr://item/<id>` that the MCP tool descriptions and `CLAUDE.md` both use. `collectMentionIdsFromMarkdown()` skipped an *empty* id but accepted any other garbage, and `syncMentionRelations()` fed it into `inArray(items.id, …)`, which Postgres rejects with `invalid input syntax for type uuid` (22P02). Two changes: `mentionItemId()` now accepts only a UUID shape, and every consumer reads through it; and `indexSavedBody()` (`src/lib/item-mutations.ts`) makes the post-commit index work — revision snapshot, mention edges, passage refs — best-effort, so a derived-index failure is captured to `error_log` under `source: "item-index"` instead of reporting a committed write as a failed one. Also hit the print, share, and render-markdown reads, which resolve mentions the same way. Regression cases in `scripts/verify-body-contract.mts`.

---

## 🐛 OPEN — a failed item write still commits the row, and reports `created: []` (Tyler + Claude, 2026-08-31)

**`POST /api/machine/items` inserts the item, then fails on the body, then tells you it created nothing.** The row is left behind: titled, tagged, bodyless, and invisible in the response you would use to reconcile.

Observed while importing 37 notes. Two separate failed attempts on the same file each left an orphan, so one logical item ended up as three rows while the API reported `count: 0, created: []` both times.

**Repro.** Trigger the bug above through `POST` rather than `PATCH` (a new item whose body holds `ledgr://item/<id>`), then list notes by that title. You get a row per attempt.

```
HTTP 201  count: 35  errors: [{"index":6,"error":"internal error (...)"}]
# → 35 in the created[] array, but 36 rows now exist
```

**Root cause (to confirm).** The insert and the body/relation write are not in one transaction in the `POST` path (`src/app/api/machine/items/route.ts:126`), so the insert commits before the body write throws. The per-entry error handling then correctly reports the *entry* as failed without rolling back what already landed.

**Why it matters.** This is the batch-import failure mode: a partial failure is silently unreconcilable. A caller that retries the failed entries — the obvious response to a per-entry `errors` array — multiplies the orphans instead of fixing them. Retry is the documented pattern, so the API is actively encouraging the duplication.

**Suggested fix.** Wrap each entry's insert + body + relation sync in a single transaction so a failed entry leaves nothing. The bug above no longer triggers it (2026-09-21: the UUID guard stops the throw, and `indexSavedBody` can't fail a write that committed), but the class stands — any later step that throws after the insert still strands a row and reports `created: []`.

---

## 🔧 GAP — the machine API has no `DELETE` (Tyler + Claude, 2026-08-31)

`src/app/api/machine/items/route.ts` exports `GET` (:57), `POST` (:126), and `PATCH` (:186). There is no `DELETE`, and the MCP has no delete tool either, so **nothing that reaches Ledgr through a machine door can be removed through one.** Cleaning up the orphans above meant archiving them and renaming them with a `ZZ DELETE` prefix, matching the convention already visible on an old stray tag item.

Not a defect, but it is why a bad import cannot clean up after itself. Worth deciding deliberately: either add a real `DELETE`, or make the `ZZ DELETE` + archive convention explicit somewhere so it stops being folklore.

---

## 📌 Affected data from the 2026-08-31 import

Filed here so a fixer has something concrete to verify against.

- **`52ce46b8-aa67-4fd1-b842-36bc4ddf7556`** — note "Daily Work Day Log", tagged `AI Prompts`, **body deliberately left empty.** Its source file is the one that trips bug 1. Source: `~/Downloads/Brandon's AI Prompts List/daily-work-day-log-8b7579d5.md`. Once bug 1 is fixed, patch the body from that file and this note is complete. Body content was left byte-exact rather than edited around the parser, so the fix can be verified against the real trigger.
- **Two archived rows** prefixed `ZZ DELETE — orphan row from failed body write`, from bug 2. Safe to hard-delete in the UI.
- **Correlation ids** for log lookup: `5dde3065-2ead-4f06-921d-27de83de3b2d`, `96bdc56f-b69b-4a97-8793-4a65168a51ca`, `1fd6d1d4-193b-4d68-9004-ffa82843db19`.

The other 36 of 37 imported notes are complete and byte-exact.

---

## ✅ CLOSED — machine API 503 `owner not configured` (2026-08-31, fixed by Tyler same day)

Kept only because it leaves a confusing artifact. Every `/api/machine/*` request returned `503 {"error":"owner not configured"}` while auth passed (a bad credential gives 401), because `resolveMachineOwner()` (`src/lib/machine/owner.ts:10`) resolved to null.

**The artifact:** production now has **both** `LEDGR_API_OWNER_UPN` and `LEDGR_MCP_OWNER_UPN`. `resolveMachineOwner()` reads only the former (plus `ONEDRIVE_EXPORT_UPN`, `GRAPH_MAILBOX_UPN`, `DEV_USER_EMAIL` as fallbacks) and never the latter. If the two are meant to be one variable, consolidate them; if they are genuinely separate owners, say so in `runbook.md` before someone "cleans up" the one that is load-bearing.
