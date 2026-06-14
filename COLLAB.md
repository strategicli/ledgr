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
- **Working on:** **Phase 3, Tier 1 — the Build surface UX — DONE (2026-06-13, ADR-044, slice 33).** The Build surface (a standalone floating Work/Build toggle + a `/build` home) and the full **custom type & property builder** shipped: `src/lib/types.ts` registry store, `/api/types{,/[key]}`, `TypeBuilder` over `/build/types`, custom properties rendered + edited on the canvas, and the parked type/kind authoring UX (kind dropdown, data-driven opt-in quick capture, "Relate to…" rename). Migration **0008** adds `types.show_in_quick_capture`. (Phase M is also complete — ADR-040/041/043.)
- **Next:** **Phase 3, Tier 2 — templates** (workflow/wiki guided creation, then per-type item templates), building on the new type/property machinery. Claude/MCP layer + Notion migration are Tier 3.
- **Heads-up (Tyler) — slice 33 touched core (the `types` table + the type model); Brandon directed shipping it solo, same as M6. Two things for you:**
  - **The `types` table gained a `show_in_quick_capture` column (migration 0008)** and `property_schema` now has a concrete shape: an ordered **`PropertyDef[]`** = `{key, label, kind, options?}`, kinds `text|number|date|checkbox|url|select|multi_select` (parsed in `src/lib/types.ts`). Per-item values live in `items.properties`.
  - **The ADR-043 split is intact:** a user type is just a `types` row and falls back to the default markdown canvas (no `modules.ts` change). For your modules nothing changes — you still register a `ModuleManifest` *and* seed a `types` row (the DB owns label/icon/`property_schema`/enumeration; the registry owns canvas/format/exporters). New reusable bit: `src/components/build/CustomProperties.tsx` renders a type's `property_schema` editably on the default canvas — your module canvas can compose it or roll its own.
- **(Earlier heads-up, still relevant) the M6 boundary** — what you implement to add a module (Papers/Songs/…):
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
- **Working on:** **Papers module — DONE (2026-06-14, ADR-045).** Second workflow module after Songs. `paper` type, markdown-canonical; tabbed canvas (Quote Bank · Outline · Draft); deterministic MSM citation engine (Full/Short/Ibid) + click-to-cite footnotes; one-click MSM `.docx` export (ported from `ty-docs/msm-render.js`). All in `src/lib/papers/` + `src/components/paper-editor/` + `PaperCanvas`. `verify-papers.mts` 16/16; registry/canvas/songs verifiers, `tsc`, `next build`, eslint all green; `paper` type seeded.
- **Heads-up (Brandon):** two additive touches to shared files — `src/lib/modules/register.ts` (+`paperModule`) and `src/lib/module-wiring.tsx` (+`paper` canvas). Core types unchanged. **One thing to know:** the MSM `.docx` is binary, and `ExporterDef.render` returns a string, so I shipped it as a dedicated route (`GET /api/items/[id]/render-docx`) rather than widen the exporter contract — the core module contract is untouched (no ADR needed). New runtime dep: `docx`. If we ever want binary exporters as a first-class module slot, that's a core change for us to agree on later.
- **Next:** **Song import (PDF / chord chart → ChordPro)** — bulk-add my chord-chart library. Spec'd in `explorations/song-import.md` (deterministic text-parse, reviewed in the chord canvas; new dep `unpdf` when I build it). Then Sermons/Lessons, Discipleship; Savor/Atlas integrations; iOS wrapper.
- **Last updated:** 2026-06-14
