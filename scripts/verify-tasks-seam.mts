// T6 verification (ADR-081): the `tasks` provider seam. Pure env logic, no DB.
// Native is the default; Todoist is opt-in (TASKS_ADAPTER=todoist) AND only when
// actually configured (TODOIST_TOKEN present), else it falls back to native.
// Run: npx tsx scripts/verify-tasks-seam.mts
const { tasksAdapter, isTodoistAdapterActive } = await import("../src/lib/tasks/provider");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function set(adapter: string | undefined, token: string | undefined) {
  if (adapter === undefined) delete process.env.TASKS_ADAPTER;
  else process.env.TASKS_ADAPTER = adapter;
  if (token === undefined) delete process.env.TODOIST_TOKEN;
  else process.env.TODOIST_TOKEN = token;
}

console.log("\n# tasks provider seam");
set(undefined, undefined);
check("default (nothing set) → native", tasksAdapter() === "native");
check("default → Todoist sync inactive", isTodoistAdapterActive() === false);

set("todoist", "tok_123");
check("TASKS_ADAPTER=todoist + token → todoist", tasksAdapter() === "todoist");
check("→ Todoist sync active", isTodoistAdapterActive() === true);

set("todoist", undefined);
check("todoist selected but no token → falls back to native", tasksAdapter() === "native");
check("→ sync inactive (not a broken state)", isTodoistAdapterActive() === false);

set("native", "tok_123");
check("TASKS_ADAPTER=native even with a token → native", tasksAdapter() === "native");

set("", "tok_123");
check("empty TASKS_ADAPTER → native", tasksAdapter() === "native");

set(undefined, undefined);
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
