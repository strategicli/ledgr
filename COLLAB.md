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
- **Working on:** Foundation rework (Phase M). **M1 (ADR-038, Tiptap) + M2 done. M3 — the cutover — DONE (2026-06-13, ADR-040): BlockNote is fully gone; Markdown is the only body path.** `{format,text}` body (`src/lib/body.ts`), server render via **markdown-it** (`src/lib/markdown-render.ts`), Tiptap in the real canvas, print/export/FTS/mentions all read markdown, `@blocknote/*` uninstalled, `src/components/editor/` + the old serializer deleted. `tsc` + `next build` clean; 24/24 verify scripts; in-browser editor + render + write round-trip confirmed.
- **Next:** **M5 — the per-type canvas seam** (`type → canvas` registry, default = markdown canvas) — the platform hook the Papers/Songs modules need. Then M6 (module registration boundary) alongside the first real module.
- **Heads-up (Tyler):** (1) **markdown-it is now the core server-side markdown→HTML renderer** (`src/lib/markdown-render.ts`, `html:true` so the `colors.ts` color/highlight HTML passes through; `ledgr://` links → `.mention` spans; body headings shift under the doc `<h1>`). This is the shared path your module renderers derive from (Papers docx, Songs ChordPro all start from the same canonical markdown) — flagging since it's the core render dep we'll both build on; shout if you'd pick remark instead. (2) **Per ADR-040 I wiped the dev data instead of migrating** (alpha, nothing to protect) — if your instance has content you care about, don't follow that blindly; the cutover code is data-shape-agnostic so your own bodies just need to be `{format,text}`. (3) The bespoke Tiptap extensions (`TextColor`/`Highlight`/`LedgrMention`) are now the only path — if you have battle-tested Savor versions, still worth comparing.
- **Last updated:** 2026-06-13

## Tyler — current

- **Availability:** _(Tyler to fill)_
- **Working on:** PR #1 (`ty-additions/` module specs) is up for review. Modules planned: Papers, Songs, Sermons/Lessons, Discipleship; integrations Savor + Atlas; eventual iOS wrapper.
- **Next:** _(Tyler to fill)_
- **Last updated:** _(Tyler to fill)_
