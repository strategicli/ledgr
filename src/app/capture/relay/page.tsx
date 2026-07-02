"use client";

// Bookmarklet relay (fixes the clipper on CSP-strict sites, e.g. YouTube).
// The bookmarklet can't fetch() the Ledgr API directly from a page whose CSP
// `connect-src` doesn't allow it — that throws a bare "Failed to fetch" with
// no way to work around it from inside that page. So the bookmarklet instead
// opens this page (Ledgr's own origin, so the host page's CSP no longer
// applies) and hands over the captured data via postMessage; this page makes
// the actual POST to /api/machine/capture.
import { useEffect, useState } from "react";

type Status = "waiting" | "saving" | "done" | "error";

export default function CaptureRelay() {
  const [status, setStatus] = useState<Status>("waiting");
  const [message, setMessage] = useState("Waiting for the page to clip…");

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.opener) return;
      const data = event.data as {
        token?: string;
        url?: string;
        title?: string;
        html?: string;
      } | null;
      if (!data || typeof data.token !== "string" || typeof data.url !== "string") {
        return;
      }
      setStatus("saving");
      setMessage("Saving to Ledgr…");
      fetch("/api/machine/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.token}`,
        },
        body: JSON.stringify({ url: data.url, title: data.title, html: data.html }),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || "failed");
          setStatus("done");
          setMessage(
            body.extracted ? "Saved to your Inbox (with content)." : "Saved to your Inbox (link only)."
          );
          setTimeout(() => window.close(), 1200);
        })
        .catch((err: Error) => {
          setStatus("error");
          setMessage(`Ledgr: ${err.message}`);
        });
    }

    window.addEventListener("message", onMessage);
    // Tell the opener we're ready to receive the captured page data.
    window.opener?.postMessage("ledgr-relay-ready", "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-center">
      <p
        className={`text-sm ${
          status === "error"
            ? "text-red-400"
            : status === "done"
              ? "text-emerald-400"
              : "text-neutral-400"
        }`}
      >
        {message}
        {status === "error" ? <><br />You can close this window.</> : null}
      </p>
    </div>
  );
}
