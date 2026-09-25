// Checks for the Tailscale module's supervisor side (ADR-275): which helper file
// this computer gets, the checksum gate in front of running it, the machine
// name, the status file both halves read, and the Network page's ordering.
// Pure: no network, no child processes, no database.
//
// Run: npx tsx scripts/verify-tailnet.mts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  checksumOk,
  loadTailnetRelease,
  parseTailnetRequest,
  parseTailnetStatus,
  sha256Hex,
  tailnetAsset,
  tailnetDownloadUrl,
  tailnetHostname,
} from "../supervisor/tailnet.mjs";
import { parseTailnetStatus as parseInApp, tailnetAddress } from "@/modules/tailscale/lib/status";
import { reachableAddresses, TAILSCALE_ABSENT } from "@/lib/network-addresses";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`ok ${n} ${name}`);
};

check("platform selection covers the six built targets and nothing else", () => {
  assert.equal(tailnetAsset("win32", "x64"), "ledgr-tailnet-windows-amd64.exe");
  assert.equal(tailnetAsset("win32", "arm64"), "ledgr-tailnet-windows-arm64.exe");
  assert.equal(tailnetAsset("darwin", "arm64"), "ledgr-tailnet-darwin-arm64");
  assert.equal(tailnetAsset("linux", "x64"), "ledgr-tailnet-linux-amd64");
  assert.equal(tailnetAsset("linux", "ia32"), null);
  assert.equal(tailnetAsset("freebsd", "x64"), null);
});

check("release.json pins a checksum for every platform the supervisor can pick", () => {
  const r = loadTailnetRelease(readFileSync("tailnet/release.json", "utf8"));
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  const targets: [string, string][] = [
    ["win32", "x64"], ["win32", "arm64"], ["darwin", "x64"],
    ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"],
  ];
  for (const [p, a] of targets) {
    const asset = tailnetAsset(p, a) as string;
    assert.match(r.sha256[asset] ?? "", /^[0-9a-f]{64}$/, asset);
  }
  assert.equal(Object.keys(r.sha256).length, 6);
  assert.equal(
    tailnetDownloadUrl(r, "ledgr-tailnet-linux-amd64"),
    `https://github.com/${r.repo}/releases/download/tailnet-v${r.version}/ledgr-tailnet-linux-amd64`
  );
});

check("the checksum gate accepts only an exact match", () => {
  const buf = Buffer.from("a helper binary");
  const good = sha256Hex(buf);
  assert.equal(checksumOk(buf, good), true);
  assert.equal(checksumOk(Buffer.from("a helper binarY"), good), false);
  assert.equal(checksumOk(buf, good.toUpperCase()), false); // no loose matching
  assert.equal(checksumOk(buf, ""), false);
  assert.equal(checksumOk(buf, undefined as unknown as string), false);
});

check("the tailnet name is ledgr-<machine>, in letters a tailnet allows", () => {
  assert.equal(tailnetHostname("BrandonECC"), "ledgr-brandonecc");
  assert.equal(tailnetHostname("Office PC_2"), "ledgr-office-pc-2");
  assert.equal(tailnetHostname(""), "ledgr");
  assert.equal(tailnetHostname("x", "Ledgr-BrandonECC-Test"), "ledgr-brandonecc-test");
  assert.equal(tailnetHostname("a".repeat(80)).length, 63);
});

check("status parsing: both halves agree, junk is null", () => {
  const running = JSON.stringify({
    state: "running",
    dnsName: "ledgr-pc.example.ts.net",
    url: "https://ledgr-pc.example.ts.net",
    at: "2026-09-25T00:00:00Z",
  });
  for (const parse of [parseTailnetStatus, parseInApp]) {
    assert.equal(parse(running)?.url, "https://ledgr-pc.example.ts.net");
    assert.equal(parse("{nope"), null);
    assert.equal(parse(JSON.stringify({ state: "dancing" })), null);
    assert.equal(parse(JSON.stringify({ state: "needs-login", authUrl: "https://login.tailscale.com/a/abc" }))?.state, "needs-login");
  }
  // The app opens only a Tailscale sign-in link and hands out only https.
  assert.equal(parseInApp(JSON.stringify({ state: "needs-login", authUrl: "https://evil.example/a" }))?.authUrl, null);
  assert.equal(parseInApp(JSON.stringify({ state: "running", url: "http://x" }))?.url, null);
  assert.equal(tailnetAddress(parseInApp(running)), "https://ledgr-pc.example.ts.net");
  assert.equal(tailnetAddress(parseInApp(JSON.stringify({ state: "error", url: "https://x" }))), null);
});

check("the signal file: logout only when it says so", () => {
  assert.deepEqual(parseTailnetRequest('{"logout":true}'), { logout: true });
  assert.deepEqual(parseTailnetRequest('{"logout":false}'), { logout: false });
  assert.deepEqual(parseTailnetRequest(""), { logout: false });
});

check("the Network page lists the private address after a public one, first otherwise", () => {
  const base = { tailscale: TAILSCALE_ABSENT, lanIps: ["192.168.1.5"], port: 3000 };
  const priv = "https://ledgr-pc.example.ts.net";
  const alone = reachableAddresses({ ...base, privateUrl: priv });
  assert.equal(alone[0].url, priv);
  assert.equal(alone[0].preferred, true);
  const withPublic = reachableAddresses({ ...base, privateUrl: priv, publicUrl: "https://ledgr.example.com" });
  assert.deepEqual(withPublic.map((a) => a.url).slice(0, 2), ["https://ledgr.example.com", priv]);
  assert.equal(withPublic[1].preferred, false);
  assert.equal(reachableAddresses(base).some((a) => a.url === priv), false);
});

console.log(`\nverify-tailnet: ${n} checks passed`);
