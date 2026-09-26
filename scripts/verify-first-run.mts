// Verification for first-run setup (ADR-275). PURE: no database, no server, so
// it runs in CI on every PR. Covers where the local app listens, the generated
// per-install secrets, the no-login mode's listening guard, who sees the /setup
// checklist and what it says, and the source-level guards on the two doors that
// create the first owner (Clerk's first sign-in, the setup page at the machine).
//
// NOTE: this file must never contain the literal name of the database env var,
// the db module's import path, or its accessor's name: verify-ci.mjs would
// classify it as backend-needing and silently drop it from CI.
//
// Run: npx tsx scripts/verify-first-run.mts
import { readFileSync } from "node:fs";
import { chooseAuthProvider, noLoginListenOk } from "../src/lib/auth/local";
import { setupChecklist, setupView, type SetupFacts } from "../src/lib/setup-checklist";
import {
  appCommand,
  appListenHost,
  assembleAppEnv,
  effectiveEnv,
  INSTALL_SECRET_KEYS,
  LOOPBACK_HOST,
  nextStartArgs,
  normalizeConfig,
  planInstallSecrets,
} from "../supervisor/lib.mjs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const read = (p: string) => readFileSync(p, "utf8");

// ── 1. Where the app listens ────────────────────────────────────────────────
console.log("\n1. Where the local app listens");
check("Clerk keys: every network, exactly as before", appListenHost({ clerkKey: "pk_live_x" }) === null);
check("Clerk keys win even when the method can't be read", appListenHost({ clerkKey: "pk", signinMethod: undefined }) === null);
check("password sign-in on: every network", appListenHost({ signinMethod: "builtin" }) === null);
check("no sign-in: this machine only", appListenHost({ signinMethod: null }) === LOOPBACK_HOST);
check("method unreadable: this machine only (when unsure, stay local)", appListenHost({}) === LOOPBACK_HOST);
check("emergency override builtin: every network", appListenHost({ methodOverride: "builtin" }) === null);
check("emergency override default: this machine only", appListenHost({ signinMethod: "builtin", methodOverride: "default" }) === LOOPBACK_HOST);
check("an unknown saved method counts as no sign-in", appListenHost({ signinMethod: "passkey" }) === LOOPBACK_HOST);
check("loopback is 127.0.0.1 (what the Tailscale helper and tunnels dial)", LOOPBACK_HOST === "127.0.0.1");
check("next start with a host passes -H", nextStartArgs(3200, "127.0.0.1").join(" ") === "start -p 3200 -H 127.0.0.1");
check("next start for every network passes no host (today's command)", nextStartArgs(3000, null).join(" ") === "start -p 3000");

const hubCfg = normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c", extraEnv: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk" } }, "/x");
check("the hub's extraEnv Clerk key is seen", effectiveEnv(hubCfg, {}, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") === "pk");
check("a Clerk key in the real environment is seen", effectiveEnv(normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x"), { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk2" }, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") === "pk2");
check(
  "an extraEnv entry wins over the environment, even an empty one (it is what the app gets)",
  effectiveEnv(normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c", extraEnv: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" } }, "/x"), { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk" }, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") === ""
);

console.log("\n   The no-login mode's own guard");
check("unset (older supervisor, npm run dev): today's rule", noLoginListenOk(undefined));
check("on 127.0.0.1: allowed", noLoginListenOk("127.0.0.1"));
check("listening everywhere: refused", !noLoginListenOk("all"));
check("the rule that picks the provider is unchanged", chooseAuthProvider({ clerkConfigured: false, deployed: false, localOwnerEmail: "a@b.c", nodeEnv: "production", devUserEmail: undefined }) === "local");
const AUTH_INDEX = read("src/lib/auth/index.ts");
check("the provider choice applies the listening guard to the no-login mode", /localOk\s*\?\s*localAuthProvider/.test(AUTH_INDEX));

// ── 2. Per-install secrets ──────────────────────────────────────────────────
console.log("\n2. Per-install secrets");
let n = 0;
const gen = () => `generated-${++n}`.padEnd(64, "x");
{
  const p = planInstallSecrets({ stored: {}, extraEnv: {}, processEnv: {}, generate: gen });
  check("a missing secret is made and written", !!p.write && p.apply.LEDGR_OAUTH_SECRET === p.write.LEDGR_OAUTH_SECRET);
}
{
  const p = planInstallSecrets({ stored: {}, extraEnv: { LEDGR_OAUTH_SECRET: "owners" }, processEnv: {}, generate: gen });
  check("an extraEnv value wins: nothing made, nothing written (Brandon's hub)", p.write === null && Object.keys(p.apply).length === 0);
}
{
  const p = planInstallSecrets({ stored: {}, extraEnv: {}, processEnv: { LEDGR_OAUTH_SECRET: "env" }, generate: gen });
  check("a value in the real environment wins too", p.write === null && Object.keys(p.apply).length === 0);
}
{
  const kept = "k".repeat(64);
  const p = planInstallSecrets({ stored: { LEDGR_OAUTH_SECRET: kept }, extraEnv: {}, processEnv: {}, generate: gen });
  check("a stored secret is reused, not rotated, and the file is not rewritten", p.write === null && p.apply.LEDGR_OAUTH_SECRET === kept);
}
{
  const p = planInstallSecrets({ stored: { LEDGR_OAUTH_SECRET: "short" }, extraEnv: {}, processEnv: {}, generate: gen });
  check("a too-short stored value is replaced", !!p.write && p.apply.LEDGR_OAUTH_SECRET !== "short");
}
{
  const p = planInstallSecrets({ stored: "garbage" as unknown as Record<string, string>, extraEnv: {}, processEnv: {}, generate: gen });
  check("an unreadable file is treated as empty", !!p.write && !!p.apply.LEDGR_OAUTH_SECRET);
}
check("only the connector secret is generated (API tokens are minted in the app)", JSON.stringify(INSTALL_SECRET_KEYS) === '["LEDGR_OAUTH_SECRET"]');
{
  const cfg = normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c", extraEnv: { LEDGR_OAUTH_SECRET: "mine" } }, "/x");
  const env = assembleAppEnv(cfg, "sha", { installSecrets: { LEDGR_OAUTH_SECRET: "generated" }, listenHost: null }) as Record<string, string>;
  check("the app env never lets a generated secret replace the owner's", env.LEDGR_OAUTH_SECRET === "mine");
  check("the app is told it listens on every network", env.LEDGR_LISTEN_HOST === "all");
  const env2 = assembleAppEnv(normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x"), "sha", { installSecrets: { LEDGR_OAUTH_SECRET: "generated" }, listenHost: "127.0.0.1" }) as Record<string, string>;
  check("a generated secret reaches the app when nobody set one", env2.LEDGR_OAUTH_SECRET === "generated");
  check("the app is told it listens on this machine", env2.LEDGR_LISTEN_HOST === "127.0.0.1");
  const env3 = assembleAppEnv(normalizeConfig({ dataDir: "/d", ownerEmail: "a@b.c" }, "/x"), "sha") as Record<string, string>;
  check("callers that pass nothing get no listening hint (older callers unchanged)", !("LEDGR_LISTEN_HOST" in env3));
}
const SUP = read("supervisor/ledgr-supervisor.mjs");
check("the supervisor never logs a secret's value (only the key names)", /log\("made per-install secrets", \{ keys: Object\.keys\(plan\.apply\)/.test(SUP));
check("the supervisor starts the app through appCommand with the decided host", SUP.includes("appCommand(ptr.dir, cfg.appPort, listenHost, standalone)"));
check("appCommand for a git build is nextStartArgs with that host", appCommand("/b", 3200, "127.0.0.1", false).args.slice(1).join(" ") === nextStartArgs(3200, "127.0.0.1").join(" "));
check("the Clerk check happens before any database read", SUP.indexOf("if (clerkKey || methodOverride)") < SUP.indexOf('client.query("select method from signin_install'));

// ── 3. The /setup page ──────────────────────────────────────────────────────
console.log("\n3. Who sees the setup checklist, and what it says");
check("the owner sees the checklist", setupView({ hasOwner: true, viewerIsOwner: true }) === "checklist");
check("anyone else on an owned install sees only 'set up, sign in'", setupView({ hasOwner: true, viewerIsOwner: false }) === "set-up");
check("an install with no owner shows the checklist to the person setting it up", setupView({ hasOwner: false, viewerIsOwner: false }) === "checklist");
check("owner unknown: only the database facts /health already shows", setupView({ hasOwner: null, viewerIsOwner: false }) === "database-only");

const base: SetupFacts = {
  databaseOk: true,
  schema: { state: "current", pending: 0 },
  hasOwner: true,
  clerkConfigured: true,
  builtinOn: false,
  machineOnly: false,
  deployed: true,
  supervised: false,
  oauthSecret: true,
  mcpToken: true,
  mcpOwner: true,
  graphFailing: false,
  githubFailing: false,
};
const ids = (f: SetupFacts) => setupChecklist(f).map((i) => `${i.id}:${i.status}`).join(" ");
const item = (f: SetupFacts, id: string) => setupChecklist(f).find((i) => i.id === id);
check("a healthy install has nothing to do", setupChecklist(base).every((i) => i.status === "done"), ids(base));
check("database down: that is the only line", ids({ ...base, databaseOk: false }) === "database:todo");
check("pending migrations say how many", /2 changes behind/.test(item({ ...base, schema: { state: "pending", pending: 2 } }, "schema")?.title ?? ""));
check(
  "no owner on a local install: points at the machine-only setup command",
  /local:setup-owner/.test(item({ ...base, hasOwner: false, clerkConfigured: false, deployed: false, supervised: true, machineOnly: true }, "owner")?.fix ?? "")
);
check("no owner on a Clerk install: the first sign-in claims it", /first person to sign in/.test(item({ ...base, hasOwner: false }, "owner")?.fix ?? ""));
check("deployed with no sign-in: a to-do that names the two Clerk keys", /CLERK_SECRET_KEY/.test(item({ ...base, clerkConfigured: false }, "signin")?.fix ?? "") && item({ ...base, clerkConfigured: false }, "signin")?.status === "todo");
check("the local no-login mode is a tip, not a failure", item({ ...base, clerkConfigured: false, deployed: false, supervised: true, machineOnly: true }, "signin")?.status === "tip");
check("password sign-in counts as set up", item({ ...base, clerkConfigured: false, builtinOn: true }, "signin")?.status === "done");
check("missing connector secret on a local install: restart makes it", /Restart Ledgr/.test(item({ ...base, oauthSecret: false, supervised: true, deployed: false }, "oauth")?.fix ?? ""));
check("missing connector secret on a host: names the variable to add", /LEDGR_OAUTH_SECRET/.test(item({ ...base, oauthSecret: false }, "oauth")?.fix ?? ""));
check("no MCP token: the answer is the app's own page, not a file", item({ ...base, mcpToken: false }, "mcp-token")?.href?.path === "/build/claude");
check("no owner yet: no MCP line (nothing to mint for)", !item({ ...base, hasOwner: false, mcpToken: false }, "mcp-token"));

const PAGE = read("src/app/setup/page.tsx");
check("the setup page never reads a secret's value", !/process\.env\.(LEDGR_OAUTH_SECRET|CLERK_SECRET_KEY|LEDGR_API_TOKENS|GRAPH_CLIENT_SECRET)/.test(PAGE));
check("the checklist's input has no string fields at all (so no value can reach it)", !/:\s*string\b/.test(read("src/lib/setup-checklist.ts").split("export type SetupItem")[0]));
check("the create-owner form shows only on an owner-less install at the machine", PAGE.includes("hasOwner === false && (await resetAvailableHere())"));
check("the stranger view is decided before any health check runs", PAGE.indexOf('view === "set-up"') < PAGE.indexOf("gatherHealth()"));

const PROXY = read("src/proxy.ts");
check("/setup is reachable without signing in", /"\/setup",/.test(PROXY));
check("the deployed refusal points at /setup", PROXY.includes("Open /setup"));

// ── 4. The two doors that create the first owner ────────────────────────────
console.log("\n4. Creating the first owner");
const OWNER_LIB = read("src/lib/instance-owner.ts");
check("the claim takes a lock, then inserts only into an empty table", /pg_advisory_xact_lock/.test(OWNER_LIB) && /where not exists \(select 1 from users\)/.test(OWNER_LIB));
check("the lock and the insert run in one transaction on both drivers", /db\.transaction\(/.test(OWNER_LIB) && /db\.batch\(\[db\.execute\(lock\), db\.execute\(insert\)\]\)/.test(OWNER_LIB));
const OWNER = read("src/lib/owner.ts");
check("Clerk's first sign-in claims only on a Clerk install with no owner", /chooseFromProcessEnv\(\) === "clerk" && !\(await installHasOwner\(\)\)/.test(OWNER));
check("the owner row is matched by email case-insensitively", /lower\(\$\{users\.email\}\)/.test(OWNER));
check("the claim never runs for a password session (it names its row already)", OWNER.indexOf("if (authUser.ownerId)") < OWNER.indexOf("claimFirstOwner("));
check(
  "the no-login identity falls back to the ONLY row, never a guess between two",
  /authUser\.externalId === LOCAL_OWNER_ID\)[\s\S]{0,200}\.limit\(2\);\s*if \(all\.length === 1\)/.test(OWNER)
);
const ACTIONS = read("src/lib/auth/signin-actions.ts");
const create = ACTIONS.slice(ACTIONS.indexOf("export async function createOwnerAtMachine"));
check("setup checks the machine ticket before anything else", create.indexOf("ticketOk(token)") >= 0 && create.indexOf("ticketOk(token)") < create.indexOf("claimFirstOwner("));
check("setup validates the password before creating the owner", create.indexOf("passwordProblem(password)") < create.indexOf("claimFirstOwner("));
check("the ticket check is the localhost-only one the reset page uses", /async function ticketOk[\s\S]*?resetAvailableHere\(\)/.test(ACTIONS));

console.log(failures === 0 ? "\nAll first-run checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
