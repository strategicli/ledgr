// Verification: update_type's quickCaptureTaskChips guard. It must refuse a
// non-task type and an unknown chip id with a bad_request BEFORE any write, so
// a bad call changes nothing. Pure: both rejections throw ahead of the first
// database call. Run:
//   npx tsx scripts/verify-mcp-task-chips.mts
const { typeTools } = await import("../src/lib/mcp/tools/types");
const { ItemError } = await import("../src/lib/items");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const tool = typeTools.find((t) => t.name === "update_type");
check("update_type exists", !!tool);

async function rejects(name: string, args: Record<string, unknown>, want: string) {
  try {
    await tool!.handler("owner", args);
    check(name, false, "did not throw");
  } catch (e) {
    const ok = e instanceof ItemError && e.code === "bad_request" && e.message.includes(want);
    check(name, ok, e instanceof Error ? e.message : String(e));
  }
}

await rejects("non-task type refused", { key: "note", quickCaptureTaskChips: ["priority"] }, "only to the task type");
await rejects("unknown chip id refused", { key: "task", quickCaptureTaskChips: ["assignee"] }, "drawn from");
await rejects("non-array refused", { key: "task", quickCaptureTaskChips: "priority" }, "drawn from");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
