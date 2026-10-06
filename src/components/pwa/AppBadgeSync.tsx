// PWA app-icon badge sync (ADR-129). Sets the installed-app icon badge to the
// owner's unread notification count via the Badging API. Mounted once in the
// nav chrome, so every authenticated page keeps the badge fresh: it seeds from
// the server-rendered count, then re-reads the authoritative count on focus and
// when the notifications page broadcasts a change. Renders nothing.
//
// The Badging API is only meaningful on an installed PWA and is absent on many
// browsers (notably iOS Safari in-tab); every call is guarded + best-effort, so
// this is a silent no-op where unsupported — the in-app bell badge is the
// universal fallback.
"use client";

import { useEffect } from "react";

async function setBadge(count: number) {
  try {
    if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
      if (count > 0) await navigator.setAppBadge(count);
      else await navigator.clearAppBadge?.();
    }
  } catch {
    // unsupported / denied — fall back to the in-app badge silently.
  }
}

// While the page is visible, re-read once a minute so a notification that
// arrives while Ledgr is open shows on the bell without a reload. One indexed
// count query per minute per open tab.
const POLL_MS = 60_000;

async function readUnread(): Promise<number | null> {
  try {
    const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { unread?: number };
    return typeof data.unread === "number" ? data.unread : null;
  } catch {
    return null; // offline / transient: leave the badge as-is
  }
}

export default function AppBadgeSync({
  count,
  onCount,
}: {
  count: number;
  /** Receives every fresh count, so the in-app bell can show it too. */
  onCount?: (n: number) => void;
}) {
  useEffect(() => {
    const refresh = async () => {
      const n = await readUnread();
      if (n === null) return;
      await setBadge(n);
      onCount?.(n);
    };
    // Seed from the server-rendered count immediately, then confirm.
    void setBadge(count);
    void refresh();
    const onFocus = () => void refresh();
    const onChange = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // The service worker posts this when a push arrives (sw.js).
    const onWorker = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "push-received") void refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onWorker);
    // The notifications page dispatches this after a read/archive so the badge
    // updates without waiting for a focus/navigation.
    window.addEventListener("ledgr:notifications-changed", onChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onWorker);
      window.removeEventListener("ledgr:notifications-changed", onChange);
    };
  }, [count, onCount]);
  return null;
}
