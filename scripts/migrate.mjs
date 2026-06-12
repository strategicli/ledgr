// Apply pending Drizzle migrations from ./drizzle against DATABASE_URL.
// Run via: npm run db:migrate (loads .env / .env.local if present).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error(
    "DATABASE_URL must be the Neon pooler connection string (runbook.md §1)."
  );
  process.exit(1);
}

const db = drizzle(neon(url));
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
