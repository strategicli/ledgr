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

let db: NeonHttpDatabase<typeof schema> | null = null;

// Lazy singleton so importing this module never throws at build time
// (DATABASE_URL is only required when a query actually runs).
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    assertPooledUrl(url);
    db = drizzle(neon(url), { schema });
  }
  return db;
}
