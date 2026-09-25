// Verification for "Keep a copy in the cloud" (ADR-277). PURE: no database, no
// server, so it runs in CI on every PR. Covers the pairing code, the cloud's
// door (window, single use, attempts, never an owned copy), the fill's order and
// chunking, the size check, the job-owner rule, and the share-token migration.
//
// NOTE: this file must never contain the literal name of the database env var,
// the db module's import path, or its accessor's name: verify-ci.mjs would
// classify it as backend-needing and silently drop it from CI.
//
// Run: npx tsx scripts/verify-pairing.mts
import { readFileSync } from "node:fs";
import {
  claimDecision,
  claimUnsetJobs,
  CLAIM_ATTEMPTS,
  enterCodeRefusal,
  fillRefusal,
  fillTables,
  fitRefusal,
  formatPairingCode,
  hashPairingCode,
  NEON_FREE_BYTES,
  newPairingCode,
  normalizeCloudUrl,
  normalizePairingCode,
  packRows,
  PAIRING_WINDOW_MS,
  pairingCodeMatches,
  pairingCodeShapeOk,
  pairingWindowOpen,
  planFill,
  publicHubPairState,
  splitBytes,
  type CloudFacts,
} from "../src/lib/sync/pairing";
import { SYNCED_TABLES } from "../src/lib/sync/engine";
import { normalizePublicUrl, parseSettings } from "../src/lib/settings";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-09-25T12:00:00Z");

// ── 1. The code ─────────────────────────────────────────────────────────────
console.log("\n1. The pairing code");
const code = newPairingCode();
check("a new code has the right shape", pairingCodeShapeOk(code), code);
check("codes differ", newPairingCode() !== code);
check("shown in groups of four", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(formatPairingCode(code)));
check("typing is forgiving: case, dashes, spaces", normalizePairingCode(` ${formatPairingCode(code).toLowerCase()} `) === code);
check("O reads as 0, I and L as 1", normalizePairingCode("OIL") === "011");
check("the right code matches its hash", pairingCodeMatches(formatPairingCode(code), hashPairingCode(code)));
check("a wrong code does not", !pairingCodeMatches(newPairingCode(), hashPairingCode(code)));
check("a garbage stored hash never matches", !pairingCodeMatches(code, "nothex") && !pairingCodeMatches(code, ""));
check("the stored value is not the code", !hashPairingCode(code).includes(code));
check("compare is constant-time", /timingSafeEqual/.test(read("src/lib/sync/pairing.ts")));

// ── 2. The window ───────────────────────────────────────────────────────────
console.log("\n2. The pairing window");
const at = (msAgo: number) => new Date(NOW - msAgo);
check("open just after the first migration", pairingWindowOpen({ firstMigratedAt: at(60_000), now: NOW, override: undefined }));
check("closed after two hours", !pairingWindowOpen({ firstMigratedAt: at(PAIRING_WINDOW_MS + 1), now: NOW, override: undefined }));
check("closed when the first migration time is unknown", !pairingWindowOpen({ firstMigratedAt: null, now: NOW, override: undefined }));
check("closed for a stamp in the future", !pairingWindowOpen({ firstMigratedAt: new Date(NOW + 60_000), now: NOW, override: undefined }));
check("the owner's host setting reopens it", pairingWindowOpen({ firstMigratedAt: at(10 * PAIRING_WINDOW_MS), now: NOW, override: "1" }));
check("only the exact value 1 reopens it", !pairingWindowOpen({ firstMigratedAt: at(10 * PAIRING_WINDOW_MS), now: NOW, override: "true" }));

// ── 3. Typing the code on the cloud ─────────────────────────────────────────
console.log("\n3. Entering a code on the cloud copy");
const fresh: CloudFacts = { hasOwner: false, hasItems: false, windowOpen: true, preview: false, state: null };
check("an empty, unowned, open copy accepts a code", enterCodeRefusal(fresh) === null);
check("an owned copy never does", enterCodeRefusal({ ...fresh, hasOwner: true }) !== null);
check("a copy with data never does", enterCodeRefusal({ ...fresh, hasItems: true }) !== null);
check("a preview never does", enterCodeRefusal({ ...fresh, preview: true }) !== null);
check("not after the window", enterCodeRefusal({ ...fresh, windowOpen: false }) !== null);
check(
  "not once paired",
  enterCodeRefusal({ ...fresh, state: { status: "paired", deviceId: "d", at: "" } }) !== null
);
const typed = (attempts = 0, expiresIn = 60_000): CloudFacts => ({
  ...fresh,
  state: { status: "code", codeHash: hashPairingCode(code), expiresAt: new Date(NOW + expiresIn).toISOString(), attempts },
});
check("re-typing replaces a typed code", enterCodeRefusal(typed()) === null);

// ── 4. The hub claiming ─────────────────────────────────────────────────────
console.log("\n4. Claiming with the code");
const ok = claimDecision(typed(), code, NOW);
check("the right code, in time, claims", ok.ok);
const wrong = claimDecision(typed(), newPairingCode(), NOW);
check("a wrong code is refused and counted", !wrong.ok && wrong.burn && !wrong.wipe);
const last = claimDecision(typed(CLAIM_ATTEMPTS - 1), newPairingCode(), NOW);
check("the last wrong guess throws the typed code away", !last.ok && last.wipe);
const spent = claimDecision(typed(CLAIM_ATTEMPTS), code, NOW);
check("after too many guesses even the right code is refused", !spent.ok && spent.wipe);
const expired = claimDecision(typed(0, -1), code, NOW);
check("an expired code is refused and thrown away", !expired.ok && expired.wipe);
check("nothing typed yet: refused", !claimDecision(fresh, code, NOW).ok);
check("an owned copy refuses even the right code", !claimDecision({ ...typed(), hasOwner: true }, code, NOW).ok);
check("a copy with data refuses even the right code", !claimDecision({ ...typed(), hasItems: true }, code, NOW).ok);
check("after the window, refused", !claimDecision({ ...typed(), windowOpen: false }, code, NOW).ok);
check(
  "single use: a paired copy refuses the same code again",
  !claimDecision({ ...fresh, state: { status: "paired", deviceId: "d", at: "" } }, code, NOW).ok
);

// ── 5. Who may fill ─────────────────────────────────────────────────────────
console.log("\n5. Who may fill, and when");
const pairedTo = (status: "paired" | "filling" | "done", extra: Partial<CloudFacts> = {}) => ({
  ...fresh,
  ...extra,
  state: { status, deviceId: "hub", at: "" } as const,
});
check("the paired device may begin", fillRefusal(pairedTo("paired"), "begin", "hub") === null);
check("another device may not", fillRefusal(pairedTo("paired"), "begin", "stranger") !== null);
check("nobody may fill an unpaired copy", fillRefusal(fresh, "rows", "hub") !== null);
check("nobody may fill a copy that only has a typed code", fillRefusal(typed(), "begin", "hub") !== null);
check("begin refuses a copy that gained an owner", fillRefusal(pairedTo("paired", { hasOwner: true }), "begin", "hub") !== null);
check("rows wait for begin", fillRefusal(pairedTo("paired"), "rows", "hub") !== null);
check("rows flow while filling", fillRefusal(pairedTo("filling", { hasOwner: true }), "rows", "hub") === null);
check("a resumed begin is allowed (checked against the owner row)", fillRefusal(pairedTo("filling", { hasOwner: true }), "begin", "hub") === null);
check("a finished copy takes nothing more", fillRefusal(pairedTo("done", { hasOwner: true }), "rows", "hub") !== null);
check("cancel only while the copy has no owner", fillRefusal(pairedTo("filling", { hasOwner: true }), "cancel", "hub") !== null);
check("cancel before the owner arrives", fillRefusal(pairedTo("paired"), "cancel", "hub") === null);

// ── 6. What is copied, in what order ────────────────────────────────────────
console.log("\n6. What a fill copies, in what order");
const all = ["users", "items", "types", "views", "relations", "job_state", "api_credentials", "sync_ops", "sync_peers",
  "sync_device", "signin_install", "signin_sessions", "push_subscriptions", "error_log", "attachments", "share_tokens",
  "agent_sessions", "sync_schema_ver", "revisions", "installs"];
const onDisk = fillTables(all, { filesOnThisDisk: true });
const inBucket = fillTables(all, { filesOnThisDisk: false });
for (const t of ["job_state", "api_credentials", "sync_ops", "sync_peers", "sync_device", "signin_install", "signin_sessions", "push_subscriptions", "agent_sessions", "error_log", "sync_schema_ver"]) {
  check(`never copied: ${t}`, !onDisk.includes(t) && !inBucket.includes(t));
}
check("copied: the owner, items, links, share links, history, roster", ["users", "items", "relations", "share_tokens", "revisions", "installs"].every((t) => onDisk.includes(t)));
check("file records stay behind when the files are on this disk", !onDisk.includes("attachments"));
check("file records go when the files are in a bucket", inBucket.includes("attachments"));

const fks = [
  { tbl: "items", col: "owner_id", ref: "users" },
  { tbl: "items", col: "type", ref: "types" },
  { tbl: "items", col: "parent_id", ref: "items" },
  { tbl: "items", col: "next_action_task_id", ref: "items" },
  { tbl: "types", col: "default_view_id", ref: "views" },
  { tbl: "views", col: "owner_id", ref: "users" },
  { tbl: "relations", col: "source_id", ref: "items" },
  { tbl: "relations", col: "target_id", ref: "items" },
  { tbl: "dashboards", col: "focus_item_id", ref: "items" },
  { tbl: "attachments", col: "parent_item_id", ref: "sync_peers" }, // a ref outside the set is ignored
];
const plan = planFill(["relations", "items", "types", "views", "users", "dashboards"], fks);
const pos = (t: string) => plan.order.indexOf(t);
check("every table appears once", plan.order.length === 6 && new Set(plan.order).size === 6);
check("the owner first", pos("users") === 0);
check("views before types before items", pos("views") < pos("types") && pos("types") < pos("items"));
check("items before what points at them", pos("items") < pos("relations") && pos("items") < pos("dashboards"));
check(
  "an item's links within items wait for the second pass",
  JSON.stringify(plan.deferred.items) === JSON.stringify(["next_action_task_id", "parent_id"])
);
check("nothing else is deferred", Object.keys(plan.deferred).length === 1);
const cyc = planFill(["a", "b"], [{ tbl: "a", col: "b_id", ref: "b" }, { tbl: "b", col: "a_id", ref: "a" }]);
check("a cycle between two tables is broken by deferring one column", cyc.order.length === 2 && Object.values(cyc.deferred).flat().length === 1);
check("deterministic", JSON.stringify(planFill(["relations", "items", "types", "views", "users", "dashboards"], fks)) === JSON.stringify(plan));

// ── 7. Chunks that fit a 4.5 MB, 60-second request ──────────────────────────
console.log("\n7. Chunking");
const rows = Array.from({ length: 1200 }, (_, i) => JSON.stringify({ id: i, t: "x".repeat(900) }));
const packed = packRows(rows, 100_000, 500);
const flat = packed.flatMap((p) => (p.kind === "rows" ? p.rows : [p.row]));
check("nothing lost, order kept", JSON.stringify(flat) === JSON.stringify(rows));
check("each chunk under the byte budget", packed.every((p) => p.kind === "big" || p.rows.join(",").length <= 100_000 + p.rows.length));
check("each chunk under the row cap", packed.every((p) => p.kind === "big" || p.rows.length <= 500));
const big = JSON.stringify({ id: "b", body: "é".repeat(80_000) });
const mixed = packRows([rows[0], big, rows[1]], 100_000);
check("an oversize row travels alone", mixed.length === 3 && mixed[1].kind === "big");
const pieces = splitBytes(big, 30_000);
check("its pieces rebuild it exactly", pieces.join("") === big);
check("no piece over the budget", pieces.every((p) => Buffer.byteLength(p, "utf8") <= 30_000));
check("an empty string is one empty piece", splitBytes("").length === 1);

// ── 8. Will it fit? ─────────────────────────────────────────────────────────
console.log("\n8. The size check");
check("too big for free Neon: refused in words", /would not fit/.test(fitRefusal({ hubBytes: NEON_FREE_BYTES, cloudBytes: 0, cloudOnNeon: true, biggerPlan: false }) ?? ""));
check("fits: no refusal", fitRefusal({ hubBytes: 50 * 1024 * 1024, cloudBytes: 20 * 1024 * 1024, cloudOnNeon: true, biggerPlan: false }) === null);
check("a bigger plan: the owner's word is taken", fitRefusal({ hubBytes: NEON_FREE_BYTES, cloudBytes: 0, cloudOnNeon: true, biggerPlan: true }) === null);
check("not Neon: no free-plan cap applied", fitRefusal({ hubBytes: NEON_FREE_BYTES * 3, cloudBytes: 0, cloudOnNeon: false, biggerPlan: false }) === null);

// ── 9. Addresses ────────────────────────────────────────────────────────────
console.log("\n9. Addresses");
const u = (raw: string) => normalizeCloudUrl(raw);
check("https kept, trimmed to the origin", JSON.stringify(u("https://me.vercel.app/setup?x=1")) === JSON.stringify({ url: "https://me.vercel.app" }));
check("a bare host becomes https", JSON.stringify(u("me.vercel.app")) === JSON.stringify({ url: "https://me.vercel.app" }));
check("plain http refused", "error" in u("http://me.example.com"));
check("plain http allowed for this machine (the test rig)", JSON.stringify(u("http://127.0.0.1:3510")) === JSON.stringify({ url: "http://127.0.0.1:3510" }));
check("public address: an origin", normalizePublicUrl("https://me.vercel.app/x/") === "https://me.vercel.app");
check("public address: junk is none", normalizePublicUrl("javascript:alert(1)") === null && normalizePublicUrl("") === null);
check("public address unset by default", parseSettings({}).publicUrl === null);
check("public address survives a settings round trip", parseSettings({ publicUrl: "https://me.vercel.app" }).publicUrl === "https://me.vercel.app");

// ── 10. Scheduled jobs ──────────────────────────────────────────────────────
console.log("\n10. Scheduled jobs on pairing");
const claim = { deviceId: "hub" };
const jobs = ["export", "calendar-sync", "email-import"];
const { next, moved } = claimUnsetJobs<{ deviceId: string }>({ "calendar-sync": { deviceId: "laptop" }, "email-import": null }, jobs, claim);
check("an unset job moves to the hub", next.export === claim && moved.includes("export"));
check("a job the owner gave a machine stays there", next["calendar-sync"]?.deviceId === "laptop");
check("a job the owner said nobody runs stays that way", next["email-import"] === null);
check("only the moved jobs are reported", JSON.stringify(moved) === JSON.stringify(["export"]));
check("the unset default itself is unchanged (ADR-225)", /DEFAULT_OWNER_LABEL = "Leave it to the cloud"/.test(read("src/lib/job-owners.ts")));

// ── 11. What the page may see ───────────────────────────────────────────────
console.log("\n11. What the owner's page sees");
const view = publicHubPairState({ url: "https://x", code: code, status: "filling", startedAt: "", usePublicUrl: true, deviceToken: "SECRET", deviceId: "d" });
check("never the device token", !JSON.stringify(view).includes("SECRET"));
check("no code once filling (it is spent)", view?.code === null);
check("the code while waiting", publicHubPairState({ url: "https://x", code, status: "waiting", startedAt: "", usePublicUrl: false })?.code === formatPairingCode(code));

// ── 12. Share tokens sync (migration 0066) ──────────────────────────────────
console.log("\n12. Share links sync");
const mig = read("drizzle/0066_share_tokens_sync.sql");
check("share tokens are in the synced set", Object.hasOwn(SYNCED_TABLES, "share_tokens"));
check("insert/delete trigger", /CREATE TRIGGER share_tokens_sync_id AFTER INSERT OR DELETE ON share_tokens/.test(mig));
check("update trigger, only on a real change", /CREATE TRIGGER share_tokens_sync_u AFTER UPDATE ON share_tokens\s+FOR EACH ROW WHEN \(OLD\.\* IS DISTINCT FROM NEW\.\*\)/.test(mig));
check("peers pause until both take it (version stamp bumped)", /UPDATE "sync_schema_ver" SET "ver" = '0066_share_tokens_sync'/.test(mig));
check("additive only: nothing dropped or rewritten", !/\b(DROP|DELETE FROM|TRUNCATE|ALTER TABLE)\b/i.test(mig.replace(/--.*$/gm, "")));
const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { tag: string }[] };
check("journal ends at 0066", journal.entries[journal.entries.length - 1].tag === "0066_share_tokens_sync");
const shareLib = read("src/modules/sharing/lib/share.ts");
check("minting and revoking a link ask for a check-in", (shareLib.match(/nudgeSync\(\)/g) ?? []).length >= 3);
check("the MCP share tool uses the public address", /publicShareOrigin/.test(read("src/modules/sharing/lib/mcp-tools.ts")));
check("the share control uses it, falling back to the browser's", /base \?\? window\.location\.origin/.test(read("src/modules/sharing/components/ShareLink.tsx")));

// ── 13. Source guards on the doors ──────────────────────────────────────────
console.log("\n13. Source guards");
const cloud = read("src/lib/sync/pairing-cloud.ts");
check("the claim is a compare-and-set on the matched code", /value->>'status' = 'code' and value->>'codeHash' = \$\{storedHash\}/.test(cloud));
check("a lost race removes its device again", /setPeerRevoked\(peer\.deviceId, true\)/.test(cloud));
check("the owner row only arrives through begin", /the owner row is sent with begin/.test(cloud));
check("a resumed begin refuses a different owner", /r\.id !== owner\.id/.test(cloud));
check("the fill pauses only sync triggers, in the same transaction", /disable trigger user/.test(cloud) && /enable trigger user/.test(cloud));
check("the fill route checks the device token", /verifySyncDevice/.test(read("src/app/api/machine/pair/fill/route.ts")));
const hub = read("src/lib/sync/pairing-hub.ts");
check("the hub reads one consistent snapshot", /isolationLevel: "repeatable read", accessMode: "read only"/.test(hub));
check("the cursor is written before the copy is listed", hub.indexOf("await writeCursor(") < hub.indexOf("await writeSyncHubs("));
check("the hub refuses a copy with an owner or data before showing a code", /cloud\.unclaimed !== true/.test(hub));

console.log(failures === 0 ? "\nAll pairing checks passed." : `\n${failures} pairing check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
