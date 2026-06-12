// One-off verification for step 2v; safe to delete.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
console.log("TABLES:", tables.map((t) => t.table_name).join(", "));

const idx = await sql`select indexname from pg_indexes where schemaname = 'public' order by 1`;
console.log("INDEXES:", idx.map((i) => i.indexname).join(", "));

const types = await sql`select key from types order by key`;
console.log("types rows:", types.map((t) => t.key).join(", "));

const users = await sql`select email from users`;
console.log("users rows:", users.map((u) => u.email).join(", "));
