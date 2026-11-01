// Filtered sort tabs + mostLinked saved-view sort: the pure half (no DB).
// A sort tab may carry a saved-view `where`; set_list_tabs and the Build save
// route reject unknown fields / bad conditions by name instead of dropping
// them; parseSort accepts mostLinked. The SQL ordering half lives in
// verify-list-lenses.mts. Run: npx tsx scripts/verify-lens-filter.mts
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { lensProblem, lensFilter, parseLenses, resolveLensSort } = await import("../src/lib/list-lenses");
const { parseSort } = await import("../src/lib/views");
const { opsForKind } = await import("../src/lib/view-where");

const notDone = { combinator: "and", conditions: [{ subject: "status", op: "noneOf", values: ["done"] }] };
const linkedNotDone = {
  id: "linked",
  kind: "sort",
  label: "Most linked",
  source: { field: "mostLinked" },
  dir: "desc",
  where: notDone,
};

console.log("\n# lensProblem: accepts");
check("filtered mostLinked sort tab", lensProblem(linkedNotDone, "t") === null, String(lensProblem(linkedNotDone, "t")));
check("plain sort tab (kind omitted)", lensProblem({ label: "A", source: { field: "title" }, dir: "asc" }, "t") === null);
check("property sort tab", lensProblem({ label: "S", kind: "sort", source: { property: "score", numeric: true } }, "t") === null);
check("board tab", lensProblem({ id: "board", kind: "board", label: "Board" }, "t") === null);
check("view tab", lensProblem({ kind: "view", label: "V", viewId: "x" }, "t") === null);
check(
  "property + relation conditions",
  lensProblem(
    {
      label: "X",
      source: { field: "title" },
      where: {
        combinator: "or",
        conditions: [
          { subject: "property", key: "area", op: "eq", value: "ops" },
          { subject: "relation", key: "tags", op: "anyOf", values: ["a"] },
        ],
      },
    },
    "t"
  ) === null
);

console.log("\n# lensProblem: rejects by name (never drops)");
const p = (raw: unknown) => lensProblem(raw, "tabs[2]") ?? "";
check("unknown top-level field named", p({ ...linkedNotDone, filter: notDone }).includes("unknown field(s) filter"), p({ ...linkedNotDone, filter: notDone }));
check("where on a board tab rejected", p({ kind: "board", label: "B", where: notDone }).includes("unknown field(s) where"));
check("unknown kind", p({ kind: "kanban", label: "K" }).includes('kind "kanban"'));
check("bad source field", p({ label: "L", source: { field: "linked" } }).includes("source.field"));
check("unknown source key", p({ label: "L", source: { field: "title", order: 1 } }).includes("source has unknown"));
check("bad dir", p({ label: "L", source: { field: "title" }, dir: "down" }).includes(".dir"));
check("bad combinator", p({ ...linkedNotDone, where: { ...notDone, combinator: "xor" } }).includes("combinator"));
check("empty conditions", p({ ...linkedNotDone, where: { combinator: "and", conditions: [] } }).includes("non-empty"));
check("unknown where key", p({ ...linkedNotDone, where: { ...notDone, match: "all" } }).includes("where has unknown"));
check(
  "unknown condition key named with index",
  p({ ...linkedNotDone, where: { combinator: "and", conditions: [{ subject: "status", op: "noneOf", values: ["done"], negate: true }] } }).includes("conditions[0] has unknown field(s) negate")
);
check(
  "incoherent condition (multi op, no values)",
  p({ ...linkedNotDone, where: { combinator: "and", conditions: [{ subject: "status", op: "noneOf", value: "done" }] } }).includes("conditions[0] is invalid")
);
check(
  "status op that would filter nothing",
  p({ ...linkedNotDone, where: { combinator: "and", conditions: [{ subject: "status", op: "contains", value: "do" }] } }).includes("op for status")
);
check("problem path names the tab", p({ label: "L", source: { field: "nope" } }).startsWith("tabs[2]"));

console.log("\n# parse + resolve keep the filter");
const parsed = parseLenses([linkedNotDone]);
const lens = parsed?.[0];
check("parseLenses keeps where", JSON.stringify(lens && lens.kind === "sort" ? lens.where : null) === JSON.stringify(notDone));
check("filtered tab still sorts mostLinked desc", JSON.stringify(lens && resolveLensSort(lens, false)) === JSON.stringify({ field: "mostLinked", dir: "desc" }));
check("reverse still flips", JSON.stringify(lens && resolveLensSort(lens, true)) === JSON.stringify({ field: "mostLinked", dir: "asc" }));
check(
  "stored junk where is dropped on read (tolerant)",
  (() => {
    const l = parseLenses([{ ...linkedNotDone, where: { combinator: "and", conditions: [{ subject: "nope" }] } }])?.[0];
    return !!l && l.kind === "sort" && l.where === undefined;
  })()
);
check("lensFilter folds where onto base", JSON.stringify(lens && lensFilter({ type: "project" }, lens)) === JSON.stringify({ type: "project", where: notDone }));
check("lensFilter leaves unfiltered tab alone", JSON.stringify(lensFilter({ type: "project" }, parseLenses([{ id: "a", label: "A", source: { field: "title" } }])![0])) === JSON.stringify({ type: "project" }));
check("status offers noneOf in the rule builder", opsForKind("status").includes("noneOf"));

console.log("\n# Saved views: parseSort accepts mostLinked");
check("mostLinked desc", JSON.stringify(parseSort({ field: "mostLinked", dir: "desc" })) === JSON.stringify({ field: "mostLinked", dir: "desc" }));
check("mostLinked asc", JSON.stringify(parseSort({ field: "mostLinked", dir: "asc" })) === JSON.stringify({ field: "mostLinked", dir: "asc" }));
let rejected = false;
try {
  parseSort({ field: "linkCount", dir: "desc" });
} catch {
  rejected = true;
}
check("unknown field still rejected", rejected);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
