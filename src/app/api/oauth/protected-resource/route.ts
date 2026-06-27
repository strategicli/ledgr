import { NextResponse } from "next/server";
import {
  oauthConfigured,
  originFromRequest,
  protectedResourceMetadata,
} from "@/lib/auth/oauth";

// OAuth 2.0 Protected Resource Metadata (RFC 9728), reached via the
// /.well-known/oauth-protected-resource rewrite (ADR-117). Tells a connector
// that /api/mcp is the protected resource and this origin is its authorization
// server. Public (no Clerk, no token): discovery must be reachable before any
// credential exists. 404s when the shim isn't configured, so a client doesn't
// start a flow that can't issue tokens.
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
  return NextResponse.json(protectedResourceMetadata(originFromRequest(request)), {
    headers: CORS,
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
