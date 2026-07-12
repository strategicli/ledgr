"use server";
// Server actions behind the AI & MCP + Web-clipper mint buttons (ADR-160). Each
// is owner-gated (resolveOwner → the signed-in owner, never a raw request) and
// refuses to mint until the purpose's signing secret is set, so a click can't
// hand back a token no route will accept. The raw token is returned to the
// caller once and never stored (stateless model, oauth.ts).
import { resolveOwner } from "@/lib/owner";
import {
  clipperConfigured,
  oauthConfigured,
  signClipperToken,
  signMcpToken,
} from "@/lib/auth/oauth";

export type MintResult = { token: string } | { error: string };

export async function mintMcpToken(): Promise<MintResult> {
  const owner = await resolveOwner();
  if (!owner) return { error: "Not signed in." };
  if (!oauthConfigured())
    return { error: "Set LEDGR_OAUTH_SECRET on your host and redeploy first." };
  return { token: signMcpToken(owner.email) };
}

export async function mintClipperToken(): Promise<MintResult> {
  const owner = await resolveOwner();
  if (!owner) return { error: "Not signed in." };
  if (!clipperConfigured())
    return { error: "Set LEDGR_CLIPPER_SECRET on your host and redeploy first." };
  return { token: signClipperToken(owner.email) };
}
