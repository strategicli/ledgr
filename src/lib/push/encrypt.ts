// Web Push message encryption (RFC 8291 over the aes128gcm content encoding of
// RFC 8188), hand-rolled over node:crypto — no web-push dependency (rule 5).
// Every push payload MUST be encrypted to the subscription's keys; the push
// service only relays opaque ciphertext. The pieces are all in node:crypto:
// ECDH on P-256, HKDF-SHA256, and AES-128-GCM.
//
// This is fiddly crypto, so verify-push.mts proves it by round-trip: encrypt
// to a freshly generated subscription, then decrypt from the subscription's
// side and assert the plaintext matches.
import { createECDH, hkdfSync, createCipheriv, randomBytes } from "node:crypto";
import { b64urlDecode } from "./vapid";

const KEY_INFO = Buffer.from("Content-Encoding: aes128gcm\0");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0");
const RECORD_SIZE = 4096;

function hkdf(
  salt: Buffer,
  ikm: Buffer,
  info: Buffer,
  length: number
): Buffer {
  // node hkdfSync does Extract+Expand and returns an ArrayBuffer.
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

export type EncryptedPush = {
  body: Buffer; // the full aes128gcm-encoded message (header || ciphertext)
};

// Encrypts `plaintext` (the JSON payload bytes) to a subscription's p256dh +
// auth, per RFC 8291 §3.4. `asKeys` lets verification inject a deterministic
// ephemeral keypair; production passes nothing (random ephemeral per message).
export function encryptPush(
  p256dhB64: string,
  authB64: string,
  plaintext: Buffer,
  asKeys?: { privateKey: Buffer; publicKey: Buffer }
): EncryptedPush {
  const uaPublic = b64urlDecode(p256dhB64); // 65-byte uncompressed point
  const authSecret = b64urlDecode(authB64); // 16 bytes

  // Application-server ephemeral keypair, one per message.
  const ecdh = createECDH("prime256v1");
  if (asKeys) ecdh.setPrivateKey(asKeys.privateKey);
  else ecdh.generateKeys();
  const asPublic = asKeys ? asKeys.publicKey : ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic); // 32 bytes

  // RFC 8291: derive the input keying material, salted by the auth secret,
  // bound to both public keys so each subscription gets distinct keys.
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188 content-encryption: a random per-message salt drives the CEK and
  // nonce, and travels in the message header.
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, KEY_INFO, 16);
  const nonce = hkdf(salt, ikm, NONCE_INFO, 12);

  // Single record: plaintext || 0x02 (the "last record" delimiter). No extra
  // padding — one record comfortably holds an agenda/prep notification.
  const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(padded),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 header: salt(16) || rs(uint32 BE) || idlen(1) || keyid(idlen).
  // For Web Push the keyid is the application-server public key (65 bytes).
  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return { body: Buffer.concat([header, ciphertext]) };
}
