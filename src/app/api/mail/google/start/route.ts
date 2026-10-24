import { NextResponse } from "next/server";
import { requestOriginFrom } from "@/lib/storage";
import { mailGate } from "@/modules/mail/lib/gate";
import { beginGoogleSignIn, googleClient } from "@/modules/mail/lib/google-auth";

// "Connect Gmail": send the owner to Google's consent screen. Google sends
// them back to /api/mail/google/callback on the same address they started
// from, which must be listed as a redirect URI on the owner's Google app.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await mailGate();
  if (g instanceof Response) return g;
  if (!googleClient()) {
    return NextResponse.json({ error: "Save your Google app's client ID and secret first." }, { status: 400 });
  }
  const origin = requestOriginFrom(req.headers);
  if (!origin) return NextResponse.json({ error: "Could not tell which address you're on." }, { status: 400 });
  return NextResponse.redirect(beginGoogleSignIn(`${origin}/api/mail/google/callback`));
}
