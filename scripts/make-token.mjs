// Generates a Ledgr machine API token and the LEDGR_API_TOKENS entry for it.
// Usage: node scripts/make-token.mjs <name> <scope,scope,...>
//   e.g. node scripts/make-token.mjs gh-actions-cron cron
// The raw token is printed once; only the hash goes in the env var
// (runbook.md §3 for the full issue/revoke flow).
import { createHash, randomBytes } from "node:crypto";

const [name, scopesArg] = process.argv.slice(2);
if (!name || !scopesArg) {
  console.error("Usage: node scripts/make-token.mjs <name> <scope,scope,...>");
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error("Name must be lowercase letters, digits, and hyphens only.");
  process.exit(1);
}
const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
if (scopes.some((s) => !/^[a-z0-9-]+$/.test(s))) {
  console.error("Scopes must be lowercase letters, digits, and hyphens only.");
  process.exit(1);
}

const token = `lgr_${randomBytes(24).toString("hex")}`;
const hash = createHash("sha256").update(token).digest("hex");
const entry = `${name}:${scopes.join("+")}:${hash}`;

console.log("Raw token (give to the caller; shown once, not stored):");
console.log(`  ${token}`);
console.log("");
console.log("LEDGR_API_TOKENS entry (append, comma-separated):");
console.log(`  ${entry}`);
