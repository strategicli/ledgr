import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import {
  MCP_SCOPE,
  issueCode,
  oauthConfigured,
  verifyClientId,
} from "@/lib/auth/oauth";

// The OAuth authorization endpoint (ADR-117 Decision 4). This is the ONE OAuth
// route that stays Clerk-protected (it is NOT in the proxy.ts public set): an
// unauthenticated request is bounced to sign-in by the middleware and returns
// here after login, so reaching this handler means the owner is signed in.
// That Microsoft/Clerk login IS the consent step for a single-user system —
// there's no separate approval screen — so once the owner resolves we issue a
// short-lived, PKCE-bound authorization code and redirect back to the client.
export const dynamic = "force-dynamic";

// OAuth errors redirect back to a *validated* redirect_uri with error params
// (so the client surfaces them); only an invalid/unregistered redirect_uri or
// client is shown inline, never bounced to an untrusted URL.
function redirectError(redirectUri: string, state: string | null, error: string, desc: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", desc);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: "oauth not configured" }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");
  const requestedScope = params.get("scope");

  // Validate the client + redirect_uri first: these errors can't safely
  // redirect, so they render inline.
  const client = verifyClientId(clientId);
  if (!client) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "unknown or expired client_id" },
      { status: 400 }
    );
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not registered for this client" },
      { status: 400 }
    );
  }

  // From here, errors redirect back to the (validated) redirect_uri.
  if (responseType !== "code") {
    return redirectError(redirectUri, state, "unsupported_response_type", "only response_type=code is supported");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, state, "invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  // Only the mcp scope exists; reject anything else explicitly rather than
  // silently narrowing.
  if (requestedScope && !requestedScope.split(" ").every((s) => s === MCP_SCOPE)) {
    return redirectError(redirectUri, state, "invalid_scope", `only the '${MCP_SCOPE}' scope is available`);
  }

  // Owner gate: middleware guarantees a Clerk session here, but a signed-in
  // non-owner (belt-and-suspenders) is denied.
  const owner = await resolveOwner();
  if (!owner) {
    return redirectError(redirectUri, state, "access_denied", "not the owner of this Ledgr");
  }

  const code = issueCode({
    redirectUri,
    codeChallenge,
    scope: MCP_SCOPE,
    sub: owner.email,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  return NextResponse.redirect(dest);
}
