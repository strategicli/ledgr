import { NextResponse } from "next/server";
import {
  authorizationServerMetadata,
  oauthConfigured,
  originFromRequest,
} from "@/lib/auth/oauth";

// OAuth 2.0 Authorization Server Metadata (RFC 8414), reached via the
// /.well-known/oauth-authorization-server rewrite (ADR-117). Advertises the
// authorize/token/registration endpoints, code+refresh grants, S256 PKCE, and
// public-client auth. Public + 404-when-unconfigured, like the protected-
// resource metadata.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
};

export function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: "oauth not configured" }, { status: 404 });
  }
  return NextResponse.json(authorizationServerMetadata(originFromRequest(request)), {
    headers: CORS,
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
