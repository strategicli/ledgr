import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Pooler connection string (see .env.example and runbook.md §1).
    url: process.env.DATABASE_URL ?? "",
  },
});
