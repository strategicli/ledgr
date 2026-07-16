# Exploration: local desktop build (Windows + macOS, DB-canonical, one codebase)

**Status:** ACCEPTED (Tyler + Brandon — Brandon signed off per Tyler, 2026-07-15). Build underway on branch `feat/desktop-electron-pglite`; not merged to `main` (Brandon's prod deploy trigger) without an explicit go.
**What this doc is:** a concrete design for a packageable local build, graduating the parked `local-first-split.md` for one specific direction. It is CORE (touches the provider seams, the DB layer, and rule #1), so nothing here merges until Brandon agrees and it lands as an ADR. Companion: `storage-cost-offload.md` (the two share the storage seam).

> **Relationship to `local-first-split.md`.** That doc framed three options (A: read locally / write through the API; B: inbox pattern; C: true files-canonical). This supersedes its framing for the chosen path, which is **none of those three**: it is a full local run of the whole app with an **embedded, canonical local Postgres**, closest in spirit to the 6.14 meeting's "the app *and* the data are user-owned, this thing can't be taken." Rule #1 (DB canonical) is preserved. Option C (files canonical) stays rejected, for the same reasons: it fights everything-is-an-item (relations, backlinks, query views), FTS, and boring-stack.

## The goal, stated plainly

A **cross-platform desktop app (Windows + macOS)** that runs the entire Ledgr feature set locally, with no Vercel, Neon, Clerk, or R2 in the loop. The user owns both the database (on their disk) and a markdown **vault** folder that Obsidian and Claude Code can read directly. It is Obsidian-*like* in feel (local, offline, yours, a readable vault on disk), not in architecture (the DB is still canonical; the vault is a one-way export, exactly like the OneDrive export today).

The guiding constraint (Tyler, 2026-07-15): **the easiest possible path to a Windows + Mac desktop app, ASAP, reusing the code we already have, and with no bundled local server.** That resolves the shell to Electron running the DB + domain logic in its Node **main process** (the window talks to it over in-process messaging, not HTTP), and PGlite for the embedded DB (confirmed by a spike, §2a): fewest moving parts, one build config for both OSes, and maximal reuse of the domain logic. The one real rework it implies is moving data-fetching from the server to the client (see §3), which is the honest cost of "no server."

Three hard requirements from the ask:

1. **The cloud version stays viable.** Both keep shipping.
2. **Features stay in sync across all apps.** Anything added to one appears in the others without a manual port.
3. **Windows and Mac from day one** (not Mac-first).

All three are answered by the same decision: **one shared codebase, multiple runtime targets** (below). This is not a fork, and not a second implementation.

## Mostly packaging, plus one real rework

The architecture already put the three cloud dependencies behind seams, and a 2026-06-13 audit (ADR-036) confirmed no gaps, enforced by `scripts/verify-provider-seams.mts`. So the backend swaps are mostly a packaging exercise. The exception, forced by "no local server," is the **rendering layer**: the app is server-rendered today, so the desktop target has to become client-rendered with its data coming over IPC instead of the server (§3). That is the one part that is a rework, not a swap. The current seam state:

- **Auth** is reached only through `authProvider.getCurrentUser()`, selected in one place (`src/lib/auth/index.ts`). `@clerk/nextjs` is confined to four files. A `devAuthProvider(email)` already proves the single-user shape (ADR-006).
- **Storage** is the `StorageProvider` interface (`src/lib/storage/types.ts`); the R2 client is confined to `src/lib/storage/r2.ts`. The interface comment already names "a future local build can swap in a filesystem provider."
- **Scheduler** is the convention "authenticated HTTP call to a `/api/machine/*` endpoint" (18 routes, each verifying its own token via `verifyMachineToken`). With no local server the desktop target can't `curl` these, so it calls the underlying job functions in-process instead (§2d).
- **MCP** is an in-app HTTP endpoint (`/api/mcp`), so it works against localhost with no separate binary. Tyler's existing mcp-remote setup is the reference.

The one real coupling the audit understated is the **DB driver** (see below). Everything else is additive: a local build adds *new implementations behind existing interfaces*, it does not change an interface.

## The design

### 1. One shared codebase, multiple runtime targets

No fork, no divergent repo. Cloud vs desktop is chosen at runtime by the provider seams that already exist, using the exact pattern `src/lib/auth/index.ts` calls "the one place the active provider is chosen." A single local flag (proposed: `LEDGR_LOCAL=1`) selects the local driver, local auth, filesystem storage, and local scheduler. A feature written once flows to every target because they all run the same `src/`. **Parity is structural, not a discipline anyone has to remember.** The desktop shell (below) is a thin wrapper package in the same repo, not a copy of the app.

### 2. The four seam swaps (behind the existing interfaces)

**a. DB driver — the one place with real work.** `getDb()` in `src/db/index.ts` currently hard-imports `neon()` from `@neondatabase/serverless` and `drizzle-orm/neon-http`. This is the coupling runbook §8 currently understates: it says the DB is "already portable, a `DATABASE_URL` change," but the Neon HTTP driver will not talk to a non-Neon Postgres, so the *driver import itself* must branch. Proposed shape (mirroring the auth pattern): select the driver by env, local uses an embedded Postgres.

  - **Decided: PGlite** (Tyler, 2026-07-15), ElectricSQL's WASM Postgres, in-process, persists to a local directory. Drizzle ships a `drizzle-orm/pglite` driver. Decisive for the "easiest cross-platform" goal: the app *ships the database* as one WASM artifact, zero install, no port, no daemon lifecycle, and **no per-OS binary to bundle** (it runs identically on Windows and Mac). This is what makes it feel like Obsidian rather than "install Postgres first."
  - **Make-or-break spike: PASSED (2026-07-15).** Ledgr leans on advanced Postgres — `items.search` is a `GENERATED ALWAYS AS (... setweight(...) || jsonb_to_tsvector(...)) STORED` tsvector with a GIN index, and `pg_trgm` (migration 0004) powers fuzzy match. A spike ran Ledgr's **real 46-migration chain against PGlite 0.5.4 (PostgreSQL 18.3)**: all 46 applied clean; the generated `search` column exists (`is_generated=ALWAYS`) with its GIN index; FTS matches on body **and** on `jsonb_to_tsvector` properties; `pg_trgm` `similarity()`/fuzzy `%`/trigram GIN all work. So this is real Postgres, and our schema is supported. (Spike script preserved in the session scratchpad, `pglite-spike/spike.mjs`.)
  - **Fallback (now unlikely): native Postgres binary.** Only if a *future* migration introduces something PGlite can't do. It would mean bundling a per-OS binary + initdb + start/stop lifecycle (heavier, two platform binaries), so it stays the escape hatch, not the plan. Docker is rejected for a consumer desktop app (install friction).
  - **Remaining minor checks (not blockers):** exercise the `drizzle-orm/pglite` driver with our query patterns (the spike used raw SQL), filesystem persistence in the Electron main process (the spike used in-memory), and a rough perf pass at Brandon's data size (~187 MB).

**b. Auth.** Add a real `localAuthProvider` returning the single owner, selected on `LEDGR_LOCAL` rather than the dev stand-in's `NODE_ENV=development` gate. The shape is already proven by `devAuthProvider`; runbook §8 estimates "~10 lines."

**c. Storage.** Add a `FilesystemStorageProvider` implementing `StorageProvider`, running in the main process. The interface is presigned-PUT-shaped (browser PUTs bytes to a URL), and local disk has no presign concept and (with no server) no local HTTP route to PUT to. So an upload goes over **IPC**: the window hands the bytes to the main process, which writes them under the app data dir; `publicUrl` returns a `file://` (or a registered custom-protocol) URL the window can load directly. `putObject`/`deleteObject` map to disk writes/unlinks. The DB + attachments live under the app data dir (e.g. `~/Library/Application Support/Ledgr/` on Mac, `%APPDATA%\Ledgr\` on Windows); the readable vault under a user-visible folder (e.g. `~/LedgrVault/`).

**d. Scheduler.** No local server means no local `/api/machine/*` calls. Instead a scheduler in the main process (node-cron or an interval loop) calls the **same job functions** the machine endpoints wrap, directly in-process. This asks for a small refactor: a job's logic should be a plain function that both its route handler (cloud) and the local scheduler (desktop) call, where today some job logic lives inside the route handler. The cloud-only jobs (`calendar-sync`, `email-import`, `todoist-sync`) disable per the per-user enable model; `export`, `purge`, `roll-overdue`, `relatedness`, and the notification jobs run locally and are the ones that matter offline.

### 3. The desktop shell: Electron, no local server (decided)

No bundled local server (a Node/Next server listening on a port). That's the right call: a subprocess to supervise, a port to allocate, startup latency, and on Windows it can trip antivirus/firewall prompts for "an app listening on a port." So the desktop app runs with **no HTTP server at all**. Electron is still the shell (Node-native, and `electron-builder` targets **Windows + macOS from one config**). Its two halves do the work directly:

- **Main process (Node):** holds the embedded database and Ledgr's domain logic (`src/lib/*`), which is already Node code and so runs essentially as-is. This is what makes this shape reuse the most existing code.
- **Renderer (the window):** the UI. It never touches the database; when it needs data it calls the main process over Electron **IPC** (in-process messaging, no HTTP, no port), the main process runs the query via `src/lib`, and hands the result back.

**The honest cost — this is where "no server" isn't free.** The app is server-rendered today (App Router server components + `/api/*` routes do the data work on the server). With no server, the window must be **client-rendered**: a static UI build whose data-fetching goes through IPC instead of server components / `fetch('/api/...')`. Converting the data-fetching from server-side to client-side-over-IPC is the real work item; the domain logic underneath is reused unchanged. Keeping the DB + `src/lib` in the Node main process is exactly what confines the rework to the fetching layer.

**The data-access seam (the linchpin of parity).** Introduce one client-side data-access layer that the UI calls, with two implementations behind it: **IPC** (desktop) and **HTTP `/api/*`** (cloud). The IPC handlers and the API routes both become thin wrappers over the same `src/lib` functions. Parity then lives where it is strongest, shared domain logic + shared components, while each target's fetching boundary differs. The cloud app stays server-backed (it must; you cannot expose a DB to a browser over the open internet).

**Bundle size** (Electron ships Chromium) is accepted, the same tradeoff Obsidian/VS Code/Notion take. **Tauri** stays the noted alternative (smaller, native WebView); it fits a no-server client-rendered app about as well as Electron, the difference being Rust vs Node for the main-process side, so it's revisitable if bundle size ever bites. The shell lives in a **`desktop/` package** in the same repo, not a fork.

**Start-easiest posture (Tyler, 2026-07-15):** take this Electron + IPC path because it reuses the most code with the least surprise; **Option 2 (DB + logic inside the window itself via PGlite-in-browser) is the recorded escape hatch** if a Node-only dependency wall or a future browser/mobile target makes the in-window approach worth its higher upfront cost. Not a one-way door.

**No-server de-risking order:** stand up the `desktop/` Electron package rendering one small slice of the client UI against a real IPC call into the main process backed by a local PGlite. That proves the whole no-server data path end to end (window → IPC → `src/lib` → PGlite) on Windows + Mac early, before widening coverage screen by screen.

### 4. The Obsidian feel: the vault

Point the existing markdown + YAML frontmatter export (PRD §5.4, the same machinery as the OneDrive export) at a local `~/LedgrVault` folder through the filesystem storage/export path. Obsidian opens that folder as a vault; Claude Code reads it directly with no MCP in the loop (the "unfettered Claude reads everything" win from `local-first-split.md`). **Edits made in Obsidian are not synced back** (rule #1: the DB is canonical, the vault is one-way). That boundary is the accepted design, not a limitation to fix later; it is what keeps this out of option C's sync-engine swamp.

## What each build looks like

```
one repo (src/ shared: domain logic + components)
  ├─ cloud target    server-rendered; UI → /api/* (HTTP) → src/lib → Neon
  │                  Clerk auth · R2 storage · Vercel cron + GH Actions
  └─ desktop target  Electron, Win+Mac, NO HTTP server
     window (client-rendered UI) ──IPC──► main process (Node)
                                            └─ src/lib → PGlite (local DB file)
                                            └─ FS storage · local auth · in-process cron
     + vault one-way export (Obsidian + Claude read it)
```

The desktop target is one Electron `desktop/` package that builds for Windows and macOS from a single config. "Multiple runtime targets" already describes reality today: Brandon's cloud instance and Tyler's cloud instance run the same `src/` against different backends. Desktop is one more target, not a new codebase.

## Open items (carried into the roadmap, not resolved here)

1. ~~**PGlite feature spike**~~ **DONE (2026-07-15): PASSED.** All 46 migrations apply on PGlite 0.5.4 / PostgreSQL 18.3; generated `search` tsvector STORED column + GIN + `jsonb_to_tsvector` + `pg_trgm` (similarity/fuzzy/trigram-GIN) all confirmed working. Native Postgres is no longer the likely path. (See §2a; script in `pglite-spike/spike.mjs`.)
2. **Round-trip export prototype** (the cheap test `local-first-split.md` prescribed): export → open the vault in Obsidian → confirm it renders and reads cleanly before investing in packaging.
3. ~~**Size of the client-rendering rework**~~ **DONE (2026-07-15): audited, size = L** (M if auth is scoped as its own workstream). See the audit section below.
4. **Integrations off-switch**: confirm the per-user enable model cleanly disables Graph/Todoist/Web Push in a local build (each already has a stub used in verification, per runbook §8).
5. **Code signing / notarization**: Apple notarization (Mac) + Authenticode (Windows) are standard `electron-builder` steps but each needs a cert and a little setup; not a blocker, just real work to budget.

Resolved by Tyler (2026-07-15), no longer open: shell = **Electron**; targets = **Windows + macOS from day one**; codebase = **one shared repo, `desktop/` package** (not a fork, not a native rewrite).

## Alternatives considered (and set aside)

- **Native Swift app (macOS).** Rejected. Ledgr's value is the TypeScript backend + shared schema (`src/lib/` and the Drizzle model); Swift reuses none of it, so it forces either a bundled-Node-server hack (a worse Electron) or a full second implementation in a second language. That permanently kills feature parity (requirement 2), locks to Apple (breaks requirement 3, Windows), and adds a third schema-sync target alongside Brandon's and Tyler's cloud instances. Notable data point: Obsidian itself, the reference product, is Electron, not native.
- **A real fork / separate repo.** Rejected. Same product, different runtime, so the seams already make it a build target; a fork guarantees drift and doubles maintenance, the opposite of requirement 2. Re-merging a diverged fork is far more expensive than splitting a monorepo later, so unify now and split only if real pain appears.
- **Tauri + Node sidecar.** Runner-up, set aside for the ASAP goal. Smaller bundle (system WebView), but because Ledgr needs a Node server it requires a sidecar process to package and supervise, which is more setup than Electron, not less. Revisit if bundle size ever becomes a real constraint.
- **Bundled local server (Electron spawns `next start`).** Rejected by Tyler (2026-07-15) and the original plan's premise. A supervised Node subprocess + a port + startup latency + Windows AV/firewall prompts. Replaced by the main-process + IPC design above.
- **Cloud-pointing wrapper (wrap the existing PWA/cloud).** Rejected as the end state: delivers none of the local-ownership / offline / no-storage-limit wins.
- **Option 2 — DB + logic inside the window (PGlite-in-browser).** The alternative no-server shape: everything runs in the renderer, no main-process round-trip, and it could later degrade to a pure PWA/mobile with no Electron. Set aside as the **escape hatch**, not the starting point, because it needs the Node-written `src/lib` to run in a browser (some porting, hard to estimate). Chosen only if a Node-dep wall or a browser/mobile target makes it worth the upfront cost.

## Rework audit (2026-07-15, grounds the estimate)

A read-only audit of `src/app/` sized the "no server → client-rendered" rework:

- **44 route pages, all Server Components; 40 fetch server-side** by `await`-ing `@/lib` in the body after `resolveOwner()`. These 40 are the core conversion set (→ client-rendered, data over IPC). A further ~10-15 sub-page server components (e.g. `ItemCanvas`, `DashboardView`) also fetch directly.
- **97 API routes, uniformly thin** wrappers over `@/lib` (`requireOwner` → `await libFn()` → `errorResponse`). They map ~1:1 to IPC handlers; the valuable `@/lib` domain layer runs unchanged in the Electron main process.
- **Writes already go client → `fetch('/api/...')` → route → `@/lib`** (103 client components). Swapping that transport to IPC is mechanical once a client data layer exists.
- **Zero server actions.** No `"use server"` anywhere — one less pattern to port.
- **No client data-access abstraction exists** (no SWR / react-query / fetch wrapper). This must be built; it's the natural IPC/HTTP seam and the linchpin.
- **Auth is the real redesign:** `resolveOwner()` (Clerk-backed, request-scoped) on all 40 pages + `redirect()/notFound()` guards on 38 + the Clerk middleware (`src/proxy.ts`). A desktop single-owner identity without request/cookies is its own workstream (the M-vs-L swing).

**Implication for sequencing:** the `@/lib` core + thin routes make the *logic* reuse cheap (validated as slice 1 below). The cost is (1) building the client data-access seam, (2) converting 40 pages' reads to it, (3) desktop auth. Mechanical majority, redesign minority.

## Slice 1 landed on the branch (2026-07-15)

First real code on `feat/desktop-electron-pglite`, additive and cloud-safe:

- **DB driver seam** in `src/db/index.ts`: an async `initLocalDb(dataDir)` creates the embedded PGlite instance (dynamic-imported, so the cloud/Neon bundle never pulls the WASM payload), loads `pg_trgm`, and assigns the `getDb()` singleton. Neon stays the default and is untouched when `LEDGR_DB_DRIVER` is unset. `@electric-sql/pglite` added as a dependency. Typecheck clean for the change (the lone `tsc` error is a pre-existing Next generated-types artifact in `.next/`, not this code).
- **Proof — the real `@/lib` runs on embedded PGlite outside Next (PASSED):** a throwaway script applied the real migration chain via `drizzle-orm/pglite/migrator`, then exercised the actual domain layer — `getSettings`, `createItem`, `listItems`, and `searchItems` (FTS via the generated tsvector column) — all green against PGlite in a plain Node process. This validates the core bet: **the Electron main process reuses `@/lib` unmodified.**
- **Build requirement discovered (important for the `desktop/` package):** `@/lib` transitively imports **`server-only`** (via `body.ts`, `toc.ts`, and others), which throws in a plain Node / Electron-main context. The desktop main-process bundle must **alias `server-only` to an empty module** (the proof did this via a tsconfig path; the Electron build does it via an esbuild/bundler alias). Also, the main process must **not** import the HTTP-layer `src/lib/api.ts` (it imports `next`); the IPC handlers replace it.

## Slice 2 landed on the branch (2026-07-15)

The client data-access seam the audit flagged as missing: **`src/lib/api-client.ts`** exposing `apiRequest<T>(path, init)`, the single client entry point for data.

- **Cloud:** a behavior-preserving `fetch` to the same `/api/*` route (identical semantics to today's ad-hoc fetches).
- **Desktop:** when the Electron preload sets `window.__ledgrDesktop` (the `DesktopDataBridge` contract, defined in this file), the request travels over IPC to the main process, which dispatches the same path/method/body to the same `@/lib` the routes wrap. No HTTP.
- The `/api/*` REST surface stays the shared contract for both transports, so they can't drift on shape; parity stays in `@/lib` + components.
- Pattern established by converting `AddTaskCard`'s three GET reads (settings/projects/people); typecheck clean, behavior-preserving.
- Remaining: the IPC *implementation* (preload bridge + the main-process path→`@/lib` router) lands with the `desktop/` package; the mass conversion of the other ~100 `fetch` sites + 40 server-page reads is the bulk (best done with running-app verification).

## Slice 3 landed on the branch (2026-07-15)

The `desktop/` Electron package skeleton — the no-server core (ADR-139), isolated, cloud app untouched:

- `main/index.ts` boots embedded PGlite, applies the real migration chain, resolves the single local owner, registers the `ledgr:data` IPC handler, opens the window.
- `main/data-router.ts` dispatches path/method → `@/lib` (proof set: `GET /api/settings`, `GET /api/items`), mirroring the route shapes — the IPC handler's body.
- `preload/index.ts` exposes the `DesktopDataBridge` on `window.__ledgrDesktop` (the contract from `api-client.ts`); `renderer/index.html` is a minimal proof slice (lists items via the bridge).
- `esbuild.mjs` bundles main + preload — aliases `server-only` → empty, `@/*` → `../src`, node_modules external.
- **Verified:** the router headless against PGlite (`GET /api/settings` 200, `GET /api/items` 200, unknown → 404); main+preload bundle cleanly with `server-only` neutralized (no runtime require); and **the actual Electron window boots (2026-07-15, on Tyler's Mac)** — main logs `booted OK — GET /api/items → 200`, the window renders items from local PGlite (0 on a fresh DB). The full path window → IPC → `@/lib` → PGlite runs with no server.
- Remaining for the desktop target: swap the proof renderer for the client-rendered Next app (the ~40-page conversion), and expand `data-router` to the full endpoint set (mechanical). `electron-builder` packaging is Phase 4 step (4).

## Decided: keep both — cloud stays SSR, desktop client-renders shared views (2026-07-15)

Decided (Tyler): **do not compromise the cloud build for desktop.** The cloud app stays server-rendered (SSR) exactly as today. The desktop build renders **client-side** (it has no server) by reusing the same building blocks below the page layer. Not a fork — one repo, shared code; only the thin per-route data-loader differs.

**Approach — shared views + per-target data loaders:**
- Extract each page's UI into a **shared presentational component** that takes its data as props. This is behavior-preserving for cloud: the server page still fetches and renders it, so **SSR is unchanged**.
- **Cloud page** stays a server component: `await @/lib(...)` → `<PageView data=… />`. Rendering model untouched.
- **Desktop** renders the same `<PageView>` from a thin client loader that fetches via the seam (IPC → `@/lib` → PGlite), with a loading state.
- Shared: the view components, `@/lib`, the seam, everything below the page. Divergent: only the thin data-loader wrapper per route.

Per-page complications live in the desktop loaders, never the cloud pages:
- **Server-request context** (`headers()`, `hasScopedToken()`, request-scoped `resolveOwner()`/`redirect()`, e.g. `settings/page.tsx`) — handled client-side on desktop (401 → sign-in) or dropped (desktop is single-owner); cloud pages keep theirs.
- **Cloud-only features** (WebClipper, ICS feed, Clerk sign-in) — hidden on desktop (defer-by-hiding).
- **Dynamic routes** (`items/[id]`, `list/[type]`, …) — the desktop loader/router serves an SPA fallback so client-side routing resolves any path.

**Mechanism (next slice):** the desktop build is its own minimal **Next app in `desktop/`** with `output: 'export'`, whose thin client pages reuse `src/components` (the shared views) and fetch via the seam; Electron loads the exported static site through a custom protocol with an SPA fallback (so client-side routing resolves any path, incl. dynamic routes). The cloud `src/app` tree stays **completely untouched** (SSR preserved) — the two builds share everything below the page layer, diverge only at the thin page/loader.

**Reference — DONE (2026-07-15):** `dashboards/page.tsx` now delegates to a shared `<DashboardsList>` (cloud page unchanged behavior: still a Server Component, still `await listDashboards`, still SSR — verified typecheck-clean). `GET /api/dashboards` added to the desktop router (headless verify: settings/items/search/dashboards all 200, unknown 404). The desktop client loader that renders `<DashboardsList>` from the seam lands with the desktop Next-app slice above.

## Phasing

See `roadmap.md` Phase 4. For "easiest, ASAP, cross-platform, no server": (0) PGlite spike + round-trip export prototype; (1) the `desktop/` Electron package proving the no-server path end to end — main process runs PGlite + `src/lib`, renderer renders one client-side UI slice over an IPC data-access layer, built for Win + Mac; (2) widen client-rendering + IPC coverage screen by screen, plus the local seam impls (`localAuthProvider`, `FilesystemStorageProvider` over IPC, in-process scheduler over extracted job functions); (3) storage offload (`storage-cost-offload.md`, a parallel cloud track desktop inherits); (4) signing/notarization + shippable Windows + Mac builds. Every step after (0) is gated on the joint ADR.
