// A fresh database gets its core types from migrations alone (ADR-282).
//
// An installed copy (Windows installer, install.sh, the supervisor's first run)
// applies drizzle/*.sql and never runs scripts/seed.mjs, so every type an item
// can be created as on day one must be inserted by some migration. This reads
// the migrations folder and the seed script and fails if a type key seed.mjs
// inserts is missing from every migration. Pure: no database.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrations = readdirSync(join(root, "drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(root, "drizzle", f), "utf8"))
  .join("\n");
const seed = readFileSync(join(root, "scripts", "seed.mjs"), "utf8");

// Every key seed.mjs inserts into `types`: the systemTypes list plus the
// standalone INSERT ... VALUES ('key', ...) statements.
const keys = new Set<string>();
for (const m of seed.matchAll(/^\s*\["([a-z_]+)", "[^"]+", "[^"]+"\],?$/gm)) keys.add(m[1]);
for (const m of seed.matchAll(/INSERT INTO types \([^)]*\)\s*VALUES \(\s*'([a-z_]+)'/g)) keys.add(m[1]);
if (keys.size < 10) throw new Error(`only found ${keys.size} type keys in seed.mjs; the parser is stale`);

const inserted = (key: string) =>
  new RegExp(String.raw`INSERT INTO "?types"?[\s\S]{0,400}?'` + key + "'").test(migrations);
const missing = [...keys].filter((k) => !inserted(k));
if (missing.length) {
  console.error(`types seed.mjs inserts but no migration does: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`verify-core-types-migrated: ${keys.size} type keys, all inserted by a migration.`);
