"use server";
// Server actions behind the AI & MCP + Web-clipper mint buttons (ADR-160). Each
// is owner-gated (resolveOwner → the signed-in owner, never a raw request) and
// refuses to mint until the purpose's signing secret is set, so a click can't
// hand back a token no route will accept. The raw token is returned to the
// caller once and never stored (stateless model, oauth.ts).
import { resolveOwner } from "@/lib/owner";
import {
  appConfigured,
  clipperConfigured,
  isValidTokenLabel,
  oauthConfigured,
  signAppToken,
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

// An api-scoped token for an external app (ADR-179). Takes the app's label so
// the token names its caller in machine-route logs; the label is validated here
// too (not just in the form) since a server action is a public entry point.
export async function mintAppToken(label: string): Promise<MintResult> {
  const owner = await resolveOwner();
  if (!owner) return { error: "Not signed in." };
  if (!appConfigured())
    return { error: "Set LEDGR_APP_SECRET on your host and redeploy first." };
  const trimmed = label.trim().toLowerCase();
  if (!isValidTokenLabel(trimmed))
    return {
      error:
        "Name must be 1–32 characters, lowercase letters, digits, and hyphens only.",
    };
  return { token: signAppToken(owner.email, trimmed) };
}
