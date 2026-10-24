import { NextResponse } from "next/server";
import { createLogger } from "@/lib/log";
import { mailGate } from "@/modules/mail/lib/gate";
import { act, parseAct } from "@/modules/mail/lib/acting";

// Change mail (phase 3): POST { items: [{account, id}], action }.
// action.kind: read | flag (value: boolean), tags (add, remove), move (folderId),
// archive, trash, restore (folderId; the undo of trash). Never sends, never
// deletes for good. Answers 200 with `errors` per account that failed, so a
// combined-inbox selection half-succeeds visibly instead of silently.
export const dynamic = "force-dynamic";

const log = createLogger("mail");

export async function POST(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const parsed = parseAct(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "Expected { items: [{account, id}], action }." }, { status: 400 });
  const errors = await act(parsed.items, parsed.action);
  if (errors.length) log.warn("mail action partly failed", { kind: parsed.action.kind, errors });
  return NextResponse.json({ ok: errors.length === 0, errors });
}
