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
  `experimental.externalDir`) and fetch through the seam. `web/app/page.tsx`
  renders the shared `<DashboardsList>` from `GET /api/dashboards`.
- `main/index.ts` — Electron main: boots PGlite, migrates, resolves the single
  local owner, registers the `ledgr:data` IPC handler, serves `web/out` over a
  custom `app://` protocol (with SPA fallback for client-side routing), opens
  the window.
- `main/data-router.ts` — path/method → `@/lib` dispatch (the IPC handler's
  body). Covered: `GET /api/settings|items|search|dashboards`, item CRUD
  (`POST /api/items`, `GET|PATCH|DELETE /api/items/:id`), with `ItemError`-code
  → HTTP status mapping. Remaining endpoints are the mechanical follow-up.
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
- ⏳ convert the remaining ~40 pages to the shared-view + desktop-loader pattern
  and expand `data-router` to the full endpoint set.
- ⏳ `electron-builder` packaging + signing (needs certs).
