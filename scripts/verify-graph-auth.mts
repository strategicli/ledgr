// Slice 21 verification: the shared app-only Microsoft Graph client
// (src/lib/graph/client). Exercises config detection, a real client-
// credentials token grant against the live Microsoft identity platform
// (the export registration's secret is in .env.local), the module-scope
// token cache, the secret-expiry canary (via a temporarily bogus secret),
// the "not configured" path, and a Calendars.Read probe whose 403 is the
// signal that the mailbox permission + Application Access Policy
// (Brandon-step, runbook §1c) are not in place yet.
//
// Run with: npx tsx scripts/verify-graph-auth.mts
// Safe to delete once the slice is closed. Makes no DB writes.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const {
  getGraphCredentials,
  getGraphMailboxUpn,
  getAppToken,
  graphGet,
  checkGraphAuth,
  GraphError,
  _resetTokenCacheForTests,
} = await import("../src/lib/graph/client");
const { getGraphConfig } = await import("../src/lib/export/onedrive");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function info(msg: string) {
  console.log(`INFO  ${msg}`);
}

const realSecret = process.env.GRAPH_CLIENT_SECRET;
const realTenant = process.env.GRAPH_TENANT_ID;
const realClient = process.env.GRAPH_CLIENT_ID;
const haveCreds = !!(realSecret && realTenant && realClient);

// Count token-endpoint hits to prove the module-scope cache (without
// instrumentation we couldn't tell a cache hit from a fresh grant).
const realFetch = globalThis.fetch;
let tokenEndpointHits = 0;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("login.microsoftonline.com")) tokenEndpointHits += 1;
  return realFetch(input, init);
}) as typeof fetch;

try {
  // --- config detection ---------------------------------------------------
  check("getGraphCredentials() populated when env set", getGraphCredentials() !== null);
  check(
    "getGraphMailboxUpn() falls back to ONEDRIVE_EXPORT_UPN",
    getGraphMailboxUpn() === (process.env.GRAPH_MAILBOX_UPN || process.env.ONEDRIVE_EXPORT_UPN || null)
  );
  check("export getGraphConfig() populated when env set", getGraphConfig() !== null);

  if (!haveCreds) {
    info("GRAPH_* not configured locally — skipping live token checks.");
  } else {
    // --- real token grant + cache ----------------------------------------
    _resetTokenCacheForTests();
    tokenEndpointHits = 0;
    const t1 = await getAppToken();
    check("getAppToken() returns a JWT-shaped token", t1.split(".").length === 3, `len ${t1.length}`);
    check("first getAppToken() hit the token endpoint once", tokenEndpointHits === 1, `hits ${tokenEndpointHits}`);
    const t2 = await getAppToken();
    check("second getAppToken() is a cache hit (no new grant)", tokenEndpointHits === 1 && t2 === t1, `hits ${tokenEndpointHits}`);

    const health = await checkGraphAuth();
    check(
      "checkGraphAuth() is {configured:true, ok:true} with a valid secret",
      health.configured === true && health.ok === true,
      JSON.stringify(health)
    );

    // --- Calendars.Read probe (the Brandon-step signal) ------------------
    const upn = getGraphMailboxUpn();
    if (upn) {
      try {
        await graphGet(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/calendar`);
        info(`Calendars.Read already works for ${upn} — calendar permission + Application Access Policy appear to be in place.`);
      } catch (err) {
        if (err instanceof GraphError && err.status === 403) {
          info(`Calendars.Read returns 403 for ${upn} — EXPECTED until the Brandon-step (add Calendars.Read app permission + Application Access Policy, runbook §1c) is done.`);
        } else if (err instanceof GraphError) {
          info(`Calendars.Read probe returned ${err.status ?? "?"}: ${err.message} — review before calendar sync.`);
        } else {
          throw err;
        }
      }
    }

    // --- secret-expiry canary --------------------------------------------
    // A bogus secret must surface as {configured:true, ok:false}, never as a
    // crash and never as {configured:false}. (Client-credential failures do
    // not lock anything — there is no user account involved.)
    process.env.GRAPH_CLIENT_SECRET = "invalid-secret-for-test";
    _resetTokenCacheForTests();
    const bad = await checkGraphAuth();
    check(
      "checkGraphAuth() is {configured:true, ok:false} with a bad secret (the canary)",
      bad.configured === true && bad.ok === false && typeof bad.detail === "string",
      JSON.stringify(bad)
    );
    let threwTyped = false;
    try {
      await getAppToken();
    } catch (err) {
      threwTyped = err instanceof GraphError && err.kind === "auth";
    }
    check("getAppToken() throws a typed GraphError(kind:auth) on a bad secret", threwTyped);
    process.env.GRAPH_CLIENT_SECRET = realSecret;
    _resetTokenCacheForTests();
  }

  // --- not-configured path -------------------------------------------------
  delete process.env.GRAPH_TENANT_ID;
  delete process.env.GRAPH_CLIENT_ID;
  delete process.env.GRAPH_CLIENT_SECRET;
  _resetTokenCacheForTests();
  check("getGraphCredentials() is null when env unset", getGraphCredentials() === null);
  check("export getGraphConfig() is null when env unset", getGraphConfig() === null);
  const off = await checkGraphAuth();
  check("checkGraphAuth() is {configured:false} when env unset", off.configured === false, JSON.stringify(off));
  let threwNotConfigured = false;
  try {
    await getAppToken();
  } catch (err) {
    threwNotConfigured = err instanceof GraphError && err.kind === "not_configured";
  }
  check("getAppToken() throws GraphError(kind:not_configured) when env unset", threwNotConfigured);
} finally {
  globalThis.fetch = realFetch;
  process.env.GRAPH_TENANT_ID = realTenant;
  process.env.GRAPH_CLIENT_ID = realClient;
  process.env.GRAPH_CLIENT_SECRET = realSecret;
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
