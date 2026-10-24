import { NextResponse } from "next/server";
import { mailGate } from "@/modules/mail/lib/gate";
import { isAccount, provider } from "@/modules/mail/lib/reading";
import { MailProviderError } from "@/modules/mail/lib/types";

// Download one attachment: ?account=…&message=…&id=…
//
// The bytes come from a stranger and are served from Ledgr's own address, so
// they are never shown in the page: always a download, never sniffed, and
// sandboxed even if a browser ignored both. Only plain pictures and PDFs keep
// their type (so they open in a viewer tab); anything else is octet-stream.
export const dynamic = "force-dynamic";

const KEEP_TYPE = /^(image\/(png|gif|jpe?g|webp)|application\/pdf)$/i;

export async function GET(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const sp = new URL(req.url).searchParams;
  const account = sp.get("account");
  const messageId = sp.get("message");
  const id = sp.get("id");
  if (!isAccount(account) || !messageId || !id) {
    return NextResponse.json({ error: "account, message and id are required" }, { status: 400 });
  }
  try {
    const a = await provider(account).getAttachment(messageId, id);
    const name = a.name.replace(/[\r\n"\\]/g, "_") || "attachment";
    return new Response(Buffer.from(a.bytes), {
      headers: {
        "content-type": KEEP_TYPE.test(a.contentType) ? a.contentType.toLowerCase() : "application/octet-stream",
        "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof MailProviderError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    throw err;
  }
}
