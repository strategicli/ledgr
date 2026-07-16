// Electron main process — the "no server" core (ADR-139). It runs the embedded
// PGlite database and Ledgr's domain logic (@/lib), answers the renderer's data
// requests over IPC, and serves the statically-exported Next UI over a custom
// app:// protocol. There is no HTTP server and no port.
//
//   window (Next export, client-rendered)  --IPC 'ledgr:data'-->  main process
//                                                                    └─ dispatchDataRequest → @/lib → PGlite
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { initLocalDb } from "@/db";
import { users } from "@/db/schema";
import { seedCoreTypes } from "@/lib/seed-core-types";
import { configureExport, dispatchDataRequest, type DataRequest } from "./data-router";

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

  // Seed the core types (fresh local DBs have none — migrations create tables,
  // not type rows; the cloud runs seed.mjs). Idempotent.
  await seedCoreTypes();

  // Single local owner (no Clerk): reuse the existing one or create it.
  const existing = await db.select().from(users).limit(1);
  ownerId =
    existing[0]?.id ??
    (await db.insert(users).values({ email: "local@ledgr.app" }).returning())[0].id;

  // The markdown vault lives in the user's home so Obsidian/Claude can open it
  // directly (the "unfettered reads" win — CLAUDE.md Principle 4 / Phase 4).
  const vaultDir = path.join(app.getPath("home"), "LedgrVault");
  configureExport(vaultDir);
  console.log("[ledgr-desktop] vault dir:", vaultDir);

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
  let startRoute = process.env.LEDGR_START_ROUTE || "/";
  // Gated demo-seed (verification aid): create a note via the main process's own
  // DB connection (no second connection → no PGlite lock) and open it.
  if (process.env.LEDGR_SEED_DEMO === "1") {
    const created = await dispatchDataRequest(
      {
        method: "POST",
        path: "/api/items",
        body: { type: "task", title: "Demo task", body: { format: "markdown", text: "Editable **body** in the desktop window." } },
      },
      ownerId
    );
    const demoId = (created.data as { item?: { id?: string } }).item?.id;
    if (demoId) {
      await dispatchDataRequest(
        { method: "POST", path: "/api/items", body: { type: "task", title: "Subtask A", parentId: demoId } },
        ownerId
      );
      startRoute = `/item?id=${demoId}`;
    }
    console.log("[seed-demo] created demo item + subtask, opening", startRoute);
  }
  // Gated dashboard seed (verification aid): a task + a view + a dashboard with
  // view/stat/text widgets, then open it — proves the resolved-widget read grid.
  if (process.env.LEDGR_SEED_DASH === "1") {
    await dispatchDataRequest(
      { method: "POST", path: "/api/items", body: { type: "task", title: "Dashboard task " + startRoute } },
      ownerId
    );
    const viewRes = await dispatchDataRequest(
      { method: "POST", path: "/api/views", body: { name: "Desktop tasks", layout: "list", filter: { type: "task" } } },
      ownerId
    );
    const viewId = (viewRes.data as { view?: { id?: string } }).view?.id;
    if (viewId) {
      const widgets = [
        {
          id: randomUUID(),
          kind: "view",
          viewId,
          itemId: null,
          settings: { titleOverride: null, itemLimit: null, sortOverride: null, renderStyle: "compact" },
          layout: { lg: { x: 0, y: 0, w: 6, h: 4 } },
        },
        {
          id: randomUUID(),
          kind: "stat",
          viewId,
          itemId: null,
          settings: { label: "Open tasks", metric: "count" },
          layout: { lg: { x: 6, y: 0, w: 3, h: 2 } },
        },
        {
          id: randomUUID(),
          kind: "text",
          viewId: null,
          itemId: null,
          settings: { heading: "Notes", body: "Hello from the desktop dashboard" },
          layout: { lg: { x: 0, y: 4, w: 6, h: 2 } },
        },
      ];
      const dashRes = await dispatchDataRequest(
        { method: "POST", path: "/api/dashboards", body: { name: "Desktop Home", focusItemId: null, appearance: null, widgets } },
        ownerId
      );
      const dashId = (dashRes.data as { dashboard?: { id?: string } }).dashboard?.id;
      if (dashId) startRoute = `/dashboard?id=${dashId}`;
      console.log("[seed-dash] created view + 3-widget dashboard, opening", startRoute);
    }
  }
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

  // Gated export self-check (LEDGR_EXPORT_TEST=1): run the markdown vault export
  // through the same door the UI uses, then confirm files landed on disk.
  if (process.env.LEDGR_EXPORT_TEST === "1") {
    const res = await dispatchDataRequest({ method: "POST", path: "/api/export" }, ownerId);
    const data = res.data as { vaultDir?: string; result?: { exported: number; errors: number } };
    let mdFiles = 0;
    if (data.vaultDir && fs.existsSync(data.vaultDir)) {
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".md")) mdFiles++;
        }
      };
      walk(data.vaultDir);
    }
    console.log(
      `[export-test] status=${res.status} exported=${data.result?.exported} errors=${data.result?.errors} mdFilesOnDisk=${mdFiles} dir=${data.vaultDir}`
    );
  }

  // Gated in-window smoke test (LEDGR_SELFTEST=1): drives the quick-add on the
  // current screen and reports the row count before/after, so create-through-
  // the-UI is verifiable without a human typing. Harmless when unset.
  if (process.env.LEDGR_SELFTEST === "1") {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const q = (s) => document.querySelector(s);
        const findAdd = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Add");
        // Poll up to ~8s for a testable surface (data fetch + lazy editor mount).
        let input, addBtn;
        for (let i = 0; i < 40; i++) {
          input = q("input"); addBtn = findAdd();
          const hasCreate = Array.from(document.querySelectorAll("button")).some((b) => b.textContent.trim().indexOf("Create ") === 0);
          if ((input && addBtn) || q("textarea") || hasCreate || q("section .grid > div")) break;
          await wait(200);
        }
        // dashboard read grid: assert the resolved widgets rendered.
        if (location.pathname === "/dashboard" || q("section .grid > div")) {
          const cards = document.querySelectorAll("section .grid > div").length;
          const text = document.body.innerText;
          return "dashCards=" + cards +
            " hasStat=" + /Open tasks/.test(text) +
            " hasText=" + /Hello from the desktop dashboard/.test(text) +
            " hasViewRow=" + /Dashboard task/.test(text);
        }
        if (input && addBtn) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(input, "Selftest " + Date.now());
          input.dispatchEvent(new Event("input", { bubbles: true }));
          addBtn.click();
          await wait(1200);
          const created = document.querySelectorAll("li").length;
          let toggled = "n/a";
          const t = q('li button[aria-label^="Mark"]');
          if (t) { t.click(); await wait(1000); toggled = (q('li button[aria-label^="Mark"]') || {}).textContent || "?"; }
          const d = q('li button[aria-label="Delete"]');
          if (d) { d.click(); await wait(1000); }
          return "created=" + created + " toggled=" + toggled.trim() + " afterDelete=" + document.querySelectorAll("li").length;
        }
        // item detail: edit the title textarea, wait for autosave, verify it persisted
        const ta = q("textarea");
        if (ta) {
          const id = new URLSearchParams(location.search).get("id");
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          const nt = "Edited " + Date.now();
          setter.call(ta, nt);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          await wait(2600);
          const res = await window.__ledgrDesktop.request({ method: "GET", path: "/api/items/" + id });
          const saved = !!(res && res.data && res.data.item && res.data.item.title === nt);
          return "titleEditSaved=" + saved;
        }
        // view builder: fill the name + create, verify a view was saved
        const createViewBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Create view");
        if (createViewBtn) {
          const nameInput = q("input");
          if (nameInput) {
            const s2 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            s2.call(nameInput, "Demo view " + Date.now());
            nameInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          createViewBtn.click();
          await wait(1800);
          const vres = await window.__ledgrDesktop.request({ method: "GET", path: "/api/views" });
          return "viewsAfterCreate=" + (((vres.data || {}).views) || []).length;
        }
        // type builder: fill name + key, create, verify the type was saved
        const createTypeBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Create type");
        if (createTypeBtn) {
          const setV = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
          const sfx = "" + Date.now();
          const nameI = document.querySelector('input[placeholder*="Hiring Candidate"]');
          const keyI = document.querySelector('input[placeholder="hiring_candidate"]');
          if (nameI) setV(nameI, "Demo Type " + sfx);
          if (keyI) setV(keyI, "demo_type_" + sfx);
          createTypeBtn.click();
          await wait(1800);
          const tres = await window.__ledgrDesktop.request({ method: "GET", path: "/api/types" });
          const created = (((tres.data || {}).types) || []).some((t) => t.key && t.key.indexOf("demo_type_") === 0);
          return "typeCreated=" + created;
        }
        return "no testable UI on this route";
      })()`);
      console.log("[selftest]", result);
    } catch (e) {
      console.log("[selftest] error:", (e as Error).message);
    }
  }
}

app.whenReady().then(boot).catch((err) => {
  console.error("Ledgr desktop failed to boot:", err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
