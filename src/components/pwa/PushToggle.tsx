// Notifications toggle (slice 30, PRD §4.11). Enables/disables Web Push for
// this browser: requests permission, subscribes through the service worker's
// PushManager with the server's VAPID public key, and registers/removes the
// subscription server-side. Renders nothing when push is unsupported or
// unconfigured (VAPID keys unset) — it's an optional convenience, not a
// blocker. Push delivery needs the registered SW, which is production-only
// (PwaRegister), so in local dev this shows "unavailable".
"use client";

import { useEffect, useState } from "react";

// VAPID public key (base64url) → the byte buffer applicationServerKey expects.
// Backed by an explicit ArrayBuffer so the type satisfies BufferSource.
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "busy";

export default function PushToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      // Is push configured server-side?
      let key: string | null = null;
      try {
        const res = await fetch("/api/push");
        if (res.ok) {
          const data = (await res.json()) as { configured: boolean; publicKey: string | null };
          if (!data.configured) {
            if (!cancelled) setStatus("unconfigured");
            return;
          }
          key = data.publicKey;
        }
      } catch {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (!cancelled) setPublicKey(key);

      // Already subscribed in this browser?
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(existing ? "on" : "off");
      } catch {
        // No active SW (dev, or registration not done yet).
        if (!cancelled) setStatus("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setStatus("busy");
    setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("off");
        setNote(permission === "denied" ? "permission blocked in browser settings" : "permission not granted");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      });
      if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
      setStatus("on");
    } catch (err) {
      setStatus("off");
      setNote(err instanceof Error ? err.message : "could not enable");
    }
  }

  async function disable() {
    setStatus("busy");
    setNote("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setStatus("on");
      setNote(err instanceof Error ? err.message : "could not disable");
    }
  }

  if (status === "loading" || status === "unsupported" || status === "unconfigured") {
    // Stay quiet unless explicitly unsupported/unconfigured would only add
    // noise; render nothing so Today stays clean.
    return null;
  }

  const label =
    status === "busy" ? "…" : status === "on" ? "Notifications on" : "Enable notifications";
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => void (status === "on" ? disable() : enable())}
        disabled={status === "busy"}
        className="text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
      >
        {status === "on" ? "🔔 " : "🔕 "}
        {label}
      </button>
      {note && <span className="text-xs text-neutral-600">({note})</span>}
    </span>
  );
}
