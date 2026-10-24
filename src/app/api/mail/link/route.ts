import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { mailGate } from "@/modules/mail/lib/gate";
import { createFromEmail, linkedItems, saveAttachment, type LinkType } from "@/modules/mail/lib/links";
import { isAccount } from "@/modules/mail/lib/reading";
import { MailProviderError } from "@/modules/mail/lib/types";

// Email ↔ item links (phase 4). POST, by `op`:
//   lookup  { emails: [{id, internetMessageId}] }       → { links: {emailId: LinkedItem[]} }
//   create  { account, id, type: task|note|event }      → { item }  (a task also flags the email)
//   attach  { account, messageId, attachmentId, itemId } → { fileUrl }
export const dynamic = "force-dynamic";

const TYPES: LinkType[] = ["task", "note", "event"];
const str = (v: unknown, max = 1024): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export async function POST(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const ownerId = g.owner.id;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
  if (!b) return bad("Expected JSON.");

  try {
    switch (b.op) {
      case "lookup": {
        const emails = Array.isArray(b.emails) ? b.emails.slice(0, 100) : null;
        if (!emails) return bad("emails must be a list");
        const clean = emails
          .map((e) => e as { id?: unknown; internetMessageId?: unknown })
          .filter((e): e is { id: string; internetMessageId: unknown } => str(e.id))
          .map((e) => ({ id: e.id, internetMessageId: str(e.internetMessageId) ? e.internetMessageId : null }));
        return NextResponse.json({ links: await linkedItems(ownerId, clean) });
      }
      case "create": {
        if (!isAccount(b.account) || !str(b.id) || !TYPES.includes(b.type as LinkType)) {
          return bad("account, id and type (task, note or event) are required");
        }
        return NextResponse.json({ item: await createFromEmail(ownerId, b.account, b.id, b.type as LinkType) });
      }
      case "attach": {
        if (!isAccount(b.account) || !str(b.messageId) || !str(b.attachmentId) || !str(b.itemId, 64)) {
          return bad("account, messageId, attachmentId and itemId are required");
        }
        return NextResponse.json(await saveAttachment(ownerId, b.account, b.messageId, b.attachmentId, b.itemId));
      }
      default:
        return bad("op must be lookup, create or attach");
    }
  } catch (err) {
    if (err instanceof MailProviderError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return errorResponse(err);
  }
}
