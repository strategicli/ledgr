// Verification for the phase-3 sync surfaces (ADR-206): the pure seams behind
// Synced-devices management, the /api/sync/status shape, and the nav pill's
// gate. All pure — no database — so verify-ci.mjs discovers and runs it.
//
// Run: npx tsx scripts/verify-sync-ui.mts
import { digestsMatch, hashToken } from "../src/lib/auth/machine";
import {
  buildSyncStatus,
  effectiveHubs,
  effectiveSyncMode,
  getSyncStatus,
  checkFirstPush,
  classifySkew,
  parseHubs,
  parseSyncMode,
  selectPushOps,
  type SyncStatus,
} from "../src/lib/sync/client";
import {
  cursorLag,
  deleteRefusal,
  generateSyncToken,
  pullOnlyRejectsPush,
} from "../src/lib/sync/peers";

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

// ── Guardrail 1: pull-only ───────────────────────────────────────────────────

check("full sync mode is the default", parseSyncMode(undefined) === "full");
check("unrecognized env falls back to full", parseSyncMode("nonsense") === "full");
check("pull-only is recognized", parseSyncMode("pull-only") === "pull-only");

check(
  "hub refuses a non-empty push from a pull-only device",
  pullOnlyRejectsPush(true, 3) === true
);
check(
  "hub allows an empty push (pull) from a pull-only device",
  pullOnlyRejectsPush(true, 0) === false
);
check("hub allows any push from a full device", pullOnlyRejectsPush(false, 500) === false);

{
  // The client's own decision never sends ops in pull-only mode, no matter
  // how big the backlog or how done firstPushDone already is.
  const sel = selectPushOps({
    mode: "pull-only",
    candidateOps: [],
    pendingCount: 999999,
    firstPushDone: false,
    maxFirstPush: 500,
    confirmLargePush: false,
    skewMs: null,
    skewWarnMs: 5000,
    skewHoldMs: 60000,
  });
  check(
    "pull-only mode sends zero ops regardless of backlog",
    sel.ops.length === 0 && sel.holdReason === null
  );
}

// ── Guardrail 2: first-push size guard ───────────────────────────────────────

const fpBase = { firstPushDone: false, maxFirstPush: 500, confirmLargePush: false };

check(
  "just under the limit pushes",
  checkFirstPush({ ...fpBase, pendingCount: 499 }).hold === false
);
check(
  "exactly at the limit pushes (only EXCEEDING holds)",
  checkFirstPush({ ...fpBase, pendingCount: 500 }).hold === false
);
check(
  "just over the limit holds",
  checkFirstPush({ ...fpBase, pendingCount: 501 }).hold === true
);
check(
  "a held check does not consume the one-shot gate",
  checkFirstPush({ ...fpBase, pendingCount: 501 }).done === false
);
check(
  "a passed check consumes the one-shot gate",
  checkFirstPush({ ...fpBase, pendingCount: 499 }).done === true
);
check(
  "confirmLargePush releases an over-limit push",
  checkFirstPush({ ...fpBase, pendingCount: 100000, confirmLargePush: true }).hold === false
);
check(
  "once firstPushDone, a huge backlog is never gated again (a busy spoke isn't throttled)",
  checkFirstPush({ ...fpBase, pendingCount: 100000, firstPushDone: true }).hold === false
);
check(
  "the held reason names the release path",
  /maxFirstPush/.test((checkFirstPush({ ...fpBase, pendingCount: 501 }) as { reason: string }).reason) &&
    /confirmLargePush/.test((checkFirstPush({ ...fpBase, pendingCount: 501 }) as { reason: string }).reason)
);

{
  // selectPushOps end-to-end: a first over-limit round holds and does NOT
  // consume the gate; a second round with the same backlog (simulating the
  // owner having raised confirmLargePush) pushes and DOES consume it; a
  // third round with an even bigger backlog is not gated (second push rule).
  const candidateOps = [{ seq: 1 } as never];
  const round1 = selectPushOps({
    mode: "full",
    candidateOps,
    pendingCount: 600,
    firstPushDone: false,
    maxFirstPush: 500,
    confirmLargePush: false,
    skewMs: null,
    skewWarnMs: 5000,
    skewHoldMs: 60000,
  });
  check(
    "round 1: an oversized first push holds and reports the count",
    round1.ops.length === 0 && round1.holdReason === "first_push_size" && round1.heldOpsCount === 600
  );
  const round2 = selectPushOps({
    mode: "full",
    candidateOps,
    pendingCount: 600,
    firstPushDone: round1.firstPushDoneAfter,
    maxFirstPush: 500,
    confirmLargePush: true,
    skewMs: null,
    skewWarnMs: 5000,
    skewHoldMs: 60000,
  });
  check(
    "round 2: confirmLargePush releases it and the gate is now consumed",
    round2.ops === candidateOps && round2.firstPushDoneAfter === true
  );
  const round3 = selectPushOps({
    mode: "full",
    candidateOps,
    pendingCount: 5_000_000,
    firstPushDone: round2.firstPushDoneAfter,
    maxFirstPush: 500,
    confirmLargePush: false,
    skewMs: null,
    skewWarnMs: 5000,
    skewHoldMs: 60000,
  });
  check(
    "round 3 (the SECOND real push): never gated even at a much bigger size",
    round3.ops === candidateOps && round3.holdReason === null
  );
}

// ── Guardrail 3: clock-skew detection ────────────────────────────────────────

check("well within thresholds classifies ok", classifySkew(1000, 5000, 60000) === "ok");
check("at the warn threshold classifies warn", classifySkew(5000, 5000, 60000) === "warn");
check("just under warn classifies ok", classifySkew(4999, 5000, 60000) === "ok");
check("between warn and hold classifies warn", classifySkew(30000, 5000, 60000) === "warn");
check("at the hold threshold classifies hold", classifySkew(60000, 5000, 60000) === "hold");
check("over the hold threshold classifies hold", classifySkew(120000, 5000, 60000) === "hold");
check(
  "negative skew (hub behind spoke) classifies the same as positive",
  classifySkew(-70000, 5000, 60000) === "hold" && classifySkew(-1000, 5000, 60000) === "ok"
);

{
  // A hold-level skew withholds push but is independent of firstPushDone —
  // it can trip on the 100th push, not just the first.
  const sel = selectPushOps({
    mode: "full",
    candidateOps: [{ seq: 1 } as never],
    pendingCount: 1,
    firstPushDone: true,
    maxFirstPush: 500,
    confirmLargePush: false,
    skewMs: 90000,
    skewWarnMs: 5000,
    skewHoldMs: 60000,
  });
  check(
    "a clock-skew hold withholds push even after the first-push gate is long done",
    sel.ops.length === 0 && sel.holdReason === "clock_skew" && sel.firstPushDoneAfter === true
  );
}

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
  holdReason: null,
  heldOpsCount: null,
  skewMs: null,
  skewWarn: false,
  hubs: [],
};

{
  const disabled = buildSyncStatus([], base, 0, "full");
  check("disabled shape is exactly {enabled: false}",
    disabled.enabled === false && Object.keys(disabled).length === 1
  );
}

{
  const s = buildSyncStatus(["h1", "h2"], base, 0, "full");
  check(
    "enabled shape carries state/pendingOps/hub/mode fields",
    s.enabled === true &&
      s.state === "synced" &&
      s.pendingOps === 0 &&
      s.activeHubIndex === 0 &&
      s.hubCount === 2 &&
      s.mode === "full" &&
      s.lastSyncAt === base.lastSyncAt &&
      s.lastError === null
  );
}

{
  // Unpushed local writes between loop runs flip a stale "synced" to pending.
  const s = buildSyncStatus(["h1"], base, 3, "full");
  check(
    "on-demand pendingOps overrides the loop's stale count",
    s.enabled === true && s.pendingOps === 3 && s.state === "pending"
  );
}

{
  // Offline stays offline no matter the backlog; the count still reports.
  const s = buildSyncStatus(["h1"], { ...base, state: "offline", lastError: "x" }, 7, "full");
  check(
    "offline is not masked by the pending flip",
    s.enabled === true && s.state === "offline" && s.pendingOps === 7
  );
}

{
  // A held push is not masked or upgraded by the pendingOps recompute either.
  const s = buildSyncStatus(
    ["h1"],
    { ...base, state: "held", holdReason: "first_push_size", heldOpsCount: 600 },
    600,
    "full"
  );
  check(
    "held state carries its reason and count through untouched",
    s.enabled === true &&
      s.state === "held" &&
      s.holdReason === "first_push_size" &&
      s.heldOpsCount === 600
  );
}

{
  // Pull-only mode is reported even while otherwise fully synced.
  const s = buildSyncStatus(["h1"], base, 0, "pull-only");
  check("pull-only mode is carried into the response", s.enabled === true && s.mode === "pull-only");
}

{
  // A warn-level skew surfaces even when nothing is held.
  const s = buildSyncStatus(["h1"], { ...base, skewMs: 8000, skewWarn: true }, 0, "full");
  check(
    "skew fields surface even when the state is otherwise synced",
    s.enabled === true && s.state === "synced" && s.skewWarn === true && s.skewMs === 8000
  );
}

{
  // Skew can be negative (hub behind spoke) and still reports as-is.
  const s = buildSyncStatus(["h1"], { ...base, skewMs: -75000, skewWarn: true }, 0, "full");
  check("negative skew round-trips through the status shape", s.enabled === true && s.skewMs === -75000);
}

// ── The effective push mode: a stored override beats the env default ────────
//
// LEDGR_SYNC_MODE used to be the only source, which meant arming a spoke took
// a config-file edit and a restart. The override lives in job_state (outside
// the synced set, so it can never replicate to another peer) and the loop
// re-reads it per tick.
{
  check("a stored override wins over the env default", effectiveSyncMode("pull-only", "full") === "pull-only");
  check("the other direction too", effectiveSyncMode("full", "pull-only") === "full");
  check("no override falls back to the env value", effectiveSyncMode(undefined, "pull-only") === "pull-only");
  check("garbage in the override is ignored, not obeyed", effectiveSyncMode("yolo", "pull-only") === "pull-only");
  check("nothing anywhere means full (the shipped default)", effectiveSyncMode(null, undefined) === "full");
}

// ── The effective hub list: stored wins, even empty (ADR-209) ───────────────
//
// The env pair (LEDGR_SYNC_HUBS + one LEDGR_SYNC_TOKEN) is only the initial
// value; the Network page edits a job_state list carrying a token PER hub.
// An empty STORED list means "the owner removed every hub", never "fall back
// to config" — otherwise removing the last hub would silently resurrect it.
{
  const stored = [{ url: "https://a.example", token: "ta" }];
  check(
    "a stored hub list wins over env",
    JSON.stringify(effectiveHubs(stored, "https://env.example", "tenv")) === JSON.stringify(stored)
  );
  check(
    "an EMPTY stored list means no hubs, not env fallback",
    effectiveHubs([], "https://env.example", "tenv").length === 0
  );
  check(
    "no stored list falls back to env, same token on each",
    JSON.stringify(effectiveHubs(undefined, "https://a.example, https://b.example", "t1")) ===
      JSON.stringify([
        { url: "https://a.example", token: "t1" },
        { url: "https://b.example", token: "t1" },
      ])
  );
  check("env hubs without a token arm nothing", effectiveHubs(undefined, "https://a.example", undefined).length === 0);
  check(
    "malformed stored entries are dropped, not obeyed",
    effectiveHubs([{ url: "https://a.example" }, { token: "x" }, null, "junk"], undefined, undefined).length === 0
  );
}

// ── The loop's status must live on globalThis, not in module scope ──────────
//
// The bug this guards (2026-08-22, first real spoke): /api/sync/status and
// /build/updates reported "Offline, never synced" while the database proved
// the peer was pulling. Next emits the instrumentation hook and the route
// handlers as separate server chunks, each carrying its own copy of
// src/lib/sync/client.ts, so the loop mutated one module instance's status
// object and every reader read another's, permanently at its defaults.
// A second instance can only see the loop's writes if the state lives
// somewhere both instances reach.
{
  const holder = (globalThis as { __ledgrSync?: { status: SyncStatus } }).__ledgrSync;
  check("the loop's status is held on globalThis, reachable from a second module instance", !!holder);
  if (holder) {
    // Mutating the holder is what the loop does; getSyncStatus is what a
    // route handler in the other chunk calls. They have to be the same object.
    const stamp = "2026-08-22T00:00:00.000Z";
    holder.status.lastSyncAt = stamp;
    check("getSyncStatus reads that same object, not a module-private copy", getSyncStatus().lastSyncAt === stamp);
    holder.status.lastSyncAt = null;
  }
  // getSyncStatus still hands out a COPY, so a reader cannot write the loop's
  // state by accident.
  check("getSyncStatus still returns a copy", getSyncStatus() !== getSyncStatus());
}

// ─────────────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} FAILURE${failures === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nAll sync-ui checks passed.");
