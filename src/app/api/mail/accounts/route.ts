import { NextResponse } from "next/server";
import { createLogger, errorMessage } from "@/lib/log";
import { mailGate } from "@/modules/mail/lib/gate";
import { accountStatus, checkAccounts } from "@/modules/mail/lib/accounts";
import { clearGoogleTokenCache, forgetGoogleSignIn } from "@/modules/mail/lib/google-auth";
import { updateMailStore } from "@/modules/mail/lib/store";

// The two mail sign-ins, for the module's options at Build → Modules.
//
//   GET                          which accounts are set up (never the secrets)
//   GET ?check=1                 plus a live, read-only test of each one
//   PUT {microsoft?, google?}    save an app's IDs and secret on this computer
//   DELETE ?account=gmail        forget the Gmail sign-in
//   DELETE ?account=microsoft    forget the Microsoft mail app
export const dynamic = "force-dynamic";

const log = createLogger("mail");

export async function GET(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  if (new URL(req.url).searchParams.get("check") !== "1") return NextResponse.json(accountStatus());
  return NextResponse.json({ ...accountStatus(), check: await checkAccounts() });
}

// IDs and secrets are short opaque strings; anything else is a paste mistake.
function field(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 512 && !/\s/.test(s) ? s : null;
}

export async function PUT(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const body = (await req.json().catch(() => null)) as {
    microsoft?: { tenantId?: unknown; clientId?: unknown; clientSecret?: unknown };
    google?: { clientId?: unknown; clientSecret?: unknown };
  } | null;
  if (!body) return NextResponse.json({ error: "Expected JSON." }, { status: 400 });

  const ms = body.microsoft;
  const ggl = body.google;
  const msClientId = ms && field(ms.clientId);
  const msSecret = ms && field(ms.clientSecret);
  const msTenant = ms?.tenantId ? field(ms.tenantId) : undefined;
  if (ms && (!msClientId || !msSecret || msTenant === null)) {
    return NextResponse.json({ error: "Microsoft needs an application ID and a secret." }, { status: 400 });
  }
  const gId = ggl && field(ggl.clientId);
  const gSecret = ggl && field(ggl.clientSecret);
  if (ggl && (!gId || !gSecret)) {
    return NextResponse.json({ error: "Google needs a client ID and a client secret." }, { status: 400 });
  }

  try {
    updateMailStore((s) => ({
      ...s,
      ...(ms && { microsoft: { clientId: msClientId!, clientSecret: msSecret!, ...(msTenant && { tenantId: msTenant }) } }),
      // A different Google app invalidates the old sign-in; the same one keeps it.
      ...(ggl && {
        google:
          s.google?.clientId === gId
            ? { ...s.google, clientId: gId!, clientSecret: gSecret! }
            : { clientId: gId!, clientSecret: gSecret! },
      }),
    }));
    if (ggl) clearGoogleTokenCache();
  } catch (err) {
    log.error("saving mail sign-in failed", { error: errorMessage(err) });
    return NextResponse.json({ error: "Could not save on this computer." }, { status: 500 });
  }
  return NextResponse.json(accountStatus());
}

export async function DELETE(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const account = new URL(req.url).searchParams.get("account");
  if (account === "gmail") forgetGoogleSignIn();
  else if (account === "microsoft") updateMailStore(({ microsoft: _drop, ...rest }) => rest);
  else return NextResponse.json({ error: "account must be gmail or microsoft" }, { status: 400 });
  return NextResponse.json(accountStatus());
}
