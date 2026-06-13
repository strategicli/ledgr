# COLLAB.md — heads-up board (Brandon + Tyler)

The two-person coordination surface for Ledgr. **Two sections, current state only, overwrite in place — no archive.** Each person keeps their block to "where I am and what I'm doing next" so the other isn't guessing. Pair it with a quick Discord/Telegram ping for anything time-sensitive.

**Where things go:**
- **Plans / availability / "what I'm touching this week"** → here.
- **Decisions** (anything architectural) → `decisions.md` as an ADR.
- **The core-change contract** (what needs both-agree before it merges, and what doesn't) → CLAUDE.md, "Building together." Read it before touching anything foundational.

Rule of thumb: a change to **core** (data model, the canonical body format, the type/canvas model, the module boundary, the provider interfaces, the cross-cutting invariants, the MCP/API contract, the nine principles) needs **both-agree + an ADR**. Everything else, move fast solo.

---

## Brandon — current

- **Availability:** _(e.g. "around this week, evenings")_
- **Working on:** Just landed the **Markdown epoch** pivot (ADR-037) — docs updated, code rework next. The foundation rework (markdown body, markdown-native editor, per-type canvas seam, module boundary) gates the new modules.
- **Next:** Scope the foundation-rework slice. Reacting to Tyler's PR #1 module specs is folded in.
- **Last updated:** 2026-06-13

## Tyler — current

- **Availability:** _(Tyler to fill)_
- **Working on:** PR #1 (`ty-additions/` module specs) is up for review. Modules planned: Papers, Songs, Sermons/Lessons, Discipleship; integrations Savor + Atlas; eventual iOS wrapper.
- **Next:** _(Tyler to fill)_
- **Last updated:** _(Tyler to fill)_
