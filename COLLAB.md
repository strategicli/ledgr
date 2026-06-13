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
- **Working on:** **🎉 Phase M is COMPLETE** (the Markdown-epoch foundation rework). M1–M3 markdown cutover (ADR-040), M5 per-type canvas seam (ADR-041), **M6 — the module-registration boundary — DONE (2026-06-13, ADR-043).**
- **Next:** **Phase 3, Tier 1 — the Build surface UX** (Work/Build toggle, then the custom type & property builder + the type/kind authoring UX). The Claude/MCP layer and Notion migration are Tier 3 (later).
- **Heads-up (Tyler) — the M6 boundary is the big one for you (please read):** **The module-registration API M5 deferred is now built (ADR-043). This is a CORE change; Brandon directed shipping it solo without waiting on your sign-off — it's designed against your PR #1 specs (esp. Papers), so react if anything doesn't fit your modules.** What you implement to add a module (Papers/Songs/…):
  - **`src/lib/modules.ts`** (pure, the contract). A module is a `ModuleManifest = { id, label, enabledByDefault, types: ModuleTypeDef[], exporters: ExporterDef[], integration?: IntegrationDef }`. `ModuleTypeDef = { key, label, canonicalFormat, canvasId, icon? }` — `canonicalFormat` is **your decision #1, accepted**: a type declares its own canonical body format (`"chordpro"` for Songs, `"markdown"` for Papers), resolved by `canonicalFormatForType`. `ExporterDef = { id, label, forType, fileExtension, render }` — `render` is your deterministic markdown→docx / ChordPro→chart (heavy renderers live in *your* module file, never imported by core's pure registry, so keep `pandoc`/`docx` there). `IntegrationDef = { id, label, direction }` for Savor-pull / PCO-push.
  - **`src/lib/module-wiring.tsx`** (impure) maps your `canvasId` → your React canvas component. Add yours alongside `markdown`/`link`.
  - **Register** with `registerModule(manifest)`; resolvers (`canvasIdForType`, `canonicalFormatForType`, `exportersForType`, `moduleForType`) then dispatch to it. **Core is itself the first module** (`coreModule`), so your module sits beside core, not bolted on.
  - **Per-user enable** is the `isModuleEnabled(moduleId, ownerId?)` seam — default-on today, owner-threaded so the per-instance enable flip is a later table lookup, no call-site change.
  - **Worked example:** `referenceModule` (exported from `modules.ts`) shows a full four-slot manifest; `scripts/verify-module-registry.mts` shows it resolving. Copy that shape.
  - **Scope (ADR-042):** the foundation delivered the *capability*; **building the modules is your lane** ("module internals — move fast, solo"). Adding a type also means a `types` DB row (see `scripts/seed.mjs`) — the registry owns *code behavior*, the DB still owns label/icon enumeration.
  - Still current: **markdown-it** is the core server-side markdown→HTML path (`src/lib/markdown-render.ts`, `html:true`, `ledgr://`→`.mention`, heading-shift) your docx/chart renderers derive from; bespoke Tiptap `TextColor`/`Highlight`/`LedgrMention` are the only editor path (compare against your Savor versions).
- **Last updated:** 2026-06-13

## Tyler — current

- **Availability:** _(Tyler to fill)_
- **Working on:** PR #1 (`ty-additions/` module specs) is up for review. Modules planned: Papers, Songs, Sermons/Lessons, Discipleship; integrations Savor + Atlas; eventual iOS wrapper.
- **Next:** _(Tyler to fill)_
- **Last updated:** _(Tyler to fill)_
