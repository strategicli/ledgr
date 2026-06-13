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
- **Working on:** Foundation rework (Phase M). **M1–M3 done (markdown cutover, ADR-040). M5 — the per-type canvas seam — DONE (2026-06-13, ADR-041).** `ItemCanvas` split into a thin **shell** (load + guards + breadcrumb → resolves the type's canvas) and the default **`MarkdownCanvas`**. Pure policy `canvasIdForType` in `src/lib/canvas-registry.ts` (default `"markdown"`), wiring `Record` in the shell, proof = `link` → `LinkCanvas`. `tsc` + `next build` clean; 16/16 in `verify-canvas-seam.mts`; in-browser confirmed.
- **Next:** **M6 — the module-registration boundary** (the *capability*, not a module — ADR-042): turn the hardcoded wiring `Record` into a real boundary where a module contributes `{type, canvas, exporters, integration}`. Designed against your Papers/Songs specs + a minimal proof; **the modules themselves are yours to build on top, not part of the foundation.**
- **Heads-up (Tyler):** (1) **The per-type canvas seam is in (ADR-041) — this is your decision #2, accepted.** A type renders through its own canvas; absent one it gets the default markdown canvas, unchanged. Shape: `src/lib/canvas-registry.ts` holds the **pure policy** (`canvasIdForType`, default `"markdown"`, no component imports so it's verify-testable); the **wiring** (canvas id → component) is a `Record` in `ItemCanvas` with a `?? MarkdownCanvas` fallback; a canvas gets `{item, ownerId, variant}` and can replace the surface or compose `<MarkdownCanvas/>` (see `LinkCanvas` — the chord-grid / paper-workspace pattern). **I deliberately did NOT finalize the module-registration API — that's M6, to build with your Papers module so it fits the real path.** When you pick up a module canvas, shout: M6 is where the hardcoded `Record` becomes "a module contributes its canvas," and I'd rather co-design that with a real module in hand than guess. (2) **markdown-it is the core server-side markdown→HTML renderer** (`src/lib/markdown-render.ts`, `html:true`, `ledgr://`→`.mention`, heading-shift) — the shared path your Papers docx / Songs ChordPro renderers derive from. (3) Bespoke Tiptap `TextColor`/`Highlight`/`LedgrMention` are the only editor path — compare against your Savor versions if you have battle-tested ones. (4) **Scope call (ADR-042):** adding the modules (Papers, Songs, Sermons/Lessons, Discipleship) is **not** part of the foundational/core build — Phase M delivers the *capability* (M5 canvas seam + M6 registration boundary) and the modules get built on top of it afterward, your lane ("module internals — move fast, solo"). So M6 designs the boundary *around* your specs but doesn't ship a module; bring the Papers requirements when we lock the boundary.
- **Last updated:** 2026-06-13

## Tyler — current

- **Availability:** _(Tyler to fill)_
- **Working on:** PR #1 (`ty-additions/` module specs) is up for review. Modules planned: Papers, Songs, Sermons/Lessons, Discipleship; integrations Savor + Atlas; eventual iOS wrapper.
- **Next:** _(Tyler to fill)_
- **Last updated:** _(Tyler to fill)_
