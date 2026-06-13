import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { errorResponse } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { createMatcher, listMatchers } from "@/lib/matchers/store";

// Matcher rules (slice 23). User-authed and owner-scoped. The setup wizard and
// learn-by-confirmation (and a future Build-surface UI) write rules here; the
// calendar matcher engine reads them. No seeded rules (PRD §5.1).
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ matchers: await listMatchers(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const raw = await request.json().catch(() => {
      throw new ItemError("bad_request", "request body must be JSON");
    });
    if (!raw || typeof raw !== "object") {
      throw new ItemError("bad_request", "request body must be a JSON object");
    }
    const { condition, action, priority } = raw as Record<string, unknown>;
    // validateCondition (in the store) does the real checking; action is a
    // loose bag the engine reads defensively.
    const matcher = await createMatcher(owner.id, {
      condition: condition as never,
      action: (action ?? {}) as never,
      priority: typeof priority === "number" ? priority : undefined,
    });
    return NextResponse.json({ matcher }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
