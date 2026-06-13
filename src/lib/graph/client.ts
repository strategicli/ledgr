// Shared Microsoft Graph client (slice 21, ADR-022). App-only client
// credentials: the PRD §5.1 split says every unattended job (calendar poll,
// email-in, OneDrive export) authenticates as the app, never as Brandon, so
// MFA never blocks a cron and there is no refresh token to die in the night.
// The interactive delegated flow the roadmap names is the existing Clerk +
// Microsoft sign-in (Phase 1); nothing new is stored here.
//
// One registration carries all app-only permissions (Files.ReadWrite.All for
// export, Calendars.Read + Mail.Read for Phase 2). The Exchange scopes are
// restricted to Brandon's mailbox by an Application Access Policy (runbook
// §1c); Files stays tenant-wide because that policy is Exchange-only.
//
// Plain fetch, no Graph SDK (CLAUDE.md rule 5). The token is cached in module
// scope for the life of the lambda and shared across every caller, since the
// `.default` scope already covers all granted application permissions.

// Distinguishes "you never configured this" from "Microsoft said no": the
// first is a visible 503 / null health check, the second is the secret-expiry
// or consent-revocation canary that must surface on /health, not stall silently.
export class GraphError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "auth" | "request",
    readonly status?: number
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export type GraphCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

// Null when the Azure app registration isn't configured yet; callers surface
// "not configured" instead of crashing (same posture as the storage provider).
export function getGraphCredentials(): GraphCredentials | null {
  const {
    GRAPH_TENANT_ID: tenantId,
    GRAPH_CLIENT_ID: clientId,
    GRAPH_CLIENT_SECRET: clientSecret,
  } = process.env;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

// The mailbox whose Exchange data (calendar, mail) the app-only jobs read.
// Defaults to the export UPN since it is the same person (Brandon); a distinct
// GRAPH_MAILBOX_UPN is honored if the two ever diverge. Calendar/email slices
// address `/users/{upn}/...`.
export function getGraphMailboxUpn(): string | null {
  return process.env.GRAPH_MAILBOX_UPN || process.env.ONEDRIVE_EXPORT_UPN || null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Acquires (and caches) an app-only access token via client credentials.
// A successful grant proves the client secret is valid and unexpired — that
// is exactly the canary checkGraphAuth() surfaces on /health.
export async function getAppToken(): Promise<string> {
  const cfg = getGraphCredentials();
  if (!cfg) {
    throw new GraphError(
      "Microsoft Graph not configured (GRAPH_* env unset)",
      "not_configured"
    );
  }
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  let res: Response;
  try {
    res = await fetch(
      `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );
  } catch (err) {
    throw new GraphError(
      `Graph token request failed: ${err instanceof Error ? err.message : String(err)}`,
      "request"
    );
  }
  if (!res.ok) {
    // The token endpoint returns AADSTS error bodies; surface the code (not
    // the secret) so an expired/rotated secret is diagnosable from a log line.
    let code = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = ` (${body.error})`;
    } catch {
      /* non-JSON error body; the status carries enough */
    }
    throw new GraphError(`Graph token request failed: ${res.status}${code}`, "auth", res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// Authenticated Graph fetch with one throttle retry (429/503 honoring
// Retry-After, capped at 15s so a long throttle fails the call into error_log
// and the next run retries). The single chokepoint every Graph caller uses.
export async function graphFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAppToken();
  const withAuth = () =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  let res = await withAuth();
  if (res.status === 429 || res.status === 503) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 15);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await withAuth();
  }
  return res;
}

// GET a Graph JSON resource, throwing a typed GraphError on non-2xx so callers
// can tell a 403 (permission/Application Access Policy missing) from a 404.
export async function graphGet<T>(url: string): Promise<T> {
  const res = await graphFetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = `: ${body.error.message}`;
    } catch {
      /* ignore non-JSON */
    }
    throw new GraphError(`Graph GET ${res.status}${detail}`, "request", res.status);
  }
  return (await res.json()) as T;
}

export type GraphHealth =
  | { configured: false }
  | { configured: true; ok: true }
  | { configured: true; ok: false; detail: string };

// /health probe (the "visible condition, not a silent stall" requirement,
// slice 21). A token grant alone proves the registration + secret are valid
// and unexpired — the real failure mode for an app-only job. It deliberately
// does NOT call a resource endpoint: a Calendars.Read 403 (permission not yet
// granted) would wrongly flag auth as broken. Mailbox-scope is verified once,
// by hand, in the Brandon-step (runbook §1c).
export async function checkGraphAuth(): Promise<GraphHealth> {
  if (!getGraphCredentials()) return { configured: false };
  try {
    await getAppToken();
    return { configured: true, ok: true };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Test seam: forces the next getAppToken() to re-acquire. Not used in app code
// (lambdas are short-lived); the verification script uses it to prove caching.
export function _resetTokenCacheForTests(): void {
  cachedToken = null;
}
