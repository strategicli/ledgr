// "Task calendar feed (ICS)" control on User Settings (T4, ADR-079). Generates/
// rotates the published feed token and shows the subscribe URL. webcal:// makes
// most calendar apps offer to subscribe in one tap; the https:// form is there
// to copy. Sunday-proof reminders: any calendar app fires its own off this feed.
"use client";

import { useState } from "react";

export default function IcsFeed({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Built from the current origin so it's correct on prod/preview/localhost.
  const host = typeof window !== "undefined" ? window.location.host : "";
  const httpsUrl = token ? `https://${host}/api/ics/${token}.ics` : "";
  const webcalUrl = token ? `webcal://${host}/api/ics/${token}.ics` : "";

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/ics/token", { method: "POST" });
      if (res.ok) setToken((await res.json()).token);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/ics/token", { method: "DELETE" });
      if (res.ok) setToken(null);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!httpsUrl) return;
    void navigator.clipboard.writeText(httpsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="mt-10 border-t border-neutral-800 pt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Task calendar feed
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Subscribe any calendar app (Outlook, Apple, Google) to your scheduled and
        due tasks. Recurring tasks expand automatically, and your calendar fires
        its own reminders — no app needed.
      </p>

      {token ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={webcalUrl}
              className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-neutral-900 hover:brightness-110"
            >
              Subscribe in calendar
            </a>
            <button
              type="button"
              onClick={copy}
              className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500"
            >
              {copied ? "Copied ✓" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="rounded border border-neutral-800 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-600 disabled:opacity-50"
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={busy}
              className="rounded border border-neutral-800 px-3 py-1 text-xs text-red-400 hover:border-red-700 disabled:opacity-50"
            >
              Stop publishing
            </button>
          </div>
          <code className="block overflow-x-auto rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-500">
            {httpsUrl}
          </code>
          <p className="text-xs text-neutral-600">
            Anyone with this link can read your task list. Rotate to invalidate
            the old URL.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="mt-3 rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-neutral-900 hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Generating…" : "Publish a feed"}
        </button>
      )}
    </section>
  );
}
