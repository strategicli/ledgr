// Cold-share fix (ADR-191) verification: the pure helpers behind the anonymous
// share-target path — claim-query building and stash-id validation. No DB, no
// server; just the two functions that keep this route from ever reading an
// arbitrary storage key or losing an empty share.
// Run: npx tsx scripts/verify-share-claim.mts
import { buildClaimQuery } from "../src/app/capture/share/route";
import { isValidStashId } from "../src/app/capture/share/claim/route";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- buildClaimQuery -------------------------------------------------------
check(
  "encodes and joins title/text/url",
  buildClaimQuery({ title: "Hi there", text: "body", url: "https://a.b/c" }) ===
    "title=Hi+there&text=body&url=https%3A%2F%2Fa.b%2Fc"
);
check("omits empty fields", buildClaimQuery({ title: "only this" }) === "title=only+this");
check("all-empty share yields an empty query", buildClaimQuery({}) === "");
check(
  "a long text share is still valid query syntax (caller decides the size fallback)",
  new URLSearchParams(buildClaimQuery({ text: "x".repeat(10_000) })).get("text")?.length === 10_000
);

// --- isValidStashId ---------------------------------------------------------
check("accepts a real UUID", isValidStashId(crypto.randomUUID()));
check("rejects null", !isValidStashId(null));
check("rejects the empty string", !isValidStashId(""));
check("rejects a path-traversal attempt", !isValidStashId("../../etc/passwd"));
check("rejects a key with the stash prefix baked in", !isValidStashId("share-stash/abc.json"));
check("rejects a near-miss UUID (wrong grouping)", !isValidStashId("123e4567e89b12d3a456426614174000"));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
