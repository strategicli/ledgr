import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { createItem } from "@/lib/item-mutations";
import { getItem } from "@/lib/items";
import { listTypes } from "@/lib/types";
import { homeParentRecord, relateItems, setHome } from "@/lib/relations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/records/[id]/contain — create an item and make it a HOME-contained
// child of this record (Project Type, ADR-111/PJ5). The one write path behind
// the editable collection widgets: the Tasks widget's "add task", the Notes
// capture bar, the Milestones "add". Tasks use the existing role "project"
// (so the task→project field stays one mechanism); everything else uses the
// generic "contains" role. Body { type, title?, text?, date? } — milestones
// also accept { points?, taskId?, newTaskTitle? } (ADR-196): points lands in
// properties.points (the % share of the project bar), taskId links an existing
// task as the milestone's "Completes with task" (edges with role 'task'), and
// newTaskTitle creates that task IN this record first, then links it.
// The built-in collections this route has always served. Custom types are
// allowed too (ADR-204 — the bug Tyler hit: a type offered as a tool got a 400
// from this allowlist, and the card's add did nothing): any LIVE, non-hidden
// type from the registry may be contained. `milestone`/`mindmap` are hidden
// types, which is why the built-in set stays a fast path rather than folding
// into the registry check.
const ALLOWED = new Set(["task", "note", "milestone", "event", "link", "mindmap"]);

export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const raw = (await request.json()) as Record<string, unknown>;
    const type = String(raw.type ?? "");
    if (!ALLOWED.has(type)) {
      const live = await listTypes(); // excludes hidden + deleted types
      if (!live.some((t) => t.key === type)) {
        return NextResponse.json({ error: "unsupported contained type" }, { status: 400 });
      }
    }
    const title = typeof raw.title === "string" ? raw.title : "";
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    const body = text ? { format: "markdown", text } : undefined;
    // A date on the payload maps to the type's natural date column: milestones
    // land on due_date, meetings (events) on meeting_at.
    const rawDate = typeof raw.date === "string" && raw.date ? new Date(raw.date) : undefined;
    const validDate = rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate : undefined;
    const dueDate = type === "milestone" ? validDate : undefined;
    const meetingAt = type === "event" ? validDate : undefined;
    // Milestone extras (ADR-196), validated shape-only here; ownership of a
    // linked task is asserted by relateItems below.
    const points = type === "milestone" ? Number(raw.points) : NaN;
    const properties =
      Number.isFinite(points) && points > 0
        ? { points: Math.min(Math.round(points), 100) }
        : undefined;
    const item = await createItem(owner.id, {
      type,
      title,
      ...(body ? { body } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(meetingAt ? { meetingAt } : {}),
      ...(properties ? { properties } : {}),
    });
    await setHome(owner.id, item.id, id, type === "task" ? "project" : "contains");
    if (type === "milestone") {
      let taskId = typeof raw.taskId === "string" && raw.taskId ? asUuid(raw.taskId, "taskId") : null;
      const newTaskTitle = typeof raw.newTaskTitle === "string" ? raw.newTaskTitle.trim() : "";
      if (!taskId && newTaskTitle) {
        // Create the completing task inside this record, same as the Tasks
        // widget's add would (role "project").
        const t = await createItem(owner.id, { type: "task", title: newTaskTitle });
        await setHome(owner.id, t.id, id, "project");
        taskId = t.id;
      }
      if (taskId) {
        // The typed relation field's edge (ADR-067): milestone -> task, role
        // 'task'. relateItems asserts both ends are owned + live.
        await relateItems(owner.id, item.id, taskId, "task");
      }
    }
    // A note jotted ON a meeting also files under the meeting's project, so it
    // surfaces in that project's Docs box (Tyler, 2026-07-01). The note's HOME
    // stays the meeting; a plain "contains" edge to the project is enough for the
    // Docs query (type=note related to the project). Best-effort, non-fatal.
    if (type === "note") {
      const parent = await getItem(owner.id, id).catch(() => null);
      if (parent?.type === "event") {
        const project = await homeParentRecord(owner.id, id);
        if (project) {
          await relateItems(owner.id, item.id, project.id, "contains").catch(() => {});
        }
      }
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
