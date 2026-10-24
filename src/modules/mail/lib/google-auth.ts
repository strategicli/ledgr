// Gmail + Google Calendar sign-in: OAuth 2.0 authorization-code flow with
// PKCE, for a Google Cloud app the owner creates and PUBLISHES (left
// unverified). A published app keeps its refresh token; one left in "testing"
// mode loses it after ~7 days (plan note a06242d3, "Gmail sign-in"). The owner
// sees Google's one-time "unverified app" warning and clicks through.
//
// Plain fetch, no googleapis package (CLAUDE.md rule 5). The refresh token
// lives only in the hub's mail-accounts.json (store.ts).
import { createHash, randomBytes } from "node:crypto";
import { MailProviderError } from "./types";
import { readMailStore, updateMailStore } from "./store";

// gmail.modify: read, label, draft and send, but never permanent delete.
// calendar.events: read and write events on the owner's calendars.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// A sign-in left half-done expires; Google's own codes last minutes.
const PENDING_MAX_MS = 15 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function googleClient(): { clientId: string; clientSecret: string } | null {
  const g = readMailStore().google;
  const clientId = process.env.MAIL_GOOGLE_CLIENT_ID || g?.clientId;
  const clientSecret = process.env.MAIL_GOOGLE_CLIENT_SECRET || g?.clientSecret;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Step 1: remember a fresh state + PKCE verifier, return Google's consent URL.
export function beginGoogleSignIn(redirectUri: string): string {
  const client = googleClient();
  if (!client) throw new MailProviderError("Google app not set up", "not_configured");
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  updateMailStore((s) => ({
    ...s,
    google: {
      clientId: s.google?.clientId ?? client.clientId,
      clientSecret: s.google?.clientSecret ?? client.clientSecret,
      ...s.google,
      pending: { state, verifier, redirectUri, at: Date.now() },
    },
  }));
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always hands back a refresh token.
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  } catch (err) {
    throw new MailProviderError(
      `Google token request failed: ${err instanceof Error ? err.message : String(err)}`,
      "request"
    );
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    // invalid_grant = the owner revoked access or the token aged out.
    throw new MailProviderError(
      `Google token request failed: ${res.status}${data.error ? ` (${data.error})` : ""}`,
      "auth",
      res.status
    );
  }
  return data as { access_token: string; expires_in: number; refresh_token?: string };
}

let cached: { token: string; expiresAt: number } | null = null;

// Step 2: Google redirected back. Check state, trade the code, keep the
// refresh token. Returns the connected address.
export async function finishGoogleSignIn(code: string, state: string): Promise<string> {
  const client = googleClient();
  const pending = readMailStore().google?.pending;
  if (!client || !pending) throw new MailProviderError("No Gmail sign-in in progress", "auth");
  if (pending.state !== state || Date.now() - pending.at > PENDING_MAX_MS) {
    throw new MailProviderError("Gmail sign-in expired or did not match; start again", "auth");
  }
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  if (!data.refresh_token) {
    throw new MailProviderError("Google returned no refresh token; remove Ledgr's access in your Google account and connect again", "auth");
  }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  const profile = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile");
  const email = profile.ok ? ((await profile.json()) as { emailAddress?: string }).emailAddress : undefined;
  updateMailStore((s) => ({
    ...s,
    google: {
      ...s.google!,
      refreshToken: data.refresh_token,
      email,
      pending: undefined,
    },
  }));
  return email ?? "";
}

export function forgetGoogleSignIn(): void {
  cached = null;
  updateMailStore((s) =>
    s.google ? { ...s, google: { ...s.google, refreshToken: undefined, email: undefined, pending: undefined } } : s
  );
}

export async function getGoogleToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const client = googleClient();
  const refreshToken = readMailStore().google?.refreshToken;
  if (!client || !refreshToken) throw new MailProviderError("Gmail not connected", "not_configured");
  const data = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

// The one chokepoint for every Google call, same shape as graphFetch: bearer
// token plus one throttle retry honoring Retry-After (capped at 15s).
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getGoogleToken();
  const go = () => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
  let res = await go();
  if (res.status === 429 || res.status === 503) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 15);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await go();
  }
  return res;
}

// Called when the owner saves a different Google app: the cached token
// belongs to the old one.
export function clearGoogleTokenCache(): void {
  cached = null;
}
export const _resetGoogleTokenForTests = clearGoogleTokenCache;
