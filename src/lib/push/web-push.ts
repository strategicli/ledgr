// The production PushSender: encrypts a message (encrypt.ts) and POSTs it to
// the push service with a VAPID Authorization header (vapid.ts). Plain fetch,
// no SDK — the surface is one POST per subscription.
import { encryptPush } from "./encrypt";
import type { PushMessage, PushResult, PushSender, PushSubscriptionRecord } from "./types";
import { audienceFor, getVapidConfig, signVapidJwt, type VapidConfig } from "./vapid";

// 4 weeks; the push service holds an undelivered message this long. Agenda
// and prep notices are time-relevant, but a generous TTL is harmless and
// avoids dropping a notice while a phone is briefly offline.
const TTL_SECONDS = 60 * 60 * 24 * 28;

export class WebPushSender implements PushSender {
  constructor(private config: VapidConfig) {}

  async send(
    sub: PushSubscriptionRecord,
    message: PushMessage
  ): Promise<PushResult> {
    const plaintext = Buffer.from(JSON.stringify(message));
    const { body } = encryptPush(sub.p256dh, sub.auth, plaintext);
    const { jwt, publicKey } = signVapidJwt(audienceFor(sub.endpoint), this.config);

    let res: Response;
    try {
      res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt}, k=${publicKey}`,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(TTL_SECONDS),
        },
        // Buffer is a Uint8Array; cast for the fetch BodyInit type.
        body: body as unknown as BodyInit,
      });
    } catch (err) {
      return {
        ok: false,
        gone: false,
        status: 0,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    // 404/410 = the subscription is dead (user cleared it / browser rotated
    // it). The caller prunes it so the table self-heals.
    const gone = res.status === 404 || res.status === 410;
    return {
      ok: false,
      gone,
      status: res.status,
      detail: gone ? "subscription gone" : `push service returned ${res.status}`,
    };
  }
}

// Returns the configured sender, or null when VAPID keys are unset (the
// "notifications not configured" path — runbook §1e). Callers treat null as a
// visible no-op, like the Graph/Todoist not-configured branches.
export function getWebPushSender(): WebPushSender | null {
  const config = getVapidConfig();
  return config ? new WebPushSender(config) : null;
}
