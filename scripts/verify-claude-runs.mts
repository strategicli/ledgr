// Claude Runs (ADR-284), the pure half: the ping's summary line, the module's
// registration, its save hooks, its nightly job, and the type migration.
// The database half (the real send path, once-only, cleanup) is
// verify-claude-runs-db.mts.
import { readFileSync } from "node:fs";
import { summaryLine } from "../src/modules/claude-runs/lib/summary";
import { claudeRunsModule } from "../src/modules/claude-runs/manifest";
import { allModules } from "../src/lib/modules";
import "../src/lib/modules/register";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
}
const md = (text: string) => ({ format: "markdown", text });

check("first non-empty line", summaryLine(md("\n\n# Heading line\nmore")) === "Heading line");
check("list and bold marks stripped", summaryLine(md("- **3 overdue invoices**")) === "3 overdue invoices");
check("long lines capped at 160", summaryLine(md("x".repeat(400))).length === 160);
check("empty or missing body is blank", summaryLine(null) === "" && summaryLine(md("   \n  ")) === "");

check("registered", allModules().some((m) => m.id === "claude-runs"));
check("off by default", claudeRunsModule.enabledByDefault === false);
check("owns the claude_run type", claudeRunsModule.types.some((t) => t.key === "claude_run"));
check("tells Claude to file at the END and notify rarely", /END of\s+the run/.test(claudeRunsModule.mcpTools?.instructions ?? "") && /Most runs should not/.test(claudeRunsModule.mcpTools?.instructions ?? ""));

const server = readFileSync("src/modules/claude-runs/server.ts", "utf8");
check("pings on create and on update", /onCreate: ping, onUpdate: ping/.test(server));
check("server slot imported", readFileSync("src/lib/modules/server-slots.ts", "utf8").includes('"@/modules/claude-runs/server"'));
check(
  "updateItem fires onUpdate only when properties were written",
  /if \(patch\.properties !== undefined \|\| patch\.propertyPatch !== undefined\) \{\s+void runHooks\("onUpdate"/.test(readFileSync("src/lib/item-mutations.ts", "utf8"))
);

const jobs = JSON.parse(readFileSync("supervisor/jobs.json", "utf8"));
const job = jobs["claude-run-cleanup"];
check("nightly cleanup job, gated on the module", job?.path === "/api/machine/claude-run-cleanup" && job?.module === "claude-runs" && typeof job?.at === "string");

const mig = readFileSync("drizzle/0068_claude_run_type.sql", "utf8");
check("migration inserts the type with a Notify me checkbox", /'claude_run', 'Claude Run'/.test(mig) && /"key":"notifyMe"/.test(mig));
check("migration is additive only", !/\b(DROP|DELETE FROM|TRUNCATE|ALTER TABLE|UPDATE)\b/i.test(mig.replace(/--.*$/gm, "")));
check("seed mirrors it", readFileSync("scripts/seed.mjs", "utf8").includes("'claude_run', 'Claude Run'"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
