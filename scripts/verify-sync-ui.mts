// Verification for the phase-3 sync surfaces (ADR-206): the pure seams behind
// Synced-devices management, the /api/sync/status shape, and the nav pill's
// gate. All pure — no database — so verify-ci.mjs discovers and runs it.
//
// Run: npx tsx scripts/verify-sync-ui.mts
import { digestsMatch, hashToken } from "../src/lib/auth/machine";
import {
  buildSyncStatus,
  parseHubs,
  type SyncStatus,
} from "../src/lib/sync/client";
import { cursorLag, deleteRefusal, generateSyncToken } from "../src/lib/sync/peers";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// ── Device tokens (plan decision 15) ─────────────────────────────────────────

{
  const token = generateSyncToken();
  // 32 bytes → 43 base64url chars, no padding, URL-safe alphabet only.
  check("token is base64url with no padding", /^[A-Za-z0-9_-]+$/.test(token));
  check("token carries ~32 bytes of entropy", token.length >= 43, `len ${token.length}`);
  check("tokens are unique per mint", generateSyncToken() !== token);

  // Hash round-trip: what createPeer stores is what verifySyncDevice compares.
  const digest = hashToken(token);
  check("stored hash is a sha256 hex digest", /^[0-9a-f]{64}$/.test(digest));
  check("same token matches its stored hash", digestsMatch(hashToken(token), digest));
  check(
    "a different token never matches",
    !digestsMatch(hashToken(generateSyncToken()), digest)
  );
}

// ── Cursor lag (the "n ops behind" column) ───────────────────────────────────

check("lag = hub max seq minus pull cursor", cursorLag(100, 40) === 60);
check("fully caught up reads 0", cursorLag(75, 75) === 0);
check("a cursor ahead of the read max never goes negative", cursorLag(40, 100) === 0);
check("a never-synced peer is behind by the whole oplog", cursorLag(12, 0) === 12);

// ── Peer lifecycle (delete requires revoked) ─────────────────────────────────

check("deleting a live device is refused", typeof deleteRefusal(false) === "string");
check("deleting a revoked device is allowed", deleteRefusal(true) === null);

// ── Hub-list parsing = the nav pill's server gate ────────────────────────────

check("no env → no hubs (pill unmounted)", parseHubs(undefined).length === 0);
check("empty env → no hubs", parseHubs("").length === 0);
check("whitespace/empty entries are dropped", parseHubs(" , ,").length === 0);
{
  const hubs = parseHubs(" https://a.example , https://b.example ,, ");
  check(
    "ordered hub list parses trimmed",
    hubs.length === 2 && hubs[0] === "https://a.example" && hubs[1] === "https://b.example"
  );
}

// ── /api/sync/status response shapes ─────────────────────────────────────────

const base: SyncStatus = {
  state: "synced",
  pendingOps: 0,
  activeHubIndex: 0,
  lastSyncAt: "2026-08-22T10:00:00.000Z",
  lastError: null,
};

{
  const disabled = buildSyncStatus([], base, 0);
  check("disabled shape is exactly {enabled: false}",
    disabled.enabled === false && Object.keys(disabled).length === 1
  );
}

{
  const s = buildSyncStatus(["h1", "h2"], base, 0);
  check(
    "enabled shape carries state/pendingOps/hub fields",
    s.enabled === true &&
      s.state === "synced" &&
      s.pendingOps === 0 &&
      s.activeHubIndex === 0 &&
      s.hubCount === 2 &&
      s.lastSyncAt === base.lastSyncAt &&
      s.lastError === null
  );
}

{
  // Unpushed local writes between loop runs flip a stale "synced" to pending.
  const s = buildSyncStatus(["h1"], base, 3);
  check(
    "on-demand pendingOps overrides the loop's stale count",
    s.enabled === true && s.pendingOps === 3 && s.state === "pending"
  );
}

{
  // Offline stays offline no matter the backlog; the count still reports.
  const s = buildSyncStatus(["h1"], { ...base, state: "offline", lastError: "x" }, 7);
  check(
    "offline is not masked by the pending flip",
    s.enabled === true && s.state === "offline" && s.pendingOps === 7
  );
}

// ─────────────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} FAILURE${failures === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nAll sync-ui checks passed.");
