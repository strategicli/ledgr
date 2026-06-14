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
- **Working on:** **Phase 3, Tier 3 — the Claude layer, started: the MCP server is DONE (2026-06-13, ADR-047, slice 36).** (Tier 2 — templates — ADR-045/046; Tier 1 — Build surface + type/property builder — ADR-044/slice 33; Phase M — ADR-040/041/043.)
- **Next:** the rest of Tier 3 — **scheduled Claude tasks** (morning briefing / weekly health check over the same MCP token), then the **selective Notion migration**. Then Tier 4 (planning rhythms + parked items).
- **🔴 Heads-up (Tyler) — Tier 3 touched CORE: the MCP/API contract (ADR-047). Shipped solo per Brandon's Tier direction (same waiver as M6/slices 33–35). What it means for you:**
  - **The MCP server is `POST /api/mcp`** — hand-rolled Streamable HTTP, **no `@modelcontextprotocol/sdk` dependency** (Principle 5; the ADR-034 web-push precedent). Pure protocol in `src/lib/mcp/protocol.ts`, dispatcher in `server.ts`, tools in `tools.ts`, owner in `owner.ts`; the route is a thin shell. Stateless, Clerk-bypassed, gated by the **existing machine-token scheme (ADR-004) with a new `mcp` scope** — no token-format change. If you stand up your own instance, the same hand-roll is the pattern; compare against your Savor MCP if you have one.
  - **The six tools are thin wrappers over the core libs** (`search`/`views`/`items`/`relations`/`types`), so they stay owner-scoped and can't drift from the REST contract. **When you add a module type, its items get `search_items`/`list_items`/`get_item`/`create_item`/`update_item`/`list_types` for free** — the tools key off `items.type` + the type registry, no per-module MCP work. (A module-specific MCP tool, e.g. "render this song to ChordPro," would be a later extension to `tools.ts`.) The "make me a workflow" MCP path (Tier 3) will call the slice-35 `/api/build/structures` endpoint.
  - **Refactor you'll see:** `parseItemPayload`/`asUuid` moved from `@/lib/api` to a new **pure `@/lib/item-input.ts`** (api.ts re-exports them, so existing imports are unchanged) — needed because `api.ts` pulls `next/server` + the Clerk chain, which can't load in a node verify script. Import item-input directly from any node-context code (tools, verify scripts).
- **Heads-up (Tyler) — Tier 2 added one core thing (a new `templates` table) + a non-core view-engine widening; Brandon directed shipping Tier 2 solo, same waiver as M6/slice 33. For you:**
  - **New `templates` table (migration 0009):** owner-scoped item templates, `{id, owner_id, type → types.key ON DELETE cascade, name, body jsonb ({format,text}), property_defaults jsonb, created_at}`. `src/lib/templates.ts` is the store; `createItemFromTemplate` just calls `createItem` with the body + defaults pre-filled (`inbox:false`). The Phase-2 meeting-prep agenda is the forerunner — your module types get item templates for free (no module-side work; it's owner data over the existing type). `TemplateBuilder` reuses the Tiptap editor in *controlled* mode (`LazyMarkdownEditor` + stable `initialMarkdown` + `onChange`, `itemId` optional) — handy if a module canvas ever needs an editor not bound to an item.
  - **`ViewGrouping` widened (non-core, views):** a board can now group by a custom select property — `{ propertyKey: string }` alongside `{ field }`. The pure grouping logic now lives in **`src/lib/view-grouping.ts`** (`groupValueFor`/`orderedGroups`/`dueBucket`, node-testable). Column order comes from the type's option list, resolved by the view page. Relevant if a module ships a stage-style type — the board "just works" via the generated `{propertyKey}` view.
  - **Workflows/wikis are generators, not entities:** `/build/new` → `POST /api/build/structures` → `src/lib/structure-templates.ts` emits a type + views (a workflow = a `stage` select + a board grouped by it). The MCP "make me a workflow" path (Tier 3) can call this same endpoint. "Surface on Work" = pin the view (dashboard widget); **nav-slot config is still the `NAV_SLOTS` stand-in** (a later slice).
- **(slice 33 heads-up, still relevant) Tier 1 touched core (the `types` table + the type model). Two things:**
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
- **Last updated:** 2026-06-13 (Tier 3 started — the MCP server, ADR-047, slice 36)

## Tyler — current

- **Availability:** _(Tyler to fill)_
- **Working on:** PR #1 (`ty-additions/` module specs) is up for review. Modules planned: Papers, Songs, Sermons/Lessons, Discipleship; integrations Savor + Atlas; eventual iOS wrapper.
- **Next:** _(Tyler to fill)_
- **Last updated:** _(Tyler to fill)_
