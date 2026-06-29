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

async function refresh() {
  try {
    const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { unread?: number };
    if (typeof data.unread === "number") await setBadge(data.unread);
  } catch {
    /* offline / transient — leave the badge as-is */
  }
}

export default function AppBadgeSync({ count }: { count: number }) {
  useEffect(() => {
    // Seed from the server-rendered count immediately, then confirm.
    void setBadge(count);
    void refresh();
    const onFocus = () => void refresh();
    const onChange = () => void refresh();
    window.addEventListener("focus", onFocus);
    // The notifications page dispatches this after a read/archive so the badge
    // updates without waiting for a focus/navigation.
    window.addEventListener("ledgr:notifications-changed", onChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ledgr:notifications-changed", onChange);
    };
  }, [count]);
  return null;
}
