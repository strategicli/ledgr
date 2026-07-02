import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { createItem } from "@/lib/item-mutations";
import { getItem } from "@/lib/items";
import { homeParentRecord, relateItems, setHome } from "@/lib/relations";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/records/[id]/contain — create an item and make it a HOME-contained
// child of this record (Project Type, ADR-111/PJ5). The one write path behind
// the editable collection widgets: the Tasks widget's "add task", the Notes
// capture bar, the Milestones "add". Tasks use the existing role "project"
// (so the task→project field stays one mechanism); everything else uses the
// generic "contains" role. Body { type, title?, text?, date? }.
const ALLOWED = new Set(["task", "note", "milestone", "event", "link", "mindmap"]);

export async function POST(request: Request, context: Context) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const id = asUuid((await context.params).id, "id");
    const raw = (await request.json()) as Record<string, unknown>;
    const type = String(raw.type ?? "");
    if (!ALLOWED.has(type)) {
      return NextResponse.json({ error: "unsupported contained type" }, { status: 400 });
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
    const item = await createItem(owner.id, {
      type,
      title,
      ...(body ? { body } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(meetingAt ? { meetingAt } : {}),
    });
    await setHome(owner.id, item.id, id, type === "task" ? "project" : "contains");
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
