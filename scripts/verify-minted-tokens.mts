// ADR-160 verification: browser-minted API tokens as pure functions (no DB, no
// browser). This file running in plain node IS the proof that the crypto holds:
//
//  1. Roundtrip — a minted MCP token verifies on the MCP path; a minted clipper
//     token verifies on the api path (both via the shared verifiers).
//  2. THE property Brandon asked for: per-purpose kill switch. Rotating the
//     clipper secret invalidates every clipper token while MCP tokens (signed by
//     a different secret) keep working — and vice versa. The secrets are isolated.
//  3. Scope enforcement — a clipper (`api`) token is not accepted where `mcp` is
//     required, and an MCP token is not accepted where `api` is required.
//  4. verifyApiToken accepts EITHER a static LEDGR_API_TOKENS token or a minted
//     clipper token (the two credential paths coexist).
//  5. Tamper + expiry are rejected.
//
//   npx tsx scripts/verify-minted-tokens.mts
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Secrets must exist before the module reads them (it reads process.env live).
process.env.LEDGR_OAUTH_SECRET = "oauth-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.LEDGR_CLIPPER_SECRET = "clipper-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
// A static api token (raw → sha256 entry), to prove the OR-branch of verifyApiToken.
const STATIC_RAW = "lgr_staticstaticstaticstatic";
const staticHash = createHash("sha256").update(STATIC_RAW).digest("hex");
process.env.LEDGR_API_TOKENS = `savor:api:${staticHash}`;

const {
  signMcpToken,
  signClipperToken,
  verifyClipperToken,
  verifyApiToken,
  verifyAccessToken,
  issueAccessToken,
  clipperConfigured,
  MCP_SCOPE,
} = await import("../src/lib/auth/oauth.js");

const bearer = (t: string) => `Bearer ${t}`;
const SUB = "owner@example.com";

// 1. Roundtrip.
const mcp = signMcpToken(SUB);
const clip = signClipperToken(SUB);
assert.equal(verifyAccessToken(bearer(mcp), MCP_SCOPE)?.sub, SUB, "mcp token verifies on mcp path");
assert.equal(verifyClipperToken(bearer(clip))?.sub, SUB, "clipper token verifies");
assert.ok(verifyApiToken(bearer(clip)), "clipper token accepted by verifyApiToken");
assert.equal(clipperConfigured(), true, "clipper configured when secret set");

// 3. Scope / secret isolation: neither token works on the other's path.
assert.equal(verifyClipperToken(bearer(mcp)), null, "mcp token rejected as clipper (wrong secret)");
assert.equal(verifyAccessToken(bearer(clip), MCP_SCOPE), null, "clipper token rejected on mcp scope");

// 4. Static LEDGR_API_TOKENS token also satisfies verifyApiToken.
assert.equal(verifyApiToken(bearer(STATIC_RAW))?.name, "savor", "static api token accepted");
assert.equal(verifyApiToken(bearer("lgr_wrong")), null, "unknown token rejected");

// 2. Per-purpose kill switch: rotate the clipper secret → clipper tokens die,
//    MCP tokens (other secret) survive.
process.env.LEDGR_CLIPPER_SECRET = "clipper-secret-ROTATED-cccccccccccccccccc";
assert.equal(verifyClipperToken(bearer(clip)), null, "clipper token dies after clipper-secret rotation");
assert.equal(verifyAccessToken(bearer(mcp), MCP_SCOPE)?.sub, SUB, "MCP token unaffected by clipper rotation");
// Symmetric: rotating the oauth secret kills MCP tokens but a fresh clipper token (new secret) is fine.
const freshClip = signClipperToken(SUB);
process.env.LEDGR_OAUTH_SECRET = "oauth-secret-ROTATED-dddddddddddddddddddd";
assert.equal(verifyAccessToken(bearer(mcp), MCP_SCOPE), null, "MCP token dies after oauth-secret rotation");
assert.equal(verifyClipperToken(bearer(freshClip))?.sub, SUB, "clipper token unaffected by oauth rotation");

// 5. Tamper + expiry.
const good = signClipperToken(SUB);
const tampered = good.slice(0, -2) + (good.endsWith("A") ? "B" : "A");
assert.equal(verifyClipperToken(bearer(tampered)), null, "tampered signature rejected");
const expired = issueAccessToken(SUB, "api", -10, process.env.LEDGR_CLIPPER_SECRET);
assert.equal(verifyClipperToken(bearer(expired)), null, "expired token rejected");

console.log("verify-minted-tokens: all assertions passed ✓");
