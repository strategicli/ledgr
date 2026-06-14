import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import type { PropertyDef } from "@/lib/types";
import {
  applyStructurePlan,
  planStructure,
  STRUCTURE_KINDS,
  type StructureInput,
  type StructureKind,
} from "@/lib/structure-templates";

export const dynamic = "force-dynamic";

// POST /api/build/structures — the guided "New Workflow" / "New Wiki" action.
// Plans a type + properties + starter views from the form answers and persists
// it (optionally pinning the primary view to the dashboard). Deterministic, no
// model in the loop (PRD §4.14 / Principle 3). Returns the new type key + the
// primary view id so the client can open it.
export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const raw = await request.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return NextResponse.json(
        { error: "request body must be a JSON object" },
        { status: 400 }
      );
    }
    const r = raw as Record<string, unknown>;
    const kind = r.kind as StructureKind;
    if (!STRUCTURE_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: "kind must be 'workflow' or 'wiki'" },
        { status: 400 }
      );
    }
    const input: StructureInput = {
      kind,
      name: typeof r.name === "string" ? r.name : "",
      key: typeof r.key === "string" && r.key.trim() ? r.key.trim() : undefined,
      stages: Array.isArray(r.stages) ? r.stages.map((s) => String(s)) : undefined,
      properties: Array.isArray(r.properties)
        ? (r.properties as PropertyDef[])
        : undefined,
      addToDashboard: r.addToDashboard === true,
    };
    // planStructure validates (via parseTypeInput/parseViewInput) and throws
    // ItemError on bad input, which errorResponse maps to a 400.
    const plan = planStructure(input);
    const result = await applyStructurePlan(owner.id, plan, {
      addToDashboard: input.addToDashboard,
    });
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
