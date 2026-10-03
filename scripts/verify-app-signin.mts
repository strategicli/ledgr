// App sign-in verification (ADR-289): a phone app (Steward) signs in through
// Ledgr's OAuth server with scope `api`, the sign-in shows up as a device entry
// in Settings > Sign-in, and signing that entry out kills both its tokens.
//
// Self-contained: starts its own throwaway Postgres (embedded-postgres, the
// verify-pg-copy pattern), migrates it from ./drizzle, and runs the REAL route
// handlers against it. It never reads .env files and never touches a real
// database. SKIPs loudly when the embedded binaries are unavailable.
//
// Covers: register with a loopback redirect, scope handling (api, mcp, absent,
// both, unknown), the code -> token exchange with PKCE, a machine route
// accepting the access token, refresh rotation, the device entry (kind, label,
// device name), revoke killing access AND refresh, sign-out-everywhere killing
// them, mcp tokens still refused by machine routes and still accepted by the
// MCP verifier, and device tokens refused by the MCP verifier.
//
// Not run here: the browser consent page itself (it needs a signed-in session);
// the script does the same two steps its POST does (createAppSignin + issueCode).
//
// Run: npx tsx scripts/verify-app-signin.mts
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmDirBestEffort } from "../supervisor/rm-dir.mjs";
import { freePorts } from "./lib/free-port.mjs";
import { stopCluster } from "./lib/pg-stop.mjs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function run(url: string) {
  process.env.DATABASE_URL = url;
  process.env.LEDGR_OAUTH_SECRET = "verify-app-signin-secret-not-for-prod";
  process.env.LEDGR_API_OWNER_UPN = "owner@verify.test";
  delete process.env.LEDGR_API_TOKENS;
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new pg.Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();

  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/db");
  const { users, signinSessions } = await import("../src/db/schema");
  const oauth = await import("../src/lib/auth/oauth");
  const { createAppSignin, appSigninLabel } = await import("../src/lib/auth/app-signin");
  const { revokeSession, listSessions } = await import("../src/lib/auth/builtin");
  const registerRoute = await import("../src/app/api/oauth/register/route");
  const authorizeRoute = await import("../src/app/api/oauth/authorize/route");
  const tokenRoute = await import("../src/app/api/oauth/token/route");
  const pingRoute = await import("../src/app/api/machine/ping/route");
  const typesRoute = await import("../src/app/api/machine/types/route");
  const itemsRoute = await import("../src/app/api/machine/items/route");
  const exportRoute = await import("../src/app/api/machine/export/route");

  const db = getDb();
  const [owner] = await db.insert(users).values({ email: "owner@verify.test" }).returning({ id: users.id });

  // --- register, loopback redirect -------------------------------------------
  const redirectUri = "http://127.0.0.1:53682/callback";
  const reg = await registerRoute.POST(
    new Request("https://ledgr.test/api/oauth/register", {
      method: "POST",
      body: JSON.stringify({
        client_name: "Steward",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      }),
    })
  );
  const regBody = (await reg.json()) as { client_id: string };
  check("register with a loopback redirect answers 201", reg.status === 201);
  const clientId = regBody.client_id;

  // --- authorize: scope handling (the validation that runs before sign-in) ---
  const verifier = "v".repeat(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = (scope: string | null) => {
    const u = new URL("https://ledgr.test/api/oauth/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("state", "st");
    if (scope !== null) u.searchParams.set("scope", scope);
    return new Request(u);
  };
  for (const bad of ["mcp api", "admin"]) {
    const res = await authorizeRoute.GET(authUrl(bad));
    const loc = res.headers.get("location") ?? "";
    check(
      `authorize refuses scope "${bad}" with invalid_scope`,
      res.status >= 300 && res.status < 400 && loc.startsWith(redirectUri) && loc.includes("error=invalid_scope"),
      String(res.status)
    );
  }
  check(
    "scope api and mcp parse, absent scope is mcp",
    oauth.parseGrantScope("api") === "api" && oauth.parseGrantScope("mcp") === "mcp" && oauth.parseGrantScope(null) === "mcp"
  );

  // --- the grant: the same two steps the consent POST does -------------------
  const label = appSigninLabel("Steward", "Pixel 9");
  check("label joins the client name and the device name", label === "Steward (Pixel 9)", label);
  const sid = await createAppSignin(owner.id, label);
  const code = oauth.issueCode({ redirectUri, codeChallenge: challenge, scope: "api", sub: "owner@verify.test", sid });

  const form = (o: Record<string, string>) =>
    new Request("https://ledgr.test/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(o).toString(),
    });
  const exchange = await tokenRoute.POST(
    form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
  );
  const tok = (await exchange.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };
  check(
    "code exchange answers 200 with the full token set",
    exchange.status === 200 && !!tok.access_token && !!tok.refresh_token && tok.token_type === "Bearer" && tok.scope === "api" && tok.expires_in > 0
  );
  const badVerifier = await tokenRoute.POST(
    form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: "w".repeat(48) })
  );
  check("a wrong PKCE verifier is refused", badVerifier.status === 400);

  // --- the device entry ------------------------------------------------------
  const [row] = await db.select().from(signinSessions).where(eq(signinSessions.id, sid));
  check("the grant is a device entry of kind app with its label", row?.kind === "app" && row?.label === label);
  const listed = (await listSessions(owner.id)).find((s) => s.id === sid);
  check("Settings > Sign-in lists it as an app sign-in", listed?.kind === "app" && listed.label === label);

  // --- machine routes accept the access token --------------------------------
  const get = (h: (r: Request) => Promise<Response> | Response, path: string, auth?: string) =>
    h(new Request(`https://ledgr.test/api/machine${path}`, { headers: auth ? { authorization: auth } : {} }));
  const bearer = `Bearer ${tok.access_token}`;
  check("machine ping accepts the access token", (await get(pingRoute.GET, "/ping", bearer)).status === 200);
  check("machine types (api scope) accepts the access token", (await get(typesRoute.GET, "/types", bearer)).status === 200);
  check("machine items (older route) accepts the access token", (await get(itemsRoute.GET, "/items?limit=1", bearer)).status === 200);
  check("a cron-scope route refuses it (api is not cron)", (await get(exportRoute.GET, "/export", bearer)).status === 401);
  check("no token is still 401", (await get(typesRoute.GET, "/types")).status === 401);

  // --- refresh ---------------------------------------------------------------
  const refreshed = await tokenRoute.POST(form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId }));
  const tok2 = (await refreshed.json()) as { access_token: string; refresh_token: string };
  check("refresh answers 200 with a new pair", refreshed.status === 200 && !!tok2.access_token && !!tok2.refresh_token);
  check("the refreshed access token works", (await get(typesRoute.GET, "/types", `Bearer ${tok2.access_token}`)).status === 200);

  // --- mcp scope: unchanged --------------------------------------------------
  const mcpAccess = oauth.issueAccessToken("owner@verify.test", "mcp");
  check("an mcp-scope token is still refused by machine routes", (await get(typesRoute.GET, "/types", `Bearer ${mcpAccess}`)).status === 401);
  check("an mcp-scope token is still accepted by the MCP verifier", oauth.verifyAccessToken(`Bearer ${mcpAccess}`, "mcp") !== null);
  check("a device token is refused by the MCP verifier", oauth.verifyAccessToken(bearer, "mcp") === null);
  const mcpRefresh = await tokenRoute.POST(
    form({ grant_type: "refresh_token", refresh_token: oauth.issueRefreshToken("owner@verify.test", "mcp"), client_id: clientId })
  );
  const mcpRefreshed = (await mcpRefresh.json()) as { scope: string };
  check("an mcp refresh still works with no device entry and stays mcp", mcpRefresh.status === 200 && mcpRefreshed.scope === "mcp");
  const forged = oauth.issueAccessToken("owner@verify.test", "api");
  check("an api token with no device entry is refused", (await get(typesRoute.GET, "/types", `Bearer ${forged}`)).status === 401);

  // --- revoke the one device -------------------------------------------------
  const other = await createAppSignin(owner.id, "Steward (Tablet)");
  const otherCode = oauth.issueCode({ redirectUri, codeChallenge: challenge, scope: "api", sub: "owner@verify.test", sid: other });
  const otherTok = (await (
    await tokenRoute.POST(
      form({ grant_type: "authorization_code", code: otherCode, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
    )
  ).json()) as { access_token: string; refresh_token: string };

  check("revokeSession (what Sign out calls) ends the entry", (await revokeSession(owner.id, sid)) === true);
  check("revoked: the access token stops working", (await get(typesRoute.GET, "/types", bearer)).status === 401);
  check("revoked: the rotated access token stops too", (await get(typesRoute.GET, "/types", `Bearer ${tok2.access_token}`)).status === 401);
  const deadRefresh = await tokenRoute.POST(form({ grant_type: "refresh_token", refresh_token: tok2.refresh_token, client_id: clientId }));
  check("revoked: the refresh token is refused", deadRefresh.status === 400);
  const deadCode = await tokenRoute.POST(
    form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
  );
  check("revoked: an unredeemed code for it is refused", deadCode.status === 400);
  check("another device is untouched", (await get(typesRoute.GET, "/types", `Bearer ${otherTok.access_token}`)).status === 200);

  // --- sign out everywhere: its database half deletes every row of the owner -
  await db.delete(signinSessions).where(eq(signinSessions.ownerId, owner.id));
  check("after sign-out-everywhere the other device's access is refused", (await get(typesRoute.GET, "/types", `Bearer ${otherTok.access_token}`)).status === 401);
  const otherRefresh = await tokenRoute.POST(form({ grant_type: "refresh_token", refresh_token: otherTok.refresh_token, client_id: clientId }));
  check("and its refresh is refused", otherRefresh.status === 400);
}

async function main() {
  let EmbeddedPostgres: new (opts: object) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  };
  try {
    EmbeddedPostgres = (await import("embedded-postgres")).default;
  } catch {
    console.log("\nSKIP  verify-app-signin: embedded-postgres unavailable (npm ci brings its binaries).");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "ledgr-appsignin-"));
  const [port] = await freePorts(1);
  const cluster = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale-provider=icu", "--icu-locale=en-US", "--locale=C"],
  });
  try {
    try {
      await cluster.initialise();
      await cluster.start();
      await cluster.createDatabase("ledgr");
    } catch (err) {
      console.log(`SKIP  verify-app-signin: embedded-postgres could not start (${err instanceof Error ? err.message : err})`);
      return;
    }
    await run(`postgresql://postgres:postgres@localhost:${port}/ledgr`);
  } finally {
    await stopCluster(cluster, dir, createRequire(import.meta.url));
    rmDirBestEffort(dir);
  }
}

await main();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
