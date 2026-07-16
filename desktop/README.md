# Ledgr desktop (local, no-server build)

The macOS + Windows desktop target of Ledgr (ADR-139). Same codebase as the
cloud app; only the runtime differs:

- **No HTTP server.** Electron's Node **main process** runs the embedded
  database (PGlite) and Ledgr's domain logic (`@/lib`). The **renderer** is the
  real Ledgr UI, built as a **static Next export** (`web/`), and asks for data
  over **IPC**, never a port.
- **Data path:** `apiRequest()` (`src/lib/api-client.ts`) → `window.__ledgrDesktop`
  (preload) → `ipcMain` → `dispatchDataRequest()` (`main/data-router.ts`) →
  `@/lib` → PGlite. The `/api/*` REST surface is the shared contract with cloud.
- **DB:** embedded PGlite at `<userData>/ledgr.pgdata`; the real Drizzle
  migration chain is applied on boot.

## Layout

- `web/` — the renderer: a **static Next export** (`output: 'export'`) whose
  client pages import the shared views from `../src/components` (via
  `experimental.externalDir`) and fetch through the seam. A minimal nav shell
  (`web/app/layout.tsx`) links the screens: `/` (Dashboards, shared
  `<DashboardsList>`), `/tasks` and `/notes` (shared `<ItemRows>`). Each page is
  a thin client loader; navigation is Next client-side routing (multi-route
  export served by `app://` with a route→`.html` mapping in main).
- `main/index.ts` — Electron main: boots PGlite, migrates, resolves the single
  local owner, registers the `ledgr:data` IPC handler, serves `web/out` over a
  custom `app://` protocol (with SPA fallback for client-side routing), opens
  the window.
- `main/data-router.ts` — path/method → `@/lib` dispatch (the IPC handler's
  body). Covered: `GET /api/settings|items|search|dashboards`, item CRUD
  (`POST /api/items`, `GET|PATCH|DELETE /api/items/:id`), done toggle
  (`POST /api/items/:id/complete`), with `ItemError`-code → HTTP status mapping.
  Remaining endpoints are the mechanical follow-up.
- `preload/index.ts` — exposes the `DesktopDataBridge` on `window.__ledgrDesktop`.
- `esbuild.mjs` — bundles main + preload; aliases `server-only` → `empty.ts`,
  resolves `@/*` → `../src`, leaves node_modules external.

## Run (dev)

From this directory:

```
npm install        # electron, esbuild, next/react (app deps resolve from ../node_modules)
npm start          # builds the Next export + the main bundle, then launches Electron
```

You should get a window titled **Ledgr** showing the real dashboards UI served
from a local PGlite database, with no server running.

## Verify the data path without a window (headless)

```
npm run verify:router
```

Boots PGlite, applies migrations, seeds via `@/lib`, and drives the same
`dispatchDataRequest()` the IPC handler uses. Prints pass/counts.

## Status (2026-07-15)

- ✅ `@/lib` runs on embedded PGlite (reads/writes/FTS) — verified.
- ✅ main + preload bundle via esbuild — verified.
- ✅ data-router headless proof — verified.
- ✅ launching the actual Electron window — confirmed 2026-07-15.
- ✅ **real Next UI in the window** — the static Next export renders the shared
  `<DashboardsList>` from local PGlite over IPC (renderer logs `[page]
  dashboards: 0`), no server. Confirmed 2026-07-15.
- ✅ item CRUD through the router (`POST/GET/PATCH/DELETE /api/items[/:id]`) —
  headless round-trip verified (create 201 → read → patch → delete).
- ✅ Content-Security-Policy set (Electron no-CSP warning gone, page still renders).
- ✅ **packaged unsigned macOS `.app`** (`npm run package:mac` → `release/`) — the
  packaged binary boots self-contained: embedded PGlite, migrations from the
  shipped `drizzle` resources, PGlite wasm unpacked, real UI rendered. Verified.
- ✅ nav shell + first Work screens (Dashboards / Tasks / Notes), multi-route
  static export with `app://` route→`.html` mapping — verified in the window.
- ✅ **styling** — Tailwind v4 wired into the export (`web/app/globals.css`
  re-imports the cloud `src/app/globals.css` + `@source ../../../src`), so the
  export ships the cloud dark theme + component CSS + the utilities the shared
  components use. Nav / `ItemRows` restyled to the dark palette. Verified: CSS
  emitted with theme + utilities; app boots with no CSP refusal.
- ✅ **create through the UI** — quick-add on Tasks/Notes creates via the seam
  (`POST /api/items` → IPC → `@/lib` → PGlite), list reloads; verified in-window
  (row count 0→1). Router covers item CRUD.
- ✅ **core types auto-seeded** on a fresh local DB (`src/lib/seed-core-types.ts`,
  idempotent, mirrors `scripts/seed.mjs`) — migrations create tables, not type
  rows, so a local DB needs this to be usable.
- ✅ **interactive lists** — toggle a task done (recurrence-aware
  `/complete`, strikethrough) and delete a row, both via the seam. Full
  create→toggle→delete loop verified in-window (`created=1 toggled=☑ afterDelete=0`).
- ✅ **`fetch` shim** (`web/app/layout.tsx`) — routes raw `fetch("/api/…")` through
  the IPC bridge, so the shared cloud client components work on desktop **unchanged**
  (the unlock for reusing the Tiptap editor & co).
- ✅ **item detail** (`/item?id=…`, query-param route to stay export-friendly) —
  open an item and edit **title + body in the real Tiptap `ItemEditor`**, autosave
  over the seam (ADR-134 conflict handling intact). Verified in-window
  (`titleEditSaved=true`).
- ⏳ convert the remaining screens (today/events/inbox/item-detail/list) to the
  same pattern; expand `data-router` to the full endpoint set.
- ⏳ code signing + notarization (needs Apple/Windows certs); Windows/Linux
  builds (config present; build on those platforms or via CI).

## Package (macOS, unsigned)

```
npm run package:mac      # → release/mac-arm64/Ledgr.app
```

Ships `web/out` and `../drizzle` as resources; unpacks `@electric-sql/pglite`
(wasm) from the asar. `mac.identity` is `null` (no signing) for local builds.
