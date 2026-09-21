# COLLAB.md — heads-up board (Brandon + Tyler)

Two sections, current state only, overwrite in place. Each block holds **where I am, what I'm doing next, and the last few heads-ups** — roughly the top half-dozen entries. When it grows past that, delete from the bottom: git log and PR titles carry the history, and everything before 2026-09-21 is parked in `COLLAB_ARCHIVE.md`.

**The rule is notify and merge (ADR-269).** Post the heads-up, merge, revert if the other person objects. Nothing here is a gate, including for migrations. The one thing that makes that safe is that **migrations stay additive** (add a column, then backfill; never destroy live owner data). Full contract: CLAUDE.md, "Building together."

**Where things go:** plans, availability, and "what I'm touching this week" → here. Decisions that are hard to undo or change what something means → `decisions.md` as an ADR. Everything else → the PR description. Pair this with a quick Discord/Telegram ping for anything time-sensitive.

---

## Brandon — current

- **Availability:** _(e.g. "around this week, evenings")_
- **Now:** _(what I'm building)_
- **🟢 ADR-269 (2026-09-21) — the code process is lighter, and this file is part of it.** No pre-merge ack, no core gate, no migration hold: notify and merge. ADRs only for what is hard to undo or changes what something means, so expect a few a month rather than a few a day. Bookkeeping files (`next_steps.md`, `roadmap.md`) move once per batch, not once per PR; the runbook and the user guide still move in the same PR, every time. CI on every PR, never committing to `main`, and additive migrations are untouched.
- **🟢 AGREED by Tyler 2026-09-20, ADR-268, PR #404: one optional flag on `PropertyDef`, `quickCapture?: boolean`,** stored in `types.property_schema` like `withEnd`/`withTime`. It marks a property to render as a settable chip on the quick-add card (`q`), chosen per type on Build → Types or over MCP `update_type`. Additive, tolerant parse, no migration.
- **⚪ FYI, additive, shipped solo (2026-09-20): three MCP share-link tools** (`share_item`, `list_share_links`, `revoke_share_link`) — ADR-183 carve-out, no ADR.

## Tyler — current

- **Availability:** _(e.g. "around this week, evenings")_
- **Now:** _(what I'm building)_
- **✅ BUILT (2026-09-21) — `export_item` + `create_item` take a `surface`.** The ADR-260/261 tail: `export_item` renders a song to Planning Center ChordPro or a paper to .docx through the same renderers the canvas uses; `list_types` reports each type's `exports`. Nothing existing changes shape (ADR-183 carve-out).
- **✅ BUILT (2026-09-19), ADR-267 — Trash is reachable over the machine API and MCP.** `DELETE /api/machine/items` (batch and single), `POST …/restore`, `?trash=true` on the list, MCP `delete_item` / `restore_item`. All soft, through the same `softDeleteItem`/`restoreItem` the in-app routes call.
- **✅ BUILT (2026-09-19), ADR-266 — the machine API tags and links on write,** and takes a bulk import in one request.
