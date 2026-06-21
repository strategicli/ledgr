// Slice 25 verification: the Todoist sync engine against the live Neon DB with
// a stub TodoistClient (no token) under a throwaway owner. Covers push-create
// (dated only), undated-skip, priority mapping, idempotence, Ledgr-canonical
// content, the three-way due reconcile (Ledgr-wins / Todoist-only / both),
// completion both ways, lost-its-due unlink, and inbox pull-in (+ no
// re-import). Run: npx tsx scripts/verify-todoist-sync.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, jobState, users } = await import("../src/db/schema");
const { runTodoistSync, getTodoistState, TODOIST_JOB_KEY } = await import("../src/lib/todoist/sync");
type TodoistTask = import("../src/lib/todoist/types").TodoistTask;
type TodoistClient = import("../src/lib/todoist/types").TodoistClient;
type TodoistCreate = import("../src/lib/todoist/types").TodoistCreate;
const { and, eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const INBOX = "inbox-project";

// In-memory Todoist. `tasks` is the active set; completing/deleting removes
// from it. `ops` logs calls for assertions.
class FakeTodoist implements TodoistClient {
  tasks = new Map<string, TodoistTask>();
  ops: string[] = [];
  private seq = 0;
  seed(t: Partial<TodoistTask> & { id: string; content: string }) {
    this.tasks.set(t.id, {
      id: t.id,
      content: t.content,
      description: t.description ?? null,
      dueDate: t.dueDate ?? null,
      priority: t.priority ?? 1,
      projectId: t.projectId ?? INBOX,
      isCompleted: false,
    });
  }
  async listActiveTasks() {
    return [...this.tasks.values()];
  }
  async getInboxProjectId() {
    return INBOX;
  }
  async createTask(input: TodoistCreate) {
    const id = `td-${++this.seq}`;
    const t: TodoistTask = {
      id,
      content: input.content,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? 1,
      projectId: INBOX,
      isCompleted: false,
    };
    this.tasks.set(id, t);
    this.ops.push(`create:${id}:${input.content}:${input.dueDate}:p${input.priority}`);
    return t;
  }
  async updateTask(id: string, input: Partial<TodoistCreate>) {
    const t = this.tasks.get(id);
    if (t) {
      if (input.content !== undefined) t.content = input.content;
      if (input.priority !== undefined) t.priority = input.priority;
      if (input.dueDate !== undefined) t.dueDate = input.dueDate;
    }
    this.ops.push(`update:${id}`);
  }
  async completeTask(id: string) {
    this.tasks.delete(id);
    this.ops.push(`complete:${id}`);
  }
  async deleteTask(id: string) {
    this.tasks.delete(id);
    this.ops.push(`delete:${id}`);
  }
}

const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-todoist-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;

const mkTask = async (v: Record<string, unknown>) =>
  (await db.insert(items).values({ ownerId, type: "task", ...(v as object) } as typeof items.$inferInsert).returning({ id: items.id }))[0].id;
const row = async (id: string) =>
  (await db.select().from(items).where(and(eq(items.id, id), eq(items.ownerId, ownerId))))[0];
const meta = (r: Awaited<ReturnType<typeof row>>) =>
  (r.properties as { todoist?: { id: string; syncedDue: string | null } } | null)?.todoist ?? null;

const fake = new FakeTodoist();

try {
  // --- Run A: push-create, undated-skip, priority, inbox pull-in ----------
  const dated = await mkTask({ title: "Pay vendors", status: "open", dueDate: new Date("2026-06-20T00:00:00Z"), urgency: 2 });
  const undated = await mkTask({ title: "Someday idea", status: "open" });
  fake.seed({ id: "native-1", content: "Bought offline in Todoist", dueDate: "2026-06-25", projectId: INBOX });

  const rA = await runTodoistSync(ownerId, fake);
  const datedRow = await row(dated);
  check("dated open task is pushed (create) with mapped priority", rA.pushedCreated === 1 && fake.ops.some((o) => o.startsWith("create:") && o.includes("Pay vendors") && o.includes("2026-06-20") && o.includes("p3")));
  check("push records todoist_id + syncedDue", !!datedRow.todoistId && meta(datedRow)?.syncedDue === "2026-06-20");
  check("undated task is not pushed", (await row(undated)).todoistId === null);
  check("inbox pull-in imports a native Todoist task as an inbox task", rA.imported === 1);
  const imported = (await db.select().from(items).where(and(eq(items.ownerId, ownerId), eq(items.todoistId, "native-1"))))[0];
  check("imported task is inbox:true, open, dated, linked", imported?.inbox === true && imported?.status === "open" && imported?.dueDate?.toISOString().slice(0, 10) === "2026-06-25");

  // --- Run B: idempotent (no churn) ---------------------------------------
  fake.ops = [];
  const rB = await runTodoistSync(ownerId, fake);
  check("re-run is a no-op (no create/update/complete/import)", rB.pushedCreated === 0 && rB.pushedUpdated === 0 && rB.imported === 0 && fake.ops.length === 0, `ops=${fake.ops.join("|")} ${JSON.stringify(rB)}`);

  // --- Run C: Ledgr content edit -> pushed (Ledgr canonical) --------------
  fake.ops = [];
  await db.update(items).set({ title: "Pay all vendors" }).where(eq(items.id, dated));
  await runTodoistSync(ownerId, fake);
  check("Ledgr content edit pushes to Todoist", fake.tasks.get(datedRow.todoistId!)?.content === "Pay all vendors");

  // --- Run D: three-way due, Todoist-only change syncs back ---------------
  fake.ops = [];
  fake.tasks.get(datedRow.todoistId!)!.dueDate = "2026-06-22"; // changed in Todoist only
  const rD = await runTodoistSync(ownerId, fake);
  check("a Todoist-only date change syncs back into Ledgr", rD.dateChanged === 1 && (await row(dated)).dueDate?.toISOString().slice(0, 10) === "2026-06-22");

  // --- Run E: three-way due, Ledgr wins when both changed -----------------
  fake.ops = [];
  await db.update(items).set({ dueDate: new Date("2026-06-28T00:00:00Z") }).where(eq(items.id, dated)); // Ledgr change
  fake.tasks.get(datedRow.todoistId!)!.dueDate = "2026-06-15"; // conflicting Todoist change
  await runTodoistSync(ownerId, fake);
  check("when both change the date, Ledgr wins (Todoist set back to Ledgr's)", fake.tasks.get(datedRow.todoistId!)?.dueDate === "2026-06-28" && (await row(dated)).dueDate?.toISOString().slice(0, 10) === "2026-06-28");

  // --- Run F: completion pull (gone from Todoist -> Ledgr done) -----------
  fake.ops = [];
  fake.tasks.delete(datedRow.todoistId!); // completed in Todoist
  const rF = await runTodoistSync(ownerId, fake);
  check("a task completed in Todoist marks the Ledgr task done", rF.completedPulled === 1 && (await row(dated)).status === "done");

  // --- Run G: completion push (Ledgr done -> close in Todoist) ------------
  const dated2 = await mkTask({ title: "File report", status: "open", dueDate: new Date("2026-07-01T00:00:00Z") });
  await runTodoistSync(ownerId, fake); // push-create dated2
  const dated2Row = await row(dated2);
  await db.update(items).set({ status: "done" }).where(eq(items.id, dated2));
  fake.ops = [];
  const rG = await runTodoistSync(ownerId, fake);
  check("a Ledgr-completed task is closed in Todoist", rG.completedPushed === 1 && fake.ops.includes(`complete:${dated2Row.todoistId}`) && !fake.tasks.has(dated2Row.todoistId!));

  // --- Run H: lost-its-due -> deleted from Todoist + unlinked -------------
  const dated3 = await mkTask({ title: "Maybe later", status: "open", dueDate: new Date("2026-07-05T00:00:00Z") });
  await runTodoistSync(ownerId, fake);
  const dated3Row = await row(dated3);
  await db.update(items).set({ dueDate: null }).where(eq(items.id, dated3));
  fake.ops = [];
  const rH = await runTodoistSync(ownerId, fake);
  check("clearing a task's due deletes it from Todoist and unlinks", rH.pushedDeleted === 1 && fake.ops.includes(`delete:${dated3Row.todoistId}`) && (await row(dated3)).todoistId === null);

  // --- imported task isn't re-imported on a later run ---------------------
  fake.ops = [];
  const rI = await runTodoistSync(ownerId, fake);
  check("a previously-imported inbox task is not re-imported", rI.imported === 0);

  // --- job state ----------------------------------------------------------
  const state = await getTodoistState();
  check("job_state records a clean run", !!state && state.lastSuccessAt !== null && state.lastResult.errors === 0);
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(jobState).where(eq(jobState.key, TODOIST_JOB_KEY));
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
