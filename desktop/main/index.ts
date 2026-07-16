// Electron main process — the "no server" core (ADR-139). It runs the embedded
// PGlite database and Ledgr's domain logic (@/lib), and answers the renderer's
// data requests over IPC. There is no HTTP server and no port.
//
//   window (client-rendered UI)  --IPC 'ledgr:data'-->  main process
//                                                          └─ dispatchDataRequest → @/lib → PGlite
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { migrate } from "drizzle-orm/pglite/migrator";
import { initLocalDb } from "@/db";
import { users } from "@/db/schema";
import { dispatchDataRequest, type DataRequest } from "./data-router";

// Select the embedded-PGlite driver in getDb() (ADR-139). Set before any @/lib
// query runs; initLocalDb() below actually creates the instance.
process.env.LEDGR_DB_DRIVER = "pglite";

let ownerId = "";

async function boot(): Promise<void> {
  // On-disk database under the OS app-data dir (Win: %APPDATA%, Mac: Application Support).
  const dataDir = path.join(app.getPath("userData"), "ledgr.pgdata");
  const db = await initLocalDb(dataDir);

  // Apply the real Drizzle migration chain (PGlite spike-confirmed, ADR-139).
  // drizzle/ ships next to the app; in dev it's two levels up from dist/.
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });

  // Single local owner (no Clerk): reuse the existing one or create it.
  const existing = await db.select().from(users).limit(1);
  ownerId =
    existing[0]?.id ??
    (await db.insert(users).values({ email: "local@ledgr.app" }).returning())[0].id;

  ipcMain.handle("ledgr:data", async (_e, req: DataRequest) =>
    dispatchDataRequest(req, ownerId)
  );

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
  await win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Boot self-check: drive the same data path the window uses, so stdout carries
  // a definitive "the no-server path works" confirmation even without eyeballing.
  const selfcheck = await dispatchDataRequest(
    { method: "GET", path: "/api/items?limit=50" },
    ownerId
  );
  const count = ((selfcheck.data as { items?: unknown[] }).items ?? []).length;
  console.log(
    `[ledgr-desktop] booted OK — owner=${ownerId}, GET /api/items → ${selfcheck.status} (${count} items), window open.`
  );
}

app.whenReady().then(boot).catch((err) => {
  console.error("Ledgr desktop failed to boot:", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
