// Web Push types (slice 30, PRD §4.11). The PushSender interface fronts the
// actual delivery so the engine verifies against a stub with no VAPID keys and
// no network, exactly like CalendarSource / MailSource / TodoistClient /
// ExportTarget — and so a Phase 4 local build could swap a different transport.

// What the browser hands us at PushManager.subscribe() time, normalized to the
// three fields RFC 8291 message encryption needs. endpoint is the push
// service URL; p256dh and auth are base64url (the browser's encoding).
export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// A notification payload. Mirrors the subset of the Notification API the
// service worker's `push` handler reads (title + options); kept small on
// purpose — the SW renders it, the click routes to `url`.
export type PushMessage = {
  title: string;
  body: string;
  // Where notificationclick navigates (same-origin path). Defaults to "/".
  url?: string;
  // Coalescing tag so a re-sent agenda replaces the prior one rather than
  // stacking (Notification API `tag`).
  tag?: string;
};

// The result of one send. `gone` means the push service reported the
// subscription dead (404/410) and the caller should prune it.
export type PushResult =
  | { ok: true; status: number }
  | { ok: false; gone: boolean; status: number; detail: string };

export interface PushSender {
  // Encrypt `message` to `sub` and POST it to the push service.
  send(sub: PushSubscriptionRecord, message: PushMessage): Promise<PushResult>;
}
