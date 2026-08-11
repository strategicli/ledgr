// API Tokens (ADR-179). The findable home for "give an external app a token so
// it can push data into Ledgr" — the case the ADR-160 minters didn't cover: the
// MCP button is for AI clients, and the clipper button lives under User Settings
// → Save from the web, which nobody reads as "our API".
//
// Everything is read from server-side libs directly (no fetch), the same way the
// AI & MCP page reads its status: appConfigured/clipperConfigured for the minted
// paths, hasScopedToken("api") for the static env path.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasScopedToken } from "@/lib/auth/machine";
import { appConfigured, clipperConfigured } from "@/lib/auth/oauth";
import AppTokenMinter from "@/components/build/AppTokenMinter";
import CopyField from "@/components/build/CopyField";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        ok ? "bg-emerald-500" : "bg-amber-500"
      }`}
      aria-hidden
    />
  );
}

// The api-scoped surface an app token opens. Kept in step with the four routes
// that call verifyApiToken (oauth.ts) — if a fifth is added, list it here.
const ENDPOINTS: { method: string; path: string; what: string }[] = [
  {
    method: "GET / POST / PATCH",
    path: "/api/machine/items",
    what: "read and write items",
  },
  {
    method: "POST",
    path: "/api/machine/relations",
    what: "link items to each other",
  },
  {
    method: "POST",
    path: "/api/machine/attachments",
    what: "register a file + get a presigned upload URL",
  },
  {
    method: "POST",
    path: "/api/machine/capture",
    what: "capture a URL as a link item in the Inbox",
  },
];

export default async function ApiTokens() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  // Derived from the request so the examples are right on prod, preview, and
  // localhost without an env var (same trick as the AI & MCP page).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? "");

  const appReady = appConfigured();
  const clipperReady = clipperConfigured();
  const staticApiToken = hasScopedToken("api");

  const curl = `curl -X POST ${origin}/api/machine/items \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"note","title":"Hello from your app"}'`;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="ui-title">API Tokens</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Tokens that let an outside app read and write your Ledgr data over HTTP,
        with no sign-in. Generate one per app and paste it into that app as a{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
          Bearer
        </code>{" "}
        token. Generating takes effect immediately — no redeploy.
      </p>

      {/* Generate */}
      <section className="mt-8">
        <h2 className="ui-section-label">Generate a token</h2>
        <div className="mt-3 rounded-card border border-line bg-surface-1 p-4">
          <AppTokenMinter
            disabled={!appReady}
            disabledHint="Set LEDGR_APP_SECRET on your host and redeploy to generate tokens here (runbook §3c)."
          />
        </div>
      </section>

      {/* What the token opens */}
      <section className="mt-8">
        <h2 className="ui-section-label">What a token can reach</h2>
        <p className="mt-2 text-sm text-ink-muted">
          An app token carries the{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            api
          </code>{" "}
          scope, which opens these four routes and nothing else. It acts as you,
          so anything it writes lands in your items.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-3 ui-meta font-medium">Method</th>
                <th className="py-2 pr-3 ui-meta font-medium">Endpoint</th>
                <th className="py-2 ui-meta font-medium">What it does</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-b border-line/60">
                  <td className="py-2 pr-3 font-mono text-xs text-ink-subtle">
                    {e.method}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-ink">
                    {e.path}
                  </td>
                  <td className="py-2 ui-row text-ink-muted">{e.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <p className="mb-1.5 ui-meta">Try it</p>
          <pre className="overflow-x-auto rounded-card border border-line bg-surface-2 p-3 font-mono text-xs text-ink-muted">
            {curl}
          </pre>
        </div>
      </section>

      {/* Revocation — the one thing that surprises people */}
      <section className="mt-8">
        <h2 className="ui-section-label">Revoking</h2>
        <div className="mt-3 rounded-card border border-line bg-surface-1 p-4">
          <p className="ui-row text-ink-muted">
            Tokens are signed, not stored, so there is no list of active tokens
            and no way to revoke one individually. Generating a new token never
            invalidates an older one.
          </p>
          <p className="mt-2 ui-row text-ink-muted">
            To revoke, rotate{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
              LEDGR_APP_SECRET
            </code>{" "}
            on your host and redeploy. ⚠️ That kills{" "}
            <strong className="text-ink">every app token at once</strong>, so
            every app has to be handed a fresh one. It leaves MCP, the phone
            connector, and the web clipper untouched — those sign with their own
            secrets.
          </p>
        </div>
      </section>

      {/* Status of the three api-credential paths */}
      <section className="mt-8">
        <h2 className="ui-section-label">Credential paths</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Three kinds of credential open the{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            api
          </code>{" "}
          scope. They coexist; a token verifies under the one secret that signed
          it.
        </p>
        <ul className="mt-3 flex flex-col gap-2.5">
          <li className="flex items-start gap-2.5 ui-row text-ink-muted">
            <span className="mt-1.5">
              <StatusDot ok={appReady} />
            </span>
            <span>
              <strong className="text-ink">App tokens</strong> — generated above,
              signed with{" "}
              <code className="font-mono text-xs">LEDGR_APP_SECRET</code>.{" "}
              {appReady ? "Configured." : "Not configured yet."}
            </span>
          </li>
          <li className="flex items-start gap-2.5 ui-row text-ink-muted">
            <span className="mt-1.5">
              <StatusDot ok={clipperReady} />
            </span>
            <span>
              <strong className="text-ink">Clipper tokens</strong> — User
              Settings → Save from the web, signed with{" "}
              <code className="font-mono text-xs">LEDGR_CLIPPER_SECRET</code>.{" "}
              {clipperReady ? "Configured." : "Not configured yet."}
            </span>
          </li>
          <li className="flex items-start gap-2.5 ui-row text-ink-muted">
            <span className="mt-1.5">
              <StatusDot ok={staticApiToken} />
            </span>
            <span>
              <strong className="text-ink">Static env tokens</strong> — the{" "}
              <code className="font-mono text-xs">
                scripts/make-token.mjs
              </code>{" "}
              CLI, hashed into{" "}
              <code className="font-mono text-xs">LEDGR_API_TOKENS</code>{" "}
              (needs a redeploy per token; individually revocable by removing its
              entry).{" "}
              {staticApiToken
                ? "At least one api-scoped entry is set."
                : "No api-scoped entry set."}
            </span>
          </li>
        </ul>
      </section>

      <p className="mt-8 ui-meta">
        For AI clients (Claude and other MCP-speaking apps), use Build → AI &amp;
        MCP instead — those tokens carry the{" "}
        <code className="font-mono">mcp</code> scope.
      </p>

      {origin && (
        <div className="mt-6">
          <p className="mb-1.5 ui-meta">Your API base URL</p>
          <CopyField value={`${origin}/api/machine`} label="API base URL" />
        </div>
      )}
    </div>
  );
}
