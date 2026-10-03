// App sign-ins (ADR-289): the device entry behind an OAuth `api` grant.
//
// A phone app (Steward) signs in through Ledgr's OAuth server with scope `api`.
// Approving that grant inserts one signin_sessions row with kind 'app', the same
// table Settings > Sign-in lists for browsers, and the row's id is signed into
// the app's access and refresh tokens (`sid`). A token is only good while its
// row exists, so "Sign out" on that row, or "Sign out everywhere", ends the
// device: the next API call and the next refresh both fail.
//
// Kept apart from builtin.ts on purpose: that file reads cookies and request
// headers, and the OAuth routes and machine-credential checks need none of it.
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { signinSessions } from "@/db/schema";
import { hashToken } from "@/lib/auth/machine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 60 * 60 * 1000;
const MAX_LABEL = 80;

/** "Steward" or "Steward (Pixel 9)": the client's registered name plus the
 * optional device label it passed. Free text from a client, so control
 * characters go and the length is capped; it is shown as plain text only. */
export function appSigninLabel(clientName: string | undefined, deviceName: string | null | undefined): string {
  const clean = (v: string | null | undefined, max: number) =>
    (v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(clientName, 40) || "An app";
  const device = clean(deviceName, 30);
  return (device ? `${name} (${device})` : name).slice(0, MAX_LABEL);
}

/** Records an approved `api` grant as a device entry and returns its id. The
 * token_hash is random and never handed out: no cookie can match it, so the row
 * can never double as a browser session. */
export async function createAppSignin(ownerId: string, label: string): Promise<string> {
  const [row] = await getDb()
    .insert(signinSessions)
    .values({
      ownerId,
      tokenHash: hashToken(randomBytes(32).toString("hex")),
      label,
      kind: "app",
    })
    .returning({ id: signinSessions.id });
  return row.id;
}

/** Is this device entry still signed in? One indexed lookup per call, nothing
 * cached, so a revoke takes effect on the very next request. Also moves
 * last_seen_at at most hourly, so the Settings list shows real use. Returns the
 * entry's label, or null once it has been signed out. */
export async function appSigninAlive(sid: string): Promise<string | null> {
  if (typeof sid !== "string" || !UUID_RE.test(sid)) return null;
  const db = getDb();
  const [row] = await db
    .select({ label: signinSessions.label, lastSeenAt: signinSessions.lastSeenAt })
    .from(signinSessions)
    .where(and(eq(signinSessions.id, sid), eq(signinSessions.kind, "app")));
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > HOUR_MS) {
    await db
      .update(signinSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(signinSessions.id, sid))
      .catch(() => {}); // cosmetic; never turns a live sign-in into a 401
  }
  return row.label ?? "app";
}
