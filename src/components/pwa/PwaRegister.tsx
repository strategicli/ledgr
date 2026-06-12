"use client";

import { useEffect } from "react";

// Registers the service worker (slice 16). Production only: a SW in dev
// serves stale build assets across HMR and confuses everything it touches.
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("service worker registration failed", err);
    });
  }, []);
  return null;
}
