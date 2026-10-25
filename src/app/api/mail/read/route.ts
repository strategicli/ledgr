import { NextResponse } from "next/server";
import { createLogger, errorMessage } from "@/lib/log";
import { mailGate } from "@/modules/mail/lib/gate";
import {
  connectedAccounts,
  isAccount,
  listFolders,
  listMessages,
  provider,
  readMessage,
  readThread,
} from "@/modules/mail/lib/reading";
import { MailProviderError } from "@/modules/mail/lib/types";

// Everything the mail screens read, live from Outlook and Gmail (phase 2).
// Read only: nothing here marks, moves or sends.
//
//   ?view=accounts                                  which accounts are connected
//   ?view=folders&account=microsoft|gmail           folders/labels with unread counts
//   ?view=tags&account=microsoft|gmail              Outlook categories / Gmail user labels
//   ?view=messages&account=…|all[&folder][&q][&unread=1][&flagged=1][&files=1][&page]
//                                                   one page of the list ("all" = combined);
//                                                   q is the search.ts language, and
//                                                   words in it search the whole mailbox
//   ?view=message&account=…&id=…                    one message, inline pictures resolved
//   ?view=thread&account=…&id=<threadId>            the whole conversation, oldest first
export const dynamic = "force-dynamic";

const log = createLogger("mail");

export async function GET(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view");
  const account = sp.get("account");
  const id = sp.get("id");
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

  try {
    switch (view) {
      case "accounts":
        return NextResponse.json({ accounts: connectedAccounts() });
      case "folders":
        if (!isAccount(account)) return bad("account must be microsoft or gmail");
        return NextResponse.json({ folders: await listFolders(account) });
      case "tags":
        if (!isAccount(account)) return bad("account must be microsoft or gmail");
        return NextResponse.json({ tags: await provider(account).listTags() });
      case "messages": {
        if (account !== "all" && !isAccount(account)) return bad("account must be microsoft, gmail or all");
        const q = sp.get("q")?.trim().slice(0, 500);
        return NextResponse.json(
          await listMessages({
            account,
            folder: sp.get("folder") ?? undefined,
            search: q || undefined,
            unreadOnly: sp.get("unread") === "1",
            flaggedOnly: sp.get("flagged") === "1",
            filesOnly: sp.get("files") === "1",
            pageToken: sp.get("page") ?? undefined,
          })
        );
      }
      case "message":
        if (!isAccount(account) || !id) return bad("account and id are required");
        return NextResponse.json({ message: await readMessage(account, id) });
      case "thread":
        if (!isAccount(account) || !id) return bad("account and id are required");
        return NextResponse.json({ messages: await readThread(account, id) });
      default:
        return bad("unknown view");
    }
  } catch (err) {
    // A provider refusal is shown to the owner as is; anything else is logged.
    if (err instanceof MailProviderError) {
      const status = err.kind === "not_configured" ? 409 : err.status === 404 ? 404 : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    log.error("mail read failed", { view, account, error: errorMessage(err) });
    return NextResponse.json({ error: "Reading mail failed.", correlationId: log.correlationId }, { status: 500 });
  }
}
