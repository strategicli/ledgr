# Exploration: related-items discovery (a deterministic relatedness crawl)

**Status:** ✅ **BUILT — Phases 1–2 shipped 2026-06-27 (ADR-127; PRs #107, #109).** The "Discover related" panel (deterministic scorer + `item_relatedness` cache + nightly job + endpoint, under "Linked here") and the **Related Explorer** (`/items/[id]/explore` — the score-sorted, anchor-hopping map) are live. **Phase 3 (Loose Ends)** remains from this doc, designed in ADR-127 and deferred. This exploration is kept for the record and as the design source for that phase. (Originally parked Brandon, 2026-06-19, post-1.0; the sections below are the original exploration text.)

> **🧩 Core, but it leans on machinery we already built, and it is a genuinely new flow.** It sits on the `relations` substrate, the `RelatedPanel`, and the FTS tsvector, all core, so if it graduates it is **both-agree + ADR** with Tyler. The load-bearing pieces already exist (the `relateItems` confirm-on-relate gesture, the body-free both-directions related query, the weighted `items.search` tsvector, `pg_trgm`, the incremental-job discipline). What is new is the **path**: today's `suggested` edges flow from the calendar **matchers** (ADR-024), tied to specific external signals (an event's attendees, a series id). This feature is a separate, lower-confidence path: a broad *guess* from keywords, dates, and the link graph, surfaced on every item, that never writes a `suggested` edge.

## The idea (as raised, and refined 2026-06-19)

> "A 'related items' area at the bottom of every item (collapsible/hideable). Ledgr programmatically (not AI) crawls the data, generates a weighted value of how likely one item relates to another, and shows that list ordered most-likely-first. A clickable option officially associates the item."

Refined in conversation:

- It is **a new path for items to flow**, distinct from the matchers' calendar/task suggestions. The matchers make a confident, narrow *claim* from a known signal; this makes a broad *guess*.
- The signals are **keywords/text, dates edited or created, co-citation, and probably more** (open). It is deliberately a guess, not an assertion.
- The score is **computed slowly over time in the background**, so that **when the panel expands it just reads and shows** the items by likelihood. (Brandon: "not sure how, not sure if that's architecturally feasible." It is. See below.)
- **Not v1.0.** This buys room for the heavier background-job + cache shape rather than forcing the minimal version.

## The two things this is, and is not

Keep these from bleeding together; conflating them would overload a mechanism that is working well:

- **Associations (the `Related` panel today).** Real edges in `relations`: links Brandon made, `@`-mentions the body owns, or a matcher's provisional claim (`match_state = 'suggested'`, confirm/reject). These *assert* a connection.
- **Discovery (this idea).** A *ranking* of items that are statistically likely worth linking but **are not linked yet**. It asserts nothing; it surfaces. It lives **below** the `Related` panel and feeds **into** it (the "Link" click creates a real association).

One line: **matchers make a claim; discovery makes a guess.** Same end gesture (relate), different confidence, different path.

## Is it feasible?

**Yes**, including the "compute slowly, read instantly" shape Brandon described, with no new dependency. Four pieces already do most of the work:

1. **The relations graph is queryable both directions, body-free, owner-scoped** (`listRelatedItems`, `relatedItemsQuery`), with `relations.source_id` / `target_id` indexed separately for bitmap-scan traversal. Co-citation (neighbors-of-neighbors) is cheap.
2. **The weighted FTS tsvector already exists** (`items.search`: title `A`, body_text `B`, url + property values `C`, ADR-014) with `ts_rank` / `websearch_to_tsquery` in `src/lib/search.ts`. Keyword overlap is a query against an index we already maintain.
3. **`pg_trgm` is already enabled** (migration 0004), so fuzzy title similarity is available at zero new cost.
4. **The "make it real" gesture already exists.** `relateItems()` upserts a `confirmed` edge ("relating is the confirm gesture," ADR-015). The "Link" button is a call we already ship.

## How it would work

### Where the score lives (the crux Brandon pointed at)

Three shapes. The conversation moved the recommendation from B to C.

- **Shape A: persist guesses as `suggested` edges.** A job writes `match_state = 'suggested'` edges that render grayed in `RelatedPanel`. **Rejected.** It auto-fills every item with gray guess-rows, overloads `suggested` (whose narrow meaning, a confident external claim, is worth protecting), and forces dedup against real edges. A guess is not a provisional claim.
- **Shape B: compute on read, persist nothing.** Build the ranked list with a few bounded indexed queries when the panel expands. **Good, simple, and the right interim/v0.** Its limit: every expand pays the scoring cost, so the scoring has to stay cheap, which caps how thorough it can be.
- **Shape C: precompute a relatedness cache, refresh it with a slow incremental job (recommended, and what Brandon described).** A background job scores items and stores each item's top-N candidates (with their contributing signals); the panel expand just **reads the cache** and is instant. This is the shape that lets the scoring be *thorough* (it is amortized, off the hot path) while keeping reads trivial. It directly answers the crux: **the cost moves off the read path into a job that can afford it.**

**The reassurance that de-risks the choice:** the panel calls one endpoint (`GET /api/items/[id]/suggested-relations`). Whether that endpoint computes fresh (B) or reads a cache (C) is hidden behind it. So **start with B and migrate to C with no UI change** if and when the read cost or the desire for richer scoring justifies it. We do not have to commit up front.

### How "slowly over time" actually works (Shape C, concretely)

This is the part Brandon was unsure was feasible. It is the same discipline we already use for syncs:

- **A derived cache table (leaning this way), not content.** A small `item_relatedness` table (`item_id`, `candidate_id`, `score`, `signals` jsonb, `computed_at`), storing a **deeper list than is shown** (say top ~50, to back "show more" / scroll, see the UX below). It is *machinery* like `revisions` / `job_state` / the `search` tsvector, not a parallel content store, so "everything is an item" (rule 2) is intact. Two reasons it beats a `properties.suggestions` blob on the item, beyond plain queryability: (1) **no `updated_at` entanglement** — writing the cache to a separate table never bumps `items.updated_at`, whereas writing it onto the item would, which re-triggers export (ADR-017) *and* marks the item dirty for its own rescore, a loop; (2) **no FTS pollution** — `properties` string values feed the `search` tsvector (ADR-014), so a blob there would stuff candidate titles and ids into the search index and bloat the GIN. The blob's only real draw is dodging a migration, and these two outweigh it. (Technically still open, but leaning table.)
- **An incremental job, bounded per run.** Dirty-driven first: an edited item (body/title/relations change bumps `updated_at`) is rescored on the next run, exactly the "incremental syncs only" rule applied to scoring. A slow rolling cursor over the rest of the corpus catches second-order staleness (B changed, so A's view of B drifts) a slice at a time, so no run is expensive.
- **A relaxed cadence.** Vercel Hobby cron is daily; GitHub Actions covers sub-daily if wanted. Nightly is plenty: this is a guess surface, not authoritative data.
- **Staleness is a feature here, not a bug.** A suggestion that is a day stale is completely fine, and that tolerance is exactly what lets the cheap eventual-consistency model work. The read also re-checks `relations` at display time to drop anything that got linked since the last compute, so the cache never shows an already-linked row.

### Candidate gathering: bounded and indexed, never a full scan (rule 8)

Scoring an item against *all* items is forbidden whether it runs on read (B) or in the job (C). The job gathers a small candidate set per item via cheap indexed probes, then scores only that set:

1. **Keyword / text top-K (FTS + pg_trgm):** the item's title and most significant body terms as a tsquery against `items.search`, top ~20 by `ts_rank`; trigram title similarity as a fallback.
2. **Co-citation:** items linked to one of my neighbors (two indexed hops on `relations`).
3. **Shared attributes:** same `parent_id`, shared `select`/`multi_select` value, shared passage (ADR-060). Indexed equality lookups.

Union, cap the pool (~50), score, keep top-N.

### The signals, ordered by when they actually fire

The key insight (refined 2026-06-19): co-citation and text are not competing for "strongest." They trade **precision against coverage**. Co-citation is *high precision when it fires*: two items pointing at the same rare third item are almost certainly related. But it is **empty on the under-connected item** (an orphan note with no edges has no shared neighbors), which is exactly discovery's highest-value target. Text and time are *lower precision but always available*, so they carry the cold case. The resolution is not to pick one: when co-citation fires it earns a **high weight and ranks the head** of the list; text and time provide the **coverage** so an orphan still gets useful rows down the tail. Neither is globally stronger, so let the weights be empirical.

**Tier 1, always available (carry a cold, unlinked item) — the "guess" core:**

| Signal | Computed from | Notes |
|---|---|---|
| **Keyword / text overlap** | `ts_rank` of title + top body terms vs `items.search`; `pg_trgm` on titles | Brandon's primary signal; works with zero edges |
| **Temporal proximity** | closeness of `created_at` / `updated_at` (worked-on-together prior) | Brandon raised dates; weak and noisy alone, decays fast, so a booster not a driver |
| **Shared attribute** | same `select`/`multi_select` value, same `parent_id`, same `type` | explicit shared facets; available without any relation edges |

**Tier 2, graph-derived (strong, but only once edges exist) — the "confirmer":**

| Signal | Computed from | Notes |
|---|---|---|
| **Co-citation** | count of third items linked to both, **IDF-damped** by each shared neighbor's degree | sharpens the ranking as an item accrues edges |
| **Shared person / passage** | co-citation restricted to `type = 'person'` / `'passage'` | "both about Roger," "both on Eph 4" |

The one clever, still-deterministic move is **IDF damping** on co-citation: a neighbor linked to 200 items (a catch-all tag) is weak evidence; one linked to 3 is strong. Down-weighting by degree is the TF-IDF intuition on the graph, plain arithmetic, no model.

Put together: **precision signals (co-citation) rank the head of the list; coverage signals (text, time, shared attributes) fill the browsable tail.** That pairing is what makes the list both trustworthy at the top and worth scrolling all the way down (see the explorable UX below).

**Possible further signals (Brandon's "not sure what else") to weigh later:** same linked URL/domain (for link items), same calendar series or shared attendee set (meetings), co-occurrence in the same editing session (tighter than same-day), shared attachment. Add only if they earn their weight in real use.

### Show *why* (cheap, and it earns trust)

Because the job already computed the contributing signals, store them with the score so each row carries a quiet reason chip: "similar wording," "shares Roger," "edited together," "same Series." Near-free, and it is the difference between a list Brandon trusts and a black box. Deterministic systems can show their work; this one should.

### Where it renders

A collapsible section directly under `Related` (same column, same chrome), **collapsed by default** so the canvas stays fast. Expanding hits the read endpoint (a cheap cache read in Shape C). Each row: the item (reusing `RelatedRow`), a reason chip, and a **Link** button (→ `relateItems`). On Link, the row graduates into the `Related` panel above on the next render.

### Explorable, not just a peek (Brandon, 2026-06-19)

Brandon wants this browsable, not a fixed handful: *"I know I have more about this topic, where is it?"* So progressive disclosure, not a hard cap:

- **Default:** the top **5-8** by score in the collapsed-by-default section.
- **Show more / next 10 / scroll:** page down through the cached list (the ~50 the job stored), so deeper-but-still-plausible candidates are one click away.
- **Keep looking → hand off to search.** Past the cached set, "I know there's more" *is* a search intent, so the tail escalates into the existing FTS search (`src/lib/search.ts`), pre-filled with the item's key terms (optionally a related-to filter). Discovery and search are one spectrum: discovery is the ranked, precomputed head; search is the open-ended tail. That makes the panel a real "find everything about this" surface, not just a suggestion strip.

## Loose ends: the same engine, inverted (Brandon wants this explored)

Per-item discovery answers "what does *this* item relate to?" **Loose ends** inverts the question to "**which items are barely connected, and what should they link to?**" Same scoring engine, read across the corpus instead of one item. It is plausibly the *more* valuable surface, because it actively drives the graph toward completeness rather than waiting for Brandon to happen to open the right item.

**What it is in practice:** a Build → **MAINTAIN** tool (it cares for the data model, the verb fits) and/or a dashboard widget. A ranked list of under-connected items (fewest confirmed edges, or a low best-suggestion score), each with its top one or two suggested links inline and a one-click Link. The workflow: open "Loose Ends" now and then, knock out a batch of links, the graph gets richer, and Tier-2 co-citation gets smarter for everything (a virtuous cycle).

**Concrete examples in Brandon's data:**

- **The orphan note.** "*Elder candidate thoughts*" (a note from 3 weeks ago) links to nothing and nothing links to it. Loose Ends surfaces it with: link **Roger** (person, name appears in the body), the **Elder Board** meeting (text overlap), **1 Tim 3** (passage referenced in the text).
- **The meeting with no people.** A synced calendar meeting whose attendees were external so no `person` matched. Loose Ends: "no people linked; the body names **Sarah** and **Roger** — link them?"
- **The floating task.** "*Follow up on budget*" relates to no project or meeting. Loose Ends: "link to the **Budget Planning** meeting (similar wording, edited the same day)?"
- **The under-referenced person.** **Roger** is linked to 1 item, but 4 other items mention "Roger" in their text. Loose Ends: "link these 4?" (This is the inverse view: start from the hub, pull in the strays.)
- **The untagged passage.** A sermon draft quotes Eph 4 in prose but has no `passage` edge. Loose Ends flags it (and this overlaps with the RefTagger-style passage auto-tagger, ADR-060, which would catch many of these deterministically first).
- **The series gap.** A sermon draft not connected to its sermon series, where three sibling sermons all share a property value or co-cite the same passages.

Open for the loose-ends side: the ranking metric (raw edge count vs best-suggestion-score vs a blend), the threshold for "under-connected," and whether it is a widget, a Maintain page, or both.

## Two layers: always-on deterministic, plus on-demand AI (Brandon wants both)

This maps cleanly onto rule 3 (deterministic by default, AI on purpose), and Brandon confirmed he wants **both**, as complements rather than alternatives:

- **Layer 1, always on, deterministic (this exploration).** The background-computed relatedness, ready the instant a panel expands. Zero cost to invoke, no model, runs continuously. The dependable baseline.
- **Layer 2, on demand, AI (a deliberate trigger).** A "Find connections" action in the panel, or an MCP tool / a Claude ask, that does the deeper, semantic pass: reads bodies, reasons about themes the keyword/graph signals miss, and explains its picks in prose. Runs **only when triggered** (human-in-the-loop, "on purpose"), so it is allowed to be slower, richer, and more expensive.

**They compose.** Layer 2 can take Layer 1's cached candidates as its starting set (a cheap deterministic pre-filter) and reason only over those, which keeps the AI call bounded and cheap instead of dumping the whole corpus into a prompt. So Layer 1 is both the always-on surface and the efficiency front-end for Layer 2. (A *semantic* deterministic option, pgvector embeddings, is a third thing: it adds a dependency and an embedding call per item, so it stays out of scope here; named only so the seam is clear.)

## Honoring the principles

- **Rule 1 (DB canonical, export one-way):** discovery reads the canonical DB and writes only a normal `relations` edge when the user clicks Link. The cache is derived state, rebuildable from the items.
- **Rule 2 (everything is an item):** the relatedness cache is *machinery* (like `revisions` / `job_state` / `body_text`), not a parallel content store. Candidates are items; Link makes an ordinary edge.
- **Rule 3 (deterministic by default, AI on purpose):** Layer 1 is the deterministic default in plain SQL and arithmetic, no model; Layer 2 is the deliberate, triggered AI counterpart. This is the rule, embodied.
- **Rule 5 (boring stack):** no new dependency (reuses the relations indexes, the FTS tsvector, `pg_trgm`, the cron/Actions scheduler).
- **Rule 7 (multi-user-ready):** every probe and the cache are owner-scoped, like `relatedItemsQuery` / `searchItemsQuery`.
- **Rule 8 (fast/cheap):** the read is a cheap cache select (Shape C); the expensive scoring is amortized in a bounded incremental job; everything is body-free (text scoring uses the existing tsvector, never a body load); the panel is collapsed by default so the read fires only on demand.
- **Rule 9 (observable):** the job reports through the same structured-log + `error_log` + `/health` path the other jobs use; a failed rescore is captured, not silent.

## The hard parts (named honestly)

1. **Cold-start is the real design problem.** The most valuable target (the unlinked item) is the one with the least signal. Tier-1 signals must be tuned to produce *useful* rows from text and time alone, or the feature is weakest exactly where it is needed most. This is why the signal order was flipped.
2. **Weight tuning is empirical.** The starter mix is a guess; ship it behind the reason chips so Brandon can see *why* each row ranked and adjust from real use. Keep weights in one named, readable constant.
3. **Refresh strategy and staleness bounds.** Dirty-driven + slow rolling backfill is the plan; the open mechanics are how dirty is tracked (rely on `updated_at`, or an explicit flag) and how far behind the rolling pass may fall before it matters (probably: not much, it is a guess).
4. **Cost discipline in the job.** Even amortized, the job must bound candidate gathering (cap the pool, cap neighbor fan-out, top-K the FTS). A promiscuous neighbor or a huge person node is the stress case; IDF damping plus a fan-out cap contains it.
5. **Noise floor / empty state.** A sparse item must degrade to "nothing yet" quietly rather than show weak random rows. A minimum-score floor handles it.
6. **Dismiss ("not related").** A one-click Link is clean; suppressing a recurring bad suggestion needs some persistence (a `dismissed` signal, or an ignore-list). Lean **no dismiss in v1 of the feature**; an ignored suggestion just ranks low and scrolls off. Revisit only if false positives annoy.
7. **Don't double-surface matcher edges.** A candidate that already has any edge (confirmed or `suggested`, either direction) is excluded; it is already in the panel above.

## Likely direction (not decided)

Post-1.0. Build **Shape C** (a derived `item_relatedness` cache **table** holding ~50 candidates per item, refreshed by a bounded, dirty-driven nightly job), read by a dedicated endpoint, rendered as a **collapsed-by-default, explorable** section under `Related`: top **5-8** by default, **show more** through the cached list, then escalate to **search** for the long tail. **Reason chips** and one-click **Link** (reusing `relateItems`), **no dismiss** in v1. Score with **co-citation (IDF-damped) ranking the head** (high precision when it fires) and **keyword + temporal + shared-attribute providing coverage** so even an orphan gets useful rows. Treat **loose ends** as a sibling MAINTAIN surface over the same engine, likely built right after. Keep the read endpoint as the stable seam so the interim could ship as **Shape B (compute-on-read)** and migrate to C invisibly. Hold the **AI "Find connections"** action as Layer 2, reusing Layer 1's candidates.

## Open questions

- **Cache shape:** leaning an `item_relatedness` table over a `properties` blob (avoids the `updated_at`/dirty loop and FTS pollution, see "How slowly over time"); confirm at build. And how deep to store (top ~50?) to back the explorable list.
- **Weights and the floor:** the Tier-1/Tier-2 mix and the minimum score to show a row need real-data tuning. What is the right floor?
- **Loose-ends ranking:** raw edge count, best-suggestion-score, or a blend? What threshold counts as "under-connected," and is it a widget, a Maintain page, or both?
- **Dismiss or not:** confirm "no dismiss in v1," or pick the negative-signal mechanism.
- **Scope of types:** show everywhere collapsed, or only where candidates clear the floor?
- **Does Link land a generic `related` role, or offer the host type's relation fields** (ADR-067, Author/Attendees)? Default generic; offering fields is a nicety.
- **Layer 2 surface:** an in-panel button, an MCP tool, or both, and does it write `suggested` edges or just propose into the same Link gesture?

## Relationship to other parked work

- **Calendar matchers (ADR-024)** — the architectural precedent (deterministic engine proposes, user confirms) and the deliberate contrast: matchers persist confident `suggested` edges from narrow signals; discovery is a separate broad-guess path that persists nothing and never touches `suggested`.
- **[[storage-organization]]** — relations are Ledgr's primary organizing principle (ADR-061); discovery and loose-ends are the tools that *grow* that graph by surfacing links not yet made. Core, both-agree + ADR.
- **[[project-items]]** — a project is a relational connection across items (ADR-061), so discovery/loose-ends directly help assemble one.
- **[[scripture-passages-as-entities]]** — shared-passage is a Tier-2 signal (ADR-060), and the RefTagger-style passage auto-tagger is a sibling deterministic crawler that would catch many untagged-passage loose ends first. The two compose.
- **[[dashboard-widgets]] / [[flexible-surfaces]]** — loose ends is a natural widget / Maintain page; this is where that surface would live.
- **[[quick-capture-at-mention]]** — `@`-mentions create the body-owned edges that feed co-citation; better mention capture makes Tier-2 smarter for free.
- **[[block-linked-action-items]] / [[linked-synced-blocks]]** — other item-to-item-edge work; lighter relation, shared "edges make things discoverable without parsing bodies" principle.
