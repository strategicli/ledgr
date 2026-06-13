// Generates a VAPID keypair for Web Push (slice 30, runbook §1e). Run once:
//   node scripts/make-vapid-keys.mjs
// Prints the two env entries; set them in Vercel + .env.local, redeploy. The
// public key is also the applicationServerKey the browser subscribes with.
// Keys are an EC P-256 pair; the public key is the uncompressed point
// (base64url), the private key the raw scalar d (base64url) — the exact shapes
// src/lib/push/vapid.ts reads. Uses node:crypto only (no web-push dep).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

const point = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]);

console.log("VAPID_PUBLIC_KEY=" + point.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + priv.d);
console.log('VAPID_SUBJECT="mailto:brandoncollins@edgewoodcommunity.org"');
