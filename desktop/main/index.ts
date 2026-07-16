// Electron main process — the "no server" core (ADR-139). It runs the embedded
// PGlite database and Ledgr's domain logic (@/lib), answers the renderer's data
// requests over IPC, and serves the statically-exported Next UI over a custom
// app:// protocol. There is no HTTP server and no port.
//
//   window (Next export, client-rendered)  --IPC 'ledgr:data'-->  main process
//                                                                    └─ dispatchDataRequest → @/lib → PGlite
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { initLocalDb } from "@/db";
import { users } from "@/db/schema";
import { dispatchDataRequest, type DataRequest } from "./data-router";

// Select the embedded-PGlite driver in getDb() (ADR-139). Set before any @/lib
// query runs; initLocalDb() below actually creates the instance.
process.env.LEDGR_DB_DRIVER = "pglite";

// The static Next export + the Drizzle migrations. In dev they sit in the repo
// (relative to dist/); in a packaged app they're shipped as extraResources
// (under process.resourcesPath). See the electron-builder config in package.json.
const OUT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "web-out")
  : path.resolve(__dirname, "..", "web", "out");
const MIGRATIONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "drizzle")
  : path.resolve(__dirname, "..", "..", "drizzle");

// Must be registered before app `ready`. A standard, secure scheme so the Next
// client bundle (absolute /_next/... asset paths) and client-side routing work.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let ownerId = "";

async function boot(): Promise<void> {
  // On-disk database under the OS app-data dir (Win: %APPDATA%, Mac: Application Support).
  // Applies the real Drizzle migration chain on boot (PGlite spike-confirmed,
  // ADR-139). drizzle/ ships next to the app; in dev it's two levels up from dist/.
  const dataDir = path.join(app.getPath("userData"), "ledgr.pgdata");
  const db = await initLocalDb({ dataDir, migrationsFolder: MIGRATIONS_DIR });

  // Single local owner (no Clerk): reuse the existing one or create it.
  const existing = await db.select().from(users).limit(1);
  ownerId =
    existing[0]?.id ??
    (await db.insert(users).values({ email: "local@ledgr.app" }).returning())[0].id;

  ipcMain.handle("ledgr:data", async (_e, req: DataRequest) =>
    dispatchDataRequest(req, ownerId)
  );

  // Serve the Next export from OUT_DIR. Assets resolve by path; unknown routes
  // (client-side navigation targets, incl. dynamic segments) fall back to
  // index.html so the Next client router can resolve them (SPA fallback).
  protocol.handle("app", async (request) => {
    const isFile = (p: string) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    };
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    let filePath = path.join(OUT_DIR, rel);
    // Must be a FILE — Next export creates a `tasks/` DIR alongside `tasks.html`,
    // so `existsSync` isn't enough; a dir must fall through to the route mapping.
    if (!isFile(filePath)) {
      if (path.extname(rel)) return new Response("Not found", { status: 404 });
      // Next static export names routes `<route>.html`; map route → page file,
      // then a directory index, then the SPA fallback.
      const asHtml = `${filePath}.html`;
      const asIndex = path.join(filePath, "index.html");
      filePath = isFile(asHtml)
        ? asHtml
        : isFile(asIndex)
          ? asIndex
          : path.join(OUT_DIR, "index.html");
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Ledgr",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Forward the renderer's console to stdout so the in-window seam call is
  // observable headlessly (verification aid).
  win.webContents.on("console-message", (_e, _level, message) =>
    console.log("[renderer]", message)
  );
  // Deep-link support (also lets a route be verified directly): LEDGR_START_ROUTE
  // overrides the initial route. Defaults to the home screen.
  const startRoute = process.env.LEDGR_START_ROUTE || "/";
  await win.loadURL(`app://local${startRoute}`);

  // Boot self-check: drive the same data path the window uses, so stdout carries
  // a definitive "the no-server path works" confirmation even without eyeballing.
  const selfcheck = await dispatchDataRequest(
    { method: "GET", path: "/api/items?limit=50" },
    ownerId
  );
  const count = ((selfcheck.data as { items?: unknown[] }).items ?? []).length;
  console.log(
    `[ledgr-desktop] booted OK — owner=${ownerId}, GET /api/items → ${selfcheck.status} (${count} items), serving Next export from ${OUT_DIR}.`
  );
}

app.whenReady().then(boot).catch((err) => {
  console.error("Ledgr desktop failed to boot:", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
