# Live item tokens (and the last apply-time gaps)

**Status:** building. LT1 (core resolver + server render) shipped as ADR-139. LT2 / TPL6 / LT3 follow as non-core slices. TPL7 + a couple of ideas are parked here.

**Origin:** Brandon, 2026-07-02 — "improve templates: relative properties, text, and variables." Five examples. The first two (child tasks with relative dates; a title with today's date at creation) already shipped in the 2026-06-20 templates redesign (ADR-093 + ADR-085). The last three are new and are what this doc is about:

- A markdown note with variables that auto-populate from related items (people, tasks, projects, dates).
- A paper whose body prints its due date from the property, so the export carries the right date.
- A `[Title]`-style token that pulls the item's title into the body, so the title is edited once (on the item), not twice.

## The core split: two resolution times

The five examples are two different features wearing one coat. Keeping them apart is the whole design.

1. **Apply-time variables (baked once).** Resolved the instant a template stamps an item, then the result is plain text. `{{today}}`, `{{today+7d}}`, `{{nextSunday}}`, `{{ask:Label}}`, the due/scheduled date rules, relative subtasks. **Already shipped** (ADR-093 / ADR-085); lives in `src/lib/template-vars.ts`.
2. **Live tokens (resolved at every render).** They stay in the stored markdown as tokens and resolve from the item's *current* state wherever the body renders — print, Save Offline, share, export, live Preview. This is not a templates feature; it's an extension of the canonical body format. Templates get it for free (a prototype's live tokens survive the clone untouched, because the apply resolver leaves unknown tokens intact). **This doc / ADR-139.**

Because live tokens change the meaning of `items.body`, layer 2 is **CORE** (both-agree + ADR). Layer-1 gap-closing (TPL6) is non-core template internals.

## Grammar (the contract — blessed by Brandon 2026-07-02, `{{item.*}}`/`{{parent.*}}`)

`{{…}}` (square brackets like `[Title]` collide with markdown links). Live tokens are namespaced so they can never be confused with apply-time vars, and so an unknown token always passes through untouched.

| Token | Resolves to |
|---|---|
| `{{item.title}}` | the item's current title |
| `{{item.status}}` `{{item.type}}` `{{item.url}}` `{{item.priority}}` | other scalar fields |
| `{{item.due}}` `{{item.scheduled}}` `{{item.created}}` `{{item.meeting}}` | core dates |
| `{{item.due:long}}` `{{item.scheduled-2d:iso}}` | date format + arithmetic (`iso/long/short/us/day`; `±Nd/w/m/y`) |
| `{{item.props.<key>}}` | any custom property by key (a `YYYY-MM-DD` value takes date format/offset; else plain text) |
| `{{item.related.<roleOrType>}}` | related items by edge role (`assignee`, `attendee`, …) **or** target type (`person`, `task`, …) |
| `{{item.children}}` | child items (subtasks), in authoring order |
| `{{item.children:ul}}` `{{item.related.person:ol}}` | list format: default comma-join; `ul`/`ol` **only when the token is alone on its line** (a real list can't sit mid-sentence — inline falls back to comma) |
| `{{parent.title}}` `{{parent.due:long}}` | the parent item's fields (for subtask bodies) |
| `\{{…}}` | backslash-escaped → renders literally |

Related/children entries emit the existing mention-link markdown `[@Title](ledgr://item/<id>)`, so the render pipeline links them (and print-flattens them) exactly like a hand-typed `@`-mention. Unset fields render empty; unknown tokens and apply-time vars (`{{today}}`, `{{ask:}}`) are left untouched.

## Use cases (brainstormed)

- **Seminary paper** — body opens `**{{item.title}}** · Due {{item.props.due_date:long}} · {{item.props.course}}`. Rename or re-date, and the live view, docx export, and print PDF all stay right.
- **Sermon** — `Preaching {{item.props.preach_date:long}} · {{item.props.passage}}`; the Save Offline PDF (Sunday-proof) always carries the real date + passage.
- **Meeting / event notes** — `Attendees: {{item.related.person}}`. Composes with EM1–EM4 (ADR-123): a pinned-template event auto-attaches its people, so the body self-populates.
- **Recurring tasks** — recurrence materializes occurrences through the same `cloneItemSubtree`, so `This week's bulletin, due {{item.due:us}}` resolves per occurrence with zero extra code.
- **Hiring packet** — the candidate is the item title; `{{item.title}}` everywhere means one rename fixes the whole doc.
- **Event prep with in-prose deadlines** — `RSVPs close {{item.scheduled-7d:long}}; confirm catering by {{item.scheduled-3d:long}}`.
- **Person pages** — `Open follow-ups: {{item.related.task}}`.
- **Subtasks naming their parent** — a template subtask titled `Prep for {{parent.title}}`.

## Slice plan

- **LT1 — token grammar + server-side render (CORE, ADR-139). ✅ DONE.** Pure `src/lib/item-tokens.ts` (`resolveItemTokens`/`hasItemTokens`/`scanItemTokens`); DB `src/lib/item-tokens-service.ts` (`buildItemTokenContext` — one owner-scoped, body-free read of item + parent + children + relations; `resolveItemBodyTokens` — the render helper). Wired into `/items/[id]/print`, `/share/[token]`, and `/api/render-markdown` (now takes an optional `itemId` so the live Preview resolves tokens; `MarkdownPreview`/`BodyEditor` pass it). Related/children → mention-link markdown, collected into the mentions map **after** resolution so they render type-aware. FTS strips tokens (never index a value that can go stale). `verify-item-tokens` 58/58; tsc/eslint/`next build` clean.
- **LT2 — editor chips + insert UX (non-core).** A Tiptap atomic inline node for `{{item.*}}`/`{{parent.*}}` with markdown round-trip (copy `mention-markdown.ts`), rendered as a resolved-value chip (dotted underline + hover showing the raw token/source). A `{{` suggestion popup (`@tiptap/suggestion`, like mentions) grouped Item fields / Parent / Related / Children, plus Apply-time only inside a template prototype (the grouping teaches baked-vs-live). Stretch: chips re-resolve on title/date change within the session.
- **TPL6 — close the apply-time (layer-1) gaps (non-core, parallel-safe).** (a) sweep custom **property values** through the apply-time resolver (a text prop can hold `{{today}}`/`{{ask:}}`); (b) **typed `{{ask:}}` with defaults** — `{{ask:Due date:date=nextSunday}}` → a date picker in the apply dialog, `select=A|B|C` → a dropdown, unanswered falls back to the default; (c) **relative `due` offsets on subtasks** (`relativeDue`, mirroring ADR-085's `relativeSchedule`) + a due cascade in the template date rules.
- **LT3 — export / MCP parity (small).** Bake resolved tokens in the pandoc/docx path and the exported `.md` files (derived outputs bake; the DB keeps tokens — ADR-037). Add a `resolveTokens` flag to MCP `get_item`.

## Parked (not this build)

- **TPL7 — relation-building from an ask (create-on-miss).** Brandon's "ask me for a theme, then tag the item to `{{theme}}`, creating the tag if missing." This is create-on-miss, an already-open thread (ADR-067 typed relations; Tyler wants a dedicated create-on-miss UX designed first). Defer until that UX lands, then reuse it here.
- **`{{item.children:tasks}}`** — a checkbox list mirroring each child's status (a printed prep sheet). Cheap add over the list machinery; wait for a real need.
- **Filtered lists** — `{{item.children.task}}` / `{{item.related.person.open}}`. Additive to the grammar; defer.
- **Ask-answer as a date base** — let an `{{ask:Event date}}` answer be the base for the template's date rules + relative subtasks ("subtasks relative to the *asked* date, not the apply date"). Powerful but couples the two layers; revisit after TPL6.
- **Live-updating editor across devices.** Three distinct problems: (1) chips re-resolving within one session (cheap — LT2 stretch); (2) cross-device freshness (the "open on two devices" case — a global *refetch-on-window-focus/visibility* slice, not a tokens feature); (3) true real-time/collaborative sync (big infra, touches `local-first-split.md`). Tokens *soften* (2) for the fields they cover, since a stale body still stores the token and renders the right value on next load. Refetch-on-focus is the cheapest concrete win and is its own candidate slice.
