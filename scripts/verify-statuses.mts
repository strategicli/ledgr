// Tasks Polish S2 (ADR-082) verification: the pure status engine — parse,
// resolve, category lookup, default-per-category, and strict save validation.
// Pure (no DB), so it runs fast and offline. Run: npx tsx scripts/verify-statuses.mts
// Safe to delete once the slice is closed.
import {
  ACTIVE_CATEGORIES,
  SYSTEM_DEFAULT_STATUSES,
  categoryOfStatus,
  defaultStatusKey,
  isDoneCategory,
  orderedStatuses,
  parseStatusSchema,
  resolveStatusSchema,
  validateStatusSchema,
  type StatusDef,
} from "../src/lib/status";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}`);
  }
}
// A throwing validator stand-in (the route passes ItemError-style `bad`).
function expectThrows(name: string, fn: () => unknown) {
  try {
    fn();
    check(name, false);
  } catch {
    check(name, true);
  }
}

// --- parse (read-tolerant) -------------------------------------------------
check("parse null → null (inherit)", parseStatusSchema(null) === null);
check("parse [] → null (inherit)", parseStatusSchema([]) === null);
check("parse non-array → null", parseStatusSchema("nope") === null);
const parsed = parseStatusSchema([
  { key: "todo", label: "To Do", category: "not_started", color: "#111111" },
  { key: "bad-key!", label: "x", category: "done", color: "#222222" }, // dropped: bad slug
  { key: "todo", label: "dup", category: "done", color: "#333333" }, // dropped: dup key
  { key: "fin", label: "Finished", category: "done", color: "notacolor" }, // color → category default
]);
check("parse drops malformed + dup entries", parsed?.length === 2);
check("parse keeps the good ones", parsed?.[0].key === "todo" && parsed?.[1].key === "fin");
check("parse falls back a bad color to the category default", /^#/.test(parsed?.[1].color ?? ""));

// --- resolve ---------------------------------------------------------------
check("resolve null → system default (3)", resolveStatusSchema(null).length === 3);
const custom: StatusDef[] = [
  { key: "todo", label: "To Do", category: "not_started", color: "#64748b" },
  { key: "doing", label: "Doing", category: "in_progress", color: "#3b82f6" },
  { key: "done", label: "Done", category: "done", color: "#16a34a" },
];
check("resolve custom → custom", resolveStatusSchema(custom).length === 3);

// --- category lookup -------------------------------------------------------
const def = resolveStatusSchema(null);
check("categoryOf open = not_started", categoryOfStatus(def, "open") === "not_started");
check("categoryOf done = done", categoryOfStatus(def, "done") === "done");
check("categoryOf archived = archived", categoryOfStatus(def, "archived") === "archived");
check("categoryOf unknown → not_started", categoryOfStatus(def, "ghost") === "not_started");

// --- default per category --------------------------------------------------
check("default not_started = open", defaultStatusKey(def, "not_started") === "open");
check("default done = done", defaultStatusKey(def, "done") === "done");
check("default in_progress = null (empty in the default set)", defaultStatusKey(def, "in_progress") === null);
const flagged = resolveStatusSchema([
  { key: "a", label: "A", category: "not_started", color: "#111111" },
  { key: "b", label: "B", category: "not_started", color: "#222222", isDefault: true },
]);
check("default honors the flagged one", defaultStatusKey(flagged, "not_started") === "b");

// --- active set + helpers --------------------------------------------------
check("ACTIVE_CATEGORIES is the not-done buckets", ACTIVE_CATEGORIES.join(",") === "not_started,in_progress");
check("isDoneCategory", isDoneCategory("done") && !isDoneCategory("archived"));
check(
  "orderedStatuses sorts by category order",
  orderedStatuses([
    { key: "d", label: "D", category: "done", color: "#1" },
    { key: "t", label: "T", category: "not_started", color: "#2" },
  ])[0].key === "t"
);

// --- strict save validation ------------------------------------------------
const okFail = (m: string) => {
  throw new Error(m);
};
expectThrows("validate rejects []", () => validateStatusSchema([], okFail));
expectThrows("validate rejects no-done", () =>
  validateStatusSchema(
    [{ key: "todo", label: "To Do", category: "not_started", color: "#111111" }],
    okFail
  )
);
expectThrows("validate rejects no-active", () =>
  validateStatusSchema([{ key: "done", label: "Done", category: "done", color: "#111111" }], okFail)
);
expectThrows("validate rejects a bad slug", () =>
  validateStatusSchema(
    [
      { key: "Bad Key", label: "x", category: "not_started", color: "#111111" },
      { key: "done", label: "Done", category: "done", color: "#222222" },
    ],
    okFail
  )
);
expectThrows("validate rejects a missing color", () =>
  validateStatusSchema(
    [
      { key: "todo", label: "To Do", category: "not_started" },
      { key: "done", label: "Done", category: "done", color: "#222222" },
    ],
    okFail
  )
);
const validated = validateStatusSchema(
  [
    { key: "todo", label: "To Do", category: "not_started", color: "#111111" },
    { key: "research", label: "Research", category: "in_progress", color: "#222222" },
    { key: "done", label: "Done", category: "done", color: "#16a34a" },
    { key: "wontdo", label: "Won't Do", category: "archived", color: "#6b7280" },
  ],
  okFail
);
check("validate accepts a full valid set", validated.length === 4);
check("validate normalizes one default per present category", validated.filter((s) => s.isDefault).length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
