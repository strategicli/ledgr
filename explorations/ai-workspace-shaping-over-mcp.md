# Exploration: AI shapes the workspace over MCP (the orientation layer)

**Status:** parked (carried forward from Brandon's 2026-06-21 call, verified against main 2026-06-22). Not intent, not a decision. **CORE if it graduates** — it extends the machine/MCP contract — so both-agree + ADR with Tyler. Post-1.0; ADR-071 already landed the read/apply half.

## The aim Brandon named

**"The AI is FOR them."** A user shouldn't have to master Ledgr's Build surface. They should speak naturally ("set up my main toolbar," "make me a place to track sermons") and the model makes informed, Ledgr-correct moves: create types/properties/options, build views/queries, create dashboards/widgets, arrange nav. Today the MCP server can *file and read items* and *read* the config, but it can't *shape* the workspace.

## What's true on main today (verified 2026-06-22)

The MCP server lives in `src/lib/mcp/` (`tools.ts` = registry, `server.ts` = JSON-RPC dispatch) behind `POST /api/mcp`. **12 tools** (ADR-047 + ADR-071):

- **Item-level (the workspace's content):** `search_items`, `list_items`, `get_item`, `create_item`, `update_item` (carries `propertyPatch`), `relate_items`, `unrelate_items`, `run_view`, `apply_template`.
- **Config-level, but READ-ONLY:** `list_types`, `list_views`, `list_templates`.

So the gap is precise — every **write** tool is item-level; the config tools only read. Missing as MCP tools:

- **Create/edit a TYPE** (+ property schema / select options) — NOT BUILT.
- **Create/edit a saved VIEW** (query/filter) — NOT BUILT.
- **Create/edit a DASHBOARD + add WIDGETS** — NOT BUILT (MCP can't even *read* dashboards yet).
- **Arrange/configure NAV / settings** (`settings.navSlots`) — NOT BUILT.
- **`describe_workspace`** read-before-write tool — NOT BUILT.
- **A guide/orientation resource** — NOT BUILT. `initialize` advertises `capabilities: { tools: … }` only (`server.ts:68`); there are no `resources/list`/`resources/read` handlers. Orientation today is a single static `INSTRUCTIONS` string (`server.ts:30-45`) that only describes the item-level flow.

**The good news — the foundations are all there:**

- The validated libs Brandon's design leans on already exist and are battle-tested via the REST routes: `parseTypeInput`/`createType`/`updateType` (`src/lib/types.ts`), `parseViewInput`/`createView`/`updateView` (`src/lib/views.ts`), `parseDashboardInput`/`createDashboard`/`addWidget`/`updateWidget` (`src/lib/dashboards.ts` — its granular helpers even carry the comment "For callers that don't hold the full client widget state (MCP tools, scripts)"), and `parseSettings`/`updateSettings` + `navSlots` (`src/lib/settings.ts`). `src/lib/build-nav.ts` is the hardcoded source of truth for the Build sidebar + the destination-picker category.
- Every existing write tool is already "a thin wrapper over the same owner-scoped libs the REST API uses … so the MCP surface can never drift from the app's own contract" (`tools.ts` header). So the safety pattern Brandon wants is *already the house pattern* — it just hasn't been applied to types/views/dashboards/settings.
- Tool descriptions are already rich, multi-sentence, plain-text with worked examples (e.g. `apply_template`). That's the descriptive style Brandon wants — extending it is consistent.

## Brandon's design (the net-new part is the orientation layer)

Not pre-encoded intent enums. Three pieces:

1. **Primitive write tools over the validated libs.** `create_type` / `update_type`, `create_view` / `update_view`, `create_dashboard` / `add_widget`, `update_settings` (nav) — each a thin wrapper delegating to the existing `parse*` + `create*`/`update*` functions. **Safety lives in the parsers** (`parseSettings`, `parseTypeInput`, `parseViewInput`, `parseDashboardInput`, `parseWidget`), so the AI literally cannot persist an illegal config — same guarantee the REST routes already rely on.
2. **A rich plain-text picture per capability + a small stable guide resource.** Each tool's description explains what the thing is, where it lives, and what it's for (the existing description style). Plus one small, stable **guide** served as an MCP *resource* (requires adding a `resources` capability + `resources/list`/`resources/read` to `server.ts`) — the orientation a human gets from the Build sidebar, written down once.
3. **`describe_workspace` — read before write.** A tool that returns live state (from `build-nav.ts` + `settings` + types/views/dashboards) so the model sees the actual workspace before changing it.

**Why no enums:** clarify-and-suggest *falls out* of (the picture + live state), it doesn't need to be hand-encoded. Brandon's worked example: user says "here's what I want on my main toolbar" → the model, seeing from the guide that there's a rail and a floating bar and reading the current `navSlots`, asks "which toolbar — the rail or the floating bar? I'd suggest…". That clarification is emergent, not scripted.

## Constraints to honor if built

- **Deterministic by default, AI on purpose (rule 3):** the tools are deterministic primitives; the *model* deciding to call them is the deliberate, human-in-the-loop AI layer. Nothing auto-commits in a cron.
- **The machine/MCP contract is core (CLAUDE.md "Building together"):** additive tools + a resources capability are a contract change → both-agree + ADR with Tyler. Additive-only (the existing 12 tools stay unchanged) keeps the bar low, like ADR-071.
- **Owner-scope everything (rule 7):** every write tool wraps an owner-scoped lib, exactly as the item tools do.
- **Fast + cheap (rule 8):** `describe_workspace` is index-backed reads of config; no `body`.
- **Boring stack (rule 5):** no new dependency — the libs, the JSON-RPC server, and the description style all exist.

## Open questions

- **Scope the first slice.** Smallest useful cut: `describe_workspace` + `create_type`/`update_type` (the most-asked "make me a place to track X"). Views/dashboards/nav follow.
- **Guide as a resource vs. a fat INSTRUCTIONS string.** A resource is cleaner and cache-friendly but needs the `resources` capability wired into `server.ts`; a longer `INSTRUCTIONS` is zero-protocol-change but less structured. Lean resource.
- **How much live state does `describe_workspace` return** before it's too big for a prompt? Summaries + drill-down (the model can `list_types`/`list_views` for detail) vs. one fat snapshot.
- **Confirmation UX.** Track changes (TC1, shipped) already makes content edits undoable; config writes (a new type, a nav rearrange) have no revision history — does shaping need a confirm step or an undo path?

## Relationship to other parked work

- **ADR-071** — landed the read/apply half (`list_types`/`list_views`/`list_templates`, `relate`/`apply_template`). This is the *write/shape* half + the orientation layer on top.
- **`dashboard-widgets.md` / `flexible-surfaces.md`** — the surfaces the AI would shape; `add_widget` is the MCP counterpart to the AddWidgetMenu.
- **Track-changes (TC1, shipped) / the AI-editing exploration** (next_steps "Track changes") — that exploration deliberately leaned on Claude-over-MCP for *content* editing rather than an in-app sidebar; this extends the same MCP-as-the-AI-seam bet to *workspace* shaping.
