# Module: Discipleship & Relationships

**Status:** Draft v0.1
**Builds on:** PRD §3.6/§3.7, existing `entity.kind = person`, §6.3 (sensitive content)
**Canonical body format:** markdown
**Priority:** 2nd module — leadership-timing urgency; **Brandon likely wants this too**

---

## What it's for

Intentional relationship and discipleship tracking — the thing that matters more as leadership responsibility grows and that's easy to let slide. Tyler's honest framing: *"I'm not good at that stuff"* (texts, calls, follow-through), so the module's job is partly to **compensate for that** with gentle structure, not to turn relationships into a CRM grind.

This is the module Tyler expects Brandon would adopt directly — an Executive Pastor across four campuses moving up in leadership has the same problem at larger scale.

## Built on the existing person entity

Ledgr already has `entity.kind = person`. This module *extends* it rather than inventing a new type — a discipled person is a person entity with discipleship structure attached. Keeps one mental model.

## What it tracks (from the interview)

1. **Interaction log** — what we discussed, how the last meeting went, anything serious that surfaced worth noting, what we're currently working through. Each touchpoint is a small dated item linked to the person (reuses the meeting/note machinery).
2. **Cadence nudge** — the "I'm not good at texting" fix. A per-person `cadence` (e.g. every 3 weeks) + a nudge when no touchpoint has been logged within the window: *"no contact with Marcus in 3 weeks."* This is a deterministic check (Principle 7 — no model), surfaced as a task/badge or in a briefing.
3. **Relationship stage** (optional select) — e.g. acquaintance → discipling → peer. Light; only if it earns its place.
4. **Resources given / recommended** — books recommended, resources handed over. Linked `link`/`book` items with a `given`/`recommended` role on the relation. "What have I given Marcus?" becomes a query.
5. **Prayer requests** — with optional follow-up dates. **This closes a loop Savor explicitly left open** (Savor's spec: "does NOT hold prayer requests — different workflow, deferred"). The intended flow: log a prayer request on a person here → it surfaces in Savor during daily devotions/spiritual disciplines (Savor is becoming Tyler's devotional surface). The person→prayer→Savor loop is real and both apps were left open for it.

## Entities & shape

**Person** (existing `entity.kind = person`, extended):
- properties: `cadence` (interval, nullable), `last_touchpoint` (derived), `stage` (select, optional), `confidential` (bool — see privacy below)
- relations: → `touchpoint` items, → `prayer_request` items, → resources (`given`/`recommended` roles), → family/`org` entities

**`touchpoint`** (system sub-type): dated, `summary` (what we discussed / how it went), `body` (deeper notes), linked to person.

**`prayer_request`** (system sub-type): `text`, `opened_at`, `follow_up_at?`, `status` (open/answered), linked to person; **flows to Savor.**

## Cadence nudge mechanics

Deterministic, no model. A scheduled check (same scheduler as everything else): for each person with a `cadence`, if `now - last_touchpoint > cadence`, surface a nudge. Tunable, dismissable, never shaming (cf. Savor's capacity-respecting tone — this module should borrow that ethos given it exists to help someone who finds the relational admin hard).

## Privacy tier — **OPEN QUESTION (decide with Brandon)**

Pastoral/discipleship content is the most sensitive data in the brain. Brandon's PRD already wrestled with this (§6.3) and deferred a field-encrypted "confidential" tier. Two options:

- **(a) `confidential` flag — Tyler's lean.** Flagged items are **excluded from the MCP server, from export, and from briefings**, while staying searchable inside the authed app. Plain meaning: *"Claude can't see it, nothing auto-surfaces it, it never leaves the app."* Simple, cheap, and probably sufficient for a single-user app already behind Clerk + personal login.
- **(b) Field-level encryption at rest.** Even a DB breach reveals nothing. Much heavier; arguably overkill given the existing auth posture.

**Undecided.** Tyler's gut leans (a) but wasn't certain what "stricter privacy" should formally mean. Brandon has the identical need (pastoral/personnel notes), so this is a genuine decide-together item. Whichever is chosen applies to both instances and should land as a shared platform capability, not a per-module hack.

## Open questions

1. Privacy tier: (a) flag-excludes-from-MCP/export/briefings vs (b) field encryption. **Primary open question.**
2. Relationship `stage` — include or cut as over-structuring? Lean: optional, off by default.
3. Family modeling — link people to each other and to an `org`/household entity? Probably yes, cheap via relations.
4. Does the cadence nudge live as a generated task (pushes to Todoist) or stay in-app only? In-app + briefing likely; Todoist push optional per person.
