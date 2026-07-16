# Ledgr desktop (local, no-server build)

The macOS + Windows desktop target of Ledgr (ADR-139). Same codebase as the
cloud app; only the runtime differs:

- **No HTTP server.** Electron's Node **main process** runs the embedded
  database (PGlite) and Ledgr's domain logic (`@/lib`). The **renderer** (a
  client-rendered window) asks for data over **IPC**, never a port.
- **Data path:** `window.__ledgrDesktop.request()` (preload) → `ipcMain` →
  `dispatchDataRequest()` (`main/data-router.ts`) → `@/lib` → PGlite. The
  `/api/*` REST surface is the shared contract with the cloud build.
- **DB:** embedded PGlite at `<userData>/ledgr.pgdata`; the real Drizzle
  migration chain is applied on boot.

## Layout

- `main/index.ts` — Electron main: boots PGlite, migrates, resolves the single
  local owner, registers the `ledgr:data` IPC handler, opens the window.
- `main/data-router.ts` — path/method → `@/lib` dispatch (the IPC handler's
  body). Proof set: `GET /api/settings`, `GET /api/items`. Remaining endpoints
  are the mechanical follow-up.
- `preload/index.ts` — exposes the `DesktopDataBridge` on `window.__ledgrDesktop`.
- `renderer/index.html` — a minimal proof slice (lists items via the bridge).
  The full UI is the client-rendered Next app (the page-conversion workstream).
- `esbuild.mjs` — bundles main + preload; aliases `server-only` → `empty.ts`,
  resolves `@/*` → `../src`, leaves node_modules external.

## Run (dev)

From this directory:

```
npm install        # electron + esbuild (the app's own deps resolve from ../node_modules)
npm start          # esbuild build, then launch Electron
```

You should get a window titled **Ledgr** listing items served from a local
PGlite database, with no server running.

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
- ✅ launching the actual Electron window — confirmed 2026-07-15 (`npm start`; main logs `booted OK — GET /api/items → 200`, window renders from local PGlite).
- ⏳ swap the proof renderer for the client-rendered Next app (the ~40-page
  conversion) and expand `data-router` to the full endpoint set.
