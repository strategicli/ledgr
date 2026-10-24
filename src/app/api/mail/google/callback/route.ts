import { NextResponse } from "next/server";
import { createLogger, errorMessage } from "@/lib/log";
import { requestOriginFrom } from "@/lib/storage";
import { mailGate } from "@/modules/mail/lib/gate";
import { finishGoogleSignIn } from "@/modules/mail/lib/google-auth";

// Google's redirect back after "Connect Gmail". Not a public path: the owner
// is signed in to Ledgr in the same browser that started the sign-in, and the
// state check in finishGoogleSignIn ties the two together.
export const dynamic = "force-dynamic";

const log = createLogger("mail");

export async function GET(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  const url = new URL(req.url);
  const origin = requestOriginFrom(req.headers) ?? url.origin;
  const back = (status: string) => NextResponse.redirect(`${origin}/build/modules?mail=${status}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return back(url.searchParams.get("error") === "access_denied" ? "gmail-cancelled" : "gmail-failed");
  }
  try {
    await finishGoogleSignIn(code, state);
    return back("gmail-connected");
  } catch (err) {
    log.error("gmail sign-in failed", { error: errorMessage(err) });
    return back("gmail-failed");
  }
}
