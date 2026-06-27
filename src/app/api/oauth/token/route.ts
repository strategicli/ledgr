import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MCP_SCOPE,
  issueAccessToken,
  issueRefreshToken,
  oauthConfigured,
  verifyClientId,
  verifyCode,
  verifyPkceS256,
  verifyRefreshToken,
} from "@/lib/auth/oauth";

// The OAuth token endpoint (ADR-117 Decision 5), stateless. Two grants:
//   - authorization_code: verify the signed code, that the redirect_uri matches
//     what the code was bound to, and the PKCE verifier against the embedded
//     S256 challenge — then mint a signed access token (+ refresh).
//   - refresh_token: verify the signed refresh token, mint a fresh access
//     token (+ rotated refresh).
// Nothing is stored; the signature + expiry is the validation. Public (PKCE is
// the client proof, no secret), so it's in the proxy.ts public set.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Cache-Control": "no-store",
};

function oauthError(error: string, desc: string, status = 400) {
  return NextResponse.json({ error, error_description: desc }, { status, headers: CORS });
}

function tokenResponse(sub: string, scope: string) {
  return NextResponse.json(
    {
      access_token: issueAccessToken(sub, scope),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: issueRefreshToken(sub, scope),
      scope,
    },
    { headers: CORS }
  );
}

// Accept both form-encoded (the OAuth default) and JSON bodies.
async function readParams(request: Request): Promise<URLSearchParams> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(json)) if (v != null) p.set(k, String(v));
    return p;
  }
  const form = await request.formData();
  const p = new URLSearchParams();
  form.forEach((v, k) => p.set(k, String(v)));
  return p;
}

export async function POST(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: "oauth not configured" }, { status: 404, headers: CORS });
  }

  let params: URLSearchParams;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "could not parse request body");
  }

  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code");
    const redirectUri = params.get("redirect_uri");
    const codeVerifier = params.get("code_verifier");
    const clientId = params.get("client_id");

    if (!verifyClientId(clientId)) {
      return oauthError("invalid_client", "unknown or expired client_id");
    }
    const payload = verifyCode(code);
    if (!payload) {
      return oauthError("invalid_grant", "authorization code is invalid or expired");
    }
    if (!redirectUri || redirectUri !== payload.redirect_uri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
    }
    if (!codeVerifier || !verifyPkceS256(codeVerifier, payload.code_challenge)) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    return tokenResponse(payload.sub, payload.scope);
  }

  if (grantType === "refresh_token") {
    const payload = verifyRefreshToken(params.get("refresh_token"));
    if (!payload) {
      return oauthError("invalid_grant", "refresh token is invalid or expired");
    }
    return tokenResponse(payload.sub, payload.scope || MCP_SCOPE);
  }

  return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
