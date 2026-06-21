"use client";

import { useEffect } from "react";

// Registers the service worker (slice 16). Production only: a SW in dev serves
// stale build assets across HMR and confuses everything it touches.
//
// In dev we go further than declining to register: we actively UNREGISTER any
// SW left over from a prior local `next build`/`next start` on this origin and
// drop its shell caches. public/sw.js caches /_next/static cache-first (safe for
// prod's immutable hashed filenames, but it keeps serving stale dev chunks that
// no longer match the recompiled build — the infinite-loading-skeleton bug). A
// lingering registration survives hard-refreshes (the reload goes through the
// SW), so dev has to tear it down itself.
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()));
      if (typeof caches !== "undefined") {
        void caches
          .keys()
          .then((keys) =>
            keys
              .filter((k) => k.startsWith("ledgr-shell-"))
              .forEach((k) => void caches.delete(k))
          );
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("service worker registration failed", err);
    });
  }, []);
  return null;
}
