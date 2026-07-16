import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Non-negotiable (CLAUDE.md, runbook.md §5): serverless functions connect
// through the Neon pooler, never directly. Local Postgres (Phase 4) is exempt.
function assertPooledUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }
  if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
    throw new Error(
      "DATABASE_URL must be the Neon pooler connection string (hostname contains '-pooler'). See runbook.md §1."
    );
  }
}

// The app is typed against the Neon (cloud) database. The local desktop build
// (ADR-139) runs the SAME query surface against an embedded PGlite instance;
// PgliteDatabase implements the identical Drizzle query API, so the local
// instance is assigned through this type. getDb() stays synchronous for every
// caller; the local build pre-initializes via initLocalDb() at boot.
type Db = NeonHttpDatabase<typeof schema>;

let db: Db | null = null;

// Lazy singleton so importing this module never throws at build time
// (DATABASE_URL is only required when a query actually runs).
export function getDb(): Db {
  if (db) return db;
  if (process.env.LEDGR_DB_DRIVER === "pglite") {
    // Local/desktop build: the PGlite instance is async to create, so it must
    // be initialized once at startup via initLocalDb() before any query runs.
    throw new Error(
      "LEDGR_DB_DRIVER=pglite but the local DB is not initialized. Call initLocalDb() at startup (desktop main process)."
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  assertPooledUrl(url);
  db = drizzle(neon(url), { schema });
  return db;
}

// Local desktop build (ADR-139): create the embedded PGlite database and make
// getDb() serve it. Called once by the Electron main process at boot with the
// on-disk data directory (e.g. under the app support dir). PGlite + its
// contrib extensions are dynamically imported so the cloud/Neon bundle never
// pulls the WASM payload. pg_trgm is loaded because migration 0004 CREATE
// EXTENSIONs it (spike-confirmed 2026-07-15). The returned instance is used
// exactly like the Neon one. Pass `migrationsFolder` to apply the Drizzle
// migration chain here (done internally so the pglite-typed handle reaches the
// migrator before it is cast to Db).
export async function initLocalDb(
  opts: { dataDir?: string; migrationsFolder?: string } = {}
): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const client = await PGlite.create({
    dataDir: opts.dataDir ?? "memory://ledgr",
    extensions: { pg_trgm },
  });
  const local = drizzlePglite(client, { schema });
  if (opts.migrationsFolder) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(local, { migrationsFolder: opts.migrationsFolder });
  }
  // Same query API as the Neon handle; typed as Db so callers are unchanged.
  db = local as unknown as Db;
  return db;
}
