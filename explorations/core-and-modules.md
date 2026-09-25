# Core and modules: one codebase, many instances

**Status:** decided (ADR-272, 2026-09-24). This doc holds the reasoning and the stepped plan. `next_steps.md` carries the short "what's next" pointer; the per-step detail lives here so `next_steps.md` stays short.
**Trigger:** Brandon, 2026-09-24. Ledgr now has four to five real installs (Brandon, Tyler, Brandon's dad, Brandon's brother, plus people they have shown it to) and three visions for it: Brandon wants to keep extending it, his dad has his own ideas, Tyler wants it simple enough to hand to coworkers. The first idea on the table was a branch per person. This doc explains why that is the fork trap, and what to do instead.

---

## 1. The problem, restated

Two separate problems arrived together. This doc solves the first and names the second.

1. **Governance.** Three people want three different feature sets from one codebase. A branch per person diverges within weeks, and "have Claude pull Tyler's feature into my branch" is a manual merge that gets harder every time. Hudson forked into Jenkins, MySQL into MariaDB; neither pair ever came back together.
2. **Distribution.** Installing takes four account signups, ten environment variables and a Claude session (measured in `onboarding-and-multi-tenancy.md`). Nothing in this doc changes that. It is its own exploration.

**The realization that dissolves problem one:** the three visions do not disagree about core. Sixty days of git churn lands in MCP tools, canvases, API routes, the editor and sync. Nobody has been changing how items, relations, revisions or markdown bodies work. Tyler's "keep it simple" is a shorter default list of modules, not a different codebase. Brandon's dad's ideas are modules that default off for everyone else.

## 2. What the wider world does

- **Trunk-based development plus switches.** One branch, everyone merges often, work not everyone wants ships turned off. Google, Facebook and every large open-source project run one codebase for many audiences this way. Ledgr already has the trunk half (ADR-269). This adds the switch half.
- **Django `INSTALLED_APPS` is the closest match.** Every feature is an "app" folder with its own models, routes and admin pages. One config line per instance lists which apps are installed. All the code lives in one repo. Rails engines and Home Assistant integrations work the same way.
- **WordPress and Obsidian go one step further** to out-of-tree community plugins. That step costs a plugin host and a trust problem: a plugin in the process has full database access. Ledgr does not need that step for three related builders, and Next.js cannot load code at request time anyway (routes are compiled at build time). If an outside builder ever needs a plugin, the safe seam is already there: an MCP server or a webhook talking to Ledgr's API.
- **Core is defined by a fence, not a folder name.** Core is whatever modules may import from and never the reverse. Linux, VS Code and Django enforce that with tooling. For Ledgr the fence is one ESLint rule.

## 3. The model, in one paragraph

All module code lives in this repo and ships in every build. Each module has a manifest that registers it onto core (the registry at `src/lib/modules.ts` already exists, ADR-043). A per-owner switch, `settings.modules`, says which modules are on. A Modules page under Build shows every module with a toggle; flipping one takes effect on the next page load, no rebuild. A rebuild happens only when new module code merges to `main`, which already triggers a deploy today. Each module declares `enabledByDefault`, so Tyler's simple install is the same code with a shorter default list. Disabling a module never touches data: a `song` with the songs module off falls back to the default canvas, a task with Todoist off keeps its `todoist_id`.

## 4. What is core

Core is the code every module may import from. Modules never import each other's internals and core never imports a module. The list, by directory:

| Area | Where |
|---|---|
| The item model and its CRUD | `src/db/schema.ts` (the `users`, `types`, `items`, `relations`, `revisions`, `views`, `dashboards`, `templates`, `attachments`, `job_state`, `error_log`, `api_credentials` tables), `src/lib/items.ts`, `item-mutations.ts`, `relations*.ts`, `revisions*.ts`, `types.ts`, `views*.ts`, `dashboards*.ts`, `templates/` |
| The body and its dialect | `src/lib/body*.ts`, `markdown-render.ts`, `body-text.ts`, `print-html.ts`, `src/components/markdown-editor/` |
| Search, settings, owner scope, auth | `src/lib/search*.ts`, `settings.ts`, `owner.ts`, `auth/`, `src/proxy.ts` |
| The module registry | `src/lib/modules.ts` (pure), `src/lib/module-wiring.tsx` (module canvases) and `src/lib/module-panels.tsx` (a module's panel on a core canvas), the only files allowed to import a module; `src/lib/modules/gate.ts` turns a disabled module's routes away |
| The shells and default canvases | `src/app/layout.tsx`, `src/components/nav/`, `src/lib/build-nav.ts`, `src/app/items/[id]/`, `src/components/canvas/{ItemCanvas,MarkdownCanvas,LongformCanvas,TaskCanvas,EventCanvas,WidgetCanvas}.tsx` |
| Storage and the offline fallback | `src/lib/storage/`, the export *engine* in `src/lib/export/engine.ts` (Save Offline is Sunday-proof, Principle 4; the OneDrive *target* is a module) |
| Sync infrastructure | `src/lib/sync/`, the sync spine triggers, `supervisor/` (the process runner; the job *catalog* it reads becomes registry-fed in step 3) |
| Scheduled-job plumbing | `src/lib/job-owners*.ts`, `local-jobs.ts`, `src/app/api/machine/` (the door), `.github/workflows/`, `vercel.json` |
| The MCP and REST doors | `src/lib/mcp/{server,protocol,owner}.ts`, `src/app/api/mcp`, `src/app/api/oauth`, `src/lib/api.ts`, `src/lib/machine/`. The doors are core; the *tools* behind them are contributed by modules |

Everything not in that table is a module or will become one. The five system types (task, event, note, link, person) plus project, milestone, tag, unmarked and file stay in `coreModule`.

## 5. The module list

Ordered easiest-first for step 4. "Chokepoints" counts the shared files a module has to be threaded through today; the hand-lists in step 3 retire most of them.

| Module | Today | Depends on | Chokepoints |
|---|---|---|---|
| songs, papers, mindmap, files | already registered | none | 0 |
| ~~themes~~ | stays core (see below) | | |
| ~~sharing~~ | moved: `src/modules/sharing/` (manifest, `lib/share.ts`, `lib/mcp-tools.ts`, the Share control), routes gated | mcp door | none left |
| youtube-transcripts | `lib/youtube/`, toggle in settings | jobs, link type | item-mutations (on-create hook), jobs |
| todoist | `lib/todoist/`, 2 routes, 1 job | jobs | proxy (webhook), jobs, health |
| ~~email-capture~~ | moved: `src/modules/email-capture/` (`lib/` = the Graph mail source, importer, HTML to markdown), 3 routes gated, job gated | jobs | none left |
| ~~calendar-sync~~ | moved: `src/modules/calendar-sync/` (`lib/sync.ts`, `lib/graph-source.ts`, the dormant `lib/matchers/`), 4 routes gated, job gated. The event views, the calendar-cache readers (`lib/calendar/feed.ts`, `overlay.ts`), template match rules and the person suggester stay core: an owner with no Microsoft account still has events | jobs, event type | none left |
| ~~onedrive-export~~ | moved: `src/modules/onedrive-export/` (the OneDrive target, health check); the engine stays core | export engine, jobs | none left |
| ~~relatedness~~ | moved: `src/modules/relatedness/` (manifest, `lib/` scorer + job + Loose Ends, the Discover and Explore components); Loose Ends nav from the manifest; canvases reach Discover and the Explore page through `module-panels.tsx`; `related-lens/prefs/views` stay core (explicit relations) | jobs | none left |
| ~~snapshots~~ | moved: `src/modules/snapshots/` (lib, components); keeps its per-install switch too | supervisor | none left |
| passages | `lib/passages/`, `passage_refs`, `/passage/[ref]` | none | item-mutations (on-save hook) |
| ~~desk~~ | moved: `src/modules/desk/` (manifest, `lib/` layout + persistence + send + workspaces, the components); `/desk` gated; the send menu is a layout shell panel (`module-panels.tsx` `shellPanels`); the editor reaches it through core's `lib/inline-ref-menu`; `settings.deskWorkspaces` is an opaque slot the module validates; the `/desk` Work nav destination hides while off | editor | none left |
| ai-memory | `lib/memory.ts`, `memory` type, 2 MCP tools, `/build/memory` | mcp door | tools gating, build-nav (already `gatedBy`), agent context |
| live-context | `active_context` table, 2 MCP tools | mcp door | tools gating, ItemCanvas tracker |
| agent | `lib/agent/`, 4 tables, 11 routes, sidebar | mcp tools, ai-memory (optional) | layout, settings, jobs (purge) |
| mcp-tools (per family) | 16 files under `lib/mcp/tools/` | mcp door | `tools/index.ts`, `agent/tools.ts` tiers |
| notification-center | `NOTIFICATION_CENTER_ENABLED = false` | push | nav |

**Why themes stays core (step 4, 2026-09-24).** Themes has no routes, jobs, tools or data of its own, and nothing to turn off: "themes off" could only mean "everyone sees Dark", which is the Dark button that is already there. The theme is also read by core, not by a feature: `layout.tsx` sets `data-theme` and the title-bar color, the print view and every share link open in it, and `settings.ts` validates it. A module switch would make each of those ask the registry before reading one setting, for no gain to the owner. So the theme sits with Display density and Section style as an ordinary core preference on `/settings`.

**Known leaks the fence will catch once code moves** (core importing feature code today): `src/lib/health.ts` imports nine feature areas; `item-mutations.ts` calls passages and YouTube directly; `layout.tsx` mounts the agent panel and the Desk menu unconditionally; `settings.ts` imports `desk/layout` and `job-owners`. These are the debt step 3 retires, and the ESLint rule is written so it passes today and starts failing as each module moves under `src/modules/`.

## 6. The stepped plan

Each step is one PR or a small batch, reversible, and leaves the app working for every install. The order is chosen so the switch exists before anything moves.

**Step 0. Definitions and the fence** (this PR). Core list above; `## Core and modules` section in `CLAUDE.md`; ESLint `no-restricted-imports` so files in core paths cannot import `@/modules/**`; ADR-272; this plan.

**Step 1. The switch.** `settings.modules: Record<string, boolean>` in `settings.ts`. `isModuleEnabled(id, ownerId)` reads it, falling back to `enabledByDefault`. New Build page `/build/modules` (MAINTAIN group) listing every registered module with a toggle, its description, and what it depends on. When a type's module is off: hide the type from the new-item menu, quick capture, nav type lists and `list_types`; existing items keep rendering on the default canvas (already designed, ADR-043 §6). Extend `verify-module-registry.mts` with the settings path. Guide entry (ADR-189).

**Step 2. Fold the existing switches onto the Modules page.** `aiMemoryEnabled`, `liveContextEnabled`, `agent.enabled`, `youtubeTranscripts.enabled`, `NOTIFICATION_CENTER_ENABLED` become `settings.modules[id]` with a one-time read of the old key so nobody's setting flips. The settings form keeps the per-module options (model choice, prompt items) but the on/off lives in one place. Per-machine job_state switches (`snapshots:enabled`, `sync:mode`) stay where they are, listed on the page as "per install" with a link.

**Step 3. Manifest slots, one hand-list per PR.** Add optional fields to `ModuleManifest` and make each hand-written list read from the registry instead. Order:
1. `nav`: Build sidebar entries. `build-nav.ts` merges module entries; `gatedBy` becomes `module`.
2. `publicPaths`: `proxy.ts` public-route list gains module-declared paths (Todoist webhook, share, ICS).
3. `jobs`: one JSON catalog (`supervisor/jobs.json` or generated) read by both `supervisor/lib.mjs` and `job-owners.ts`, replacing `LOCAL_JOBS` and `MOVABLE_JOBS`. A job whose module is off does not run and shows as "off (module)" on `/build/jobs`. The supervisor is plain Node, so it reads JSON, not the TypeScript manifest.
4. `mcpTools`: each tool family declares its module; `tools/index.ts` filters by enabled modules, replacing the two hardcoded name sets. `TOOL_TIERS` in `agent/tools.ts` moves onto the tool defs.
5. `healthCheck`: `health.ts` iterates enabled modules' checks instead of importing nine areas.
6. `hooks.onSave` / `hooks.onCreate`: `item-mutations.ts` calls registered hooks; passages and YouTube register theirs.
7. `settingsSchema` and `requires`: the Modules page refuses to turn off a module another enabled module requires, and shows the module's own options.

**Step 4. Move code under `src/modules/<id>/`, one module per PR, easiest first** (table order in §5). Each move: create `src/modules/<id>/manifest.ts`, move the `lib/` and `components/` code, leave route files under `src/app` (Next.js requires it) but have the manifest name them and a verify script confirm they match, wrap UI entry points in `next/dynamic` behind the switch, run the fence. Routes for a disabled module return 404 through one shared guard so a stray webhook cannot wake a module the owner turned off.

**Step 5. Lazy-load the shells.** `layout.tsx` and `NavShell.tsx` mount module UI (agent panel, Desk menu, sync pill, capture modal extras) through the registry and `next/dynamic`, so a disabled module contributes zero bytes to the page bundle. Measure the per-page bundle before and after with `next build` output.

**Step 6. Instance defaults.** `enabledByDefault` reviewed per module with Tyler. A new install starts with the short list. Done when Tyler's instance is "the same build, fewer modules on," and a feature Brandon's dad asked for can merge to `main` default-off without anyone else seeing it.

**Not in this plan:** separate repos or npm packages for modules (revisit only when an outside builder needs one), a plugin host, and the install/onboarding problem (`onboarding-and-multi-tenancy.md`).

## 7. Does a big module list slow the app down?

Four costs, honestly weighed for "120 modules, 10 on":

- **Build time: the one real cost.** Every module compiles in every build. Vercel Hobby's build quota (runbook §1j-1) is the ceiling; 120 modules would roughly triple today's build. Mitigation is CI caching and fewer, larger PRs (already the cadence).
- **Page bundle: near zero once step 5 lands.** Next.js splits code per route and `next/dynamic` splits per component. A module that is off and lazy-loaded ships nothing to the browser. Today the opposite is true (the agent panel and Desk menu are in every page), so this work makes the app faster for anyone with them off.
- **Server: near zero.** Vercel bundles a function per route; an unused route is never loaded. On the local supervisor, Node loads a module's code only when a request reaches it.
- **Database: negligible.** A disabled module's tables exist and stay empty. Migrations still run on every install (additive, so safe). A settings read is already cached per request, so the toggle check is free.
- **The real cost is human:** CI minutes, review time, and keeping 120 things working. That is why the fence matters more than the folder layout. A module that only touches its own folder and the registry cannot break another one.
