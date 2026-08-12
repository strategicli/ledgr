import { existsSync, readFileSync } from "node:fs";

// .env.local is gitignored, so it is present locally and ABSENT in CI. A bare
// readFileSync here used to throw ENOENT, which is why this script passed on a
// developer machine and failed on CI's first run. The load is optional — the
// checks below assert whichever branch the env puts them in.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const haveR2 =
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET &&
  process.env.R2_ENDPOINT;

if (!haveR2) {
  console.log("SKIP  R2 not configured (R2_* env unset) — storage round-trip not run");
  process.exit(0);
}

// The provider's publicUrl needs R2_PUBLIC_BASE_URL; the round-trip below reads
// back through a signed GET to the object endpoint instead, so an empty public
// base (the current dev state) doesn't block verification.
process.env.R2_PUBLIC_BASE_URL ||= "https://example.invalid";

const { R2Provider } = await import("../src/lib/storage/r2");
const { AwsClient } = await import("aws4fetch");

const provider = new R2Provider({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: process.env.R2_BUCKET!,
  endpoint: process.env.R2_ENDPOINT!,
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL!,
});

const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  service: "s3",
  region: "auto",
});
function objectUrl(key: string): URL {
  const base = process.env.R2_ENDPOINT!.replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`${base}/${process.env.R2_BUCKET}/${path}`);
}

console.log("\n# Live: R2 putObject round-trip (put -> signed GET -> length match -> delete)");
// Mirror the email-in construction: base64 -> Buffer -> Uint8Array, across the
// shapes a real message yields (empty, tiny, multi-MB).
const cases = [
  { name: "empty (0 bytes)", n: 0 },
  { name: "small (100 bytes)", n: 100 },
  { name: "multi-MB (3 MB)", n: 3_000_000 },
];

for (const c of cases) {
  const bytes = new Uint8Array(Buffer.from(Buffer.alloc(c.n, 0x41).toString("base64"), "base64"));
  const key = `__verify__/r2-${c.n}-${bytes.byteLength}.bin`;
  let stored = false;
  try {
    await provider.putObject(key, bytes, "application/octet-stream");
    stored = true;
    const getRes = await fetch(await client.sign(new Request(objectUrl(key), { method: "GET" })));
    const got = new Uint8Array(await getRes.arrayBuffer());
    check(
      `${c.name}: stored bytes read back at exact length`,
      getRes.ok && got.byteLength === bytes.byteLength,
      `status=${getRes.status} put=${bytes.byteLength} got=${got.byteLength}`
    );
  } catch (e) {
    check(`${c.name}: putObject succeeds (no 411)`, false, (e as Error).message);
  } finally {
    if (stored) await provider.deleteObject(key).catch(() => {});
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
