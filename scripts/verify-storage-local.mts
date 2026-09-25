// Files on local disk (the self-hosted install with no R2 bucket): the signed
// URLs, the path safety, the upload and download handlers end to end against a
// temp folder, provider selection, and the snapshot file store that makes a
// restore point include the files. Pure: no database, no server.
//
//   npx tsx scripts/verify-storage-local.mts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  grantIsValid,
  grantUrl,
  isSafeKey,
  keyPath,
  LocalDiskProvider,
  parseRange,
  type LocalGrant,
} from "@/lib/storage/local";
import { absoluteStorageUrl, getStorage } from "@/lib/storage";
import {
  captureFiles,
  filesManifestPath,
  pruneSnapshotFiles,
  snapshotFilesStore,
  writeFilesManifest,
} from "@/modules/snapshots/lib/snapshots";

let checks = 0;
async function ok(what: string, fn: () => void | Promise<void>) {
  await fn();
  checks += 1;
  console.log(`  ✓ ${what}`);
}

const secret = Buffer.alloc(32, 7);
const now = 1_900_000_000;
const put: LocalGrant = { op: "put", key: "o/i/a.png", exp: now + 900, ct: "image/png", n: 10 };
const sigOf = (g: LocalGrant) => new URL(grantUrl(secret, g), "http://x").searchParams.get("sig")!;

console.log("Local-disk storage\n");

// ── Signed grants ───────────────────────────────────────────────────────────

await ok("a grant verifies with its own signature", () => {
  assert.ok(grantIsValid(secret, put, sigOf(put), now));
});
await ok("changing any signed field breaks the signature", () => {
  const sig = sigOf(put);
  assert.ok(!grantIsValid(secret, { ...put, key: "o/i/b.png" }, sig, now));
  assert.ok(!grantIsValid(secret, { ...put, ct: "text/html" }, sig, now));
  assert.ok(!grantIsValid(secret, { ...put, n: 11 }, sig, now));
  assert.ok(!grantIsValid(secret, { ...put, exp: put.exp + 1 }, sig, now));
  assert.ok(!grantIsValid(secret, { ...put, op: "get", ct: "", n: 0 }, sig, now));
  assert.ok(!grantIsValid(Buffer.alloc(32, 8), put, sig, now));
  assert.ok(!grantIsValid(secret, put, "", now));
  assert.ok(!grantIsValid(secret, put, sig.slice(1), now));
});
await ok("an expired grant, or one claiming more than a day, is refused", () => {
  assert.ok(!grantIsValid(secret, put, sigOf(put), put.exp + 1));
  const far = { ...put, exp: now + 2 * 86400 };
  assert.ok(!grantIsValid(secret, far, sigOf(far), now));
});

// ── Key safety ──────────────────────────────────────────────────────────────

await ok("keys we mint are safe", () => {
  for (const k of ["a/b/photo.png", "share-stash/x.json", "o/i/My_File_(1).pdf", "o/i/_con.txt"]) {
    assert.ok(isSafeKey(k), k);
  }
});
await ok("traversal, separators, devices and Windows traps are not", () => {
  for (const k of [
    "", "../x", "a/../b", "a/./b", "a//b", "/abs", "a\\b", "C:/x", "a/b:c", "a/\u0000b",
    "a/con", "a/NUL.txt", "a/com1.log", "a/b.", "a/b ", "a/.part", "a/b?c", "a/b|c",
  ]) {
    assert.ok(!isSafeKey(k), JSON.stringify(k));
  }
  assert.ok(!isSafeKey(42));
});
await ok("keyPath stays inside the root, and throws otherwise", () => {
  const root = resolve(tmpdir(), "ledgr-root");
  assert.ok(keyPath(root, "a/b.png").startsWith(root));
  assert.throws(() => keyPath(root, "../escape"));
  assert.throws(() => keyPath(root, "a/../../escape"));
});

// ── Range ───────────────────────────────────────────────────────────────────

await ok("range headers parse the way browsers send them", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=0-1,5-6", 100), null);
  assert.equal(parseRange("bytes=9-3", 100), null);
});

// ── End to end, in a temp folder ────────────────────────────────────────────

const data = mkdtempSync(join(tmpdir(), "ledgr-local-storage-"));
const root = join(data, "files");
const disk = new LocalDiskProvider(root, join(data, "file-signing.key"));
const base = "http://127.0.0.1:3300";
const bytes = new TextEncoder().encode("hello, local disk");
const key = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/hello.txt";

function req(url: string, init: RequestInit & { duplex?: "half" } = {}) {
  const u = new URL(url, base);
  return { r: new Request(u, { duplex: "half", ...init } as RequestInit), key, q: u.searchParams };
}

try {
  const { uploadUrl } = await disk.presignUpload(key, "text/plain", bytes.length);
  assert.ok(uploadUrl.startsWith("/files/local/"), uploadUrl);

  await ok("a PUT with the wrong Content-Type is refused, like R2's signature check", async () => {
    const { r, q } = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/html" }, body: bytes });
    assert.equal((await disk.servePut(r, key, q)).status, 403);
  });
  await ok("a PUT larger than the reserved size is refused and leaves nothing behind", async () => {
    const big = new Uint8Array(bytes.length + 1);
    const withLength = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain", "content-length": String(big.length) }, body: big });
    assert.equal((await disk.servePut(withLength.r, key, withLength.q)).status, 413);
    // No Content-Length: caught mid-stream instead.
    const stream = new ReadableStream({ start(c) { c.enqueue(big); c.close(); } });
    const streamed = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: stream });
    assert.equal((await disk.servePut(streamed.r, key, streamed.q)).status, 413);
    assert.ok(!existsSync(keyPath(root, key)));
    assert.deepEqual(readdirSync(join(root, ...key.split("/").slice(0, 2))), [], "a .part was left");
  });
  await ok("a body shorter than its Content-Length (cut off in transit) is refused", async () => {
    const { r, q } = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain", "content-length": String(bytes.length) }, body: bytes.slice(0, 3) });
    assert.equal((await disk.servePut(r, key, q)).status, 400);
    assert.ok(!existsSync(keyPath(root, key)));
  });
  await ok("the signed PUT stores the bytes under the key", async () => {
    const { r, q } = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes });
    assert.equal((await disk.servePut(r, key, q)).status, 200);
    assert.equal(readFileSync(keyPath(root, key), "utf8"), "hello, local disk");
  });
  await ok("an upload URL used as a download, or a tampered one, is refused", async () => {
    const asGet = req(uploadUrl);
    assert.equal((await disk.serveGet(asGet.r, key, asGet.q)).status, 403);
    const other = req(uploadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes });
    assert.equal((await disk.servePut(other.r, key.replace("hello", "other"), other.q)).status, 403);
  });

  const downloadUrl = await disk.presignDownload(key);
  await ok("the signed GET serves the bytes with the safety headers", async () => {
    const { r, q } = req(downloadUrl);
    const res = await disk.serveGet(r, key, q);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello, local disk");
    assert.equal(res.headers.get("content-type"), "text/plain");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox\b/);
  });
  await ok("a Range request gets a 206 with just those bytes", async () => {
    const { r, q } = req(downloadUrl, { headers: { range: "bytes=7-10" } });
    const res = await disk.serveGet(r, key, q);
    assert.equal(res.status, 206);
    assert.equal(await res.text(), "loca");
    assert.equal(res.headers.get("content-range"), `bytes 7-10/${bytes.length}`);
  });
  await ok("a download URL can't be used to upload", async () => {
    const { r, q } = req(downloadUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes });
    assert.equal((await disk.servePut(r, key, q)).status, 403);
  });
  await ok("server-side reads and listing see the file; a .part in flight is ignored", async () => {
    assert.equal(await (await disk.getObject(key)).text(), "hello, local disk");
    assert.equal((await disk.getObject(key.replace("hello", "nope"))).status, 404);
    writeFileSync(join(root, ".stray.part"), "x");
    const listed = await disk.listObjects("11111111-");
    assert.deepEqual(listed, [{ key, sizeBytes: bytes.length }]);
  });
  await ok("putObject writes, deleteObject removes and tidies the per-file folder", async () => {
    const k2 = "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/b.bin";
    await disk.putObject(k2, new Uint8Array([1, 2, 3]), "application/octet-stream");
    assert.equal((await disk.getObject(k2)).headers.get("content-length"), "3");
    await disk.deleteObject(k2);
    assert.ok(!existsSync(join(root, ...k2.split("/").slice(0, 2))));
    await disk.deleteObject(k2); // already gone is success
  });
  await ok("a file listed in Ledgr but missing on disk says so", async () => {
    const k3 = key.replace("hello", "gone");
    const url = await disk.presignDownload(k3);
    const { r, q } = req(url);
    const res = await disk.serveGet(r, k3, q);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /missing from this computer/);
  });
  await ok("an HTML upload runs live but in an opaque origin; a PDF is not sandboxed (the viewer needs it)", async () => {
    const h = "00000000-0000-4000-8000-000000000000/i/page.html";
    await disk.putObject(h, new TextEncoder().encode("<script>x</script>"), "text/html");
    const { r, q } = req(await disk.presignDownload(h));
    const res = await disk.serveGet(r, h, q);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /^sandbox\b/);
    assert.match(csp, /allow-scripts/, "the File type promises a live page");
    assert.ok(!/allow-same-origin/.test(csp), "allow-same-origin would hand the page Ledgr's cookies");
    const p = h.replace("page.html", "doc.pdf");
    await disk.putObject(p, new Uint8Array([37, 80, 68, 70]), "application/pdf");
    const pr = req(await disk.presignDownload(p));
    assert.equal((await disk.serveGet(pr.r, p, pr.q)).headers.get("content-security-policy"), null);
  });

  // ── Selection ───────────────────────────────────────────────────────────

  await ok("R2 wins when configured; local disk only under the supervisor, never on Vercel", () => {
    const saved = { ...process.env };
    const r2 = { R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_BUCKET: "c", R2_ENDPOINT: "https://e.invalid" };
    const clear = () => {
      for (const k of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "LEDGR_SUPERVISOR_DIR", "VERCEL", "VERCEL_ENV"]) delete process.env[k];
    };
    try {
      clear();
      assert.equal(getStorage(), null);
      Object.assign(process.env, r2, { LEDGR_SUPERVISOR_DIR: data });
      assert.equal(getStorage()?.kind, "r2");
      clear();
      process.env.LEDGR_SUPERVISOR_DIR = data;
      assert.equal(getStorage()?.kind, "local");
      process.env.VERCEL = "1";
      assert.equal(getStorage(), null);
    } finally {
      clear();
      Object.assign(process.env, saved);
    }
  });
  await ok("a relative storage URL is made absolute for agents; R2's passes through", () => {
    assert.equal(absoluteStorageUrl("/files/local/a?x=1", "http://hub:3000"), "http://hub:3000/files/local/a?x=1");
    assert.equal(absoluteStorageUrl("https://r2.example/a", "http://hub:3000"), "https://r2.example/a");
  });
  await ok("the proxy never sees /files/local/ (it would cut uploads at 10MB)", () => {
    assert.match(readFileSync("src/proxy.ts", "utf8"), /\(\?!health\|_next\|files\/local\/\|/);
  });

  // ── Restore points include the files ────────────────────────────────────

  await ok("a snapshot keeps a file that is deleted afterwards, and prune lets it go later", async () => {
    const snaps = join(data, "snapshots");
    const name = "2026-09-25T10-00-00Z.dump";
    mkdirSync(snaps, { recursive: true });
    writeFileSync(join(snaps, name), "PGDMP");
    const keys = await captureFiles(root, snaps);
    assert.ok(keys?.includes(key));
    await writeFilesManifest(snaps, name, keys!);
    assert.ok(readFileSync(filesManifestPath(snaps, name), "utf8").split("\n").includes(key));
    const stored = join(snapshotFilesStore(snaps), ...key.split("/"));

    await disk.deleteObject(key); // the owner deletes it
    assert.equal(await pruneSnapshotFiles(snaps, root), 0);
    assert.equal(readFileSync(stored, "utf8"), "hello, local disk", "the snapshot lost the file");

    rmSync(join(snaps, name)); // that snapshot is pruned
    await pruneSnapshotFiles(snaps, root);
    assert.ok(!existsSync(stored), "a file no snapshot needs was kept");
    assert.ok(!existsSync(filesManifestPath(snaps, name)), "an orphan manifest was kept");
  });
  await ok("an install with no files folder (R2) writes no file list", async () => {
    assert.equal(await captureFiles(join(data, "no-such-folder"), join(data, "snapshots")), null);
  });
} finally {
  rmSync(data, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed.`);
