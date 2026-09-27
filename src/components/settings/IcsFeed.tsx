// "Task calendar feed (ICS)" control on User Settings (T4, ADR-079). Generates/
// rotates the published feed token and shows the subscribe URL. webcal:// makes
// most calendar apps offer to subscribe in one tap; the https:// form is there
// to copy. Sunday-proof reminders: any calendar app fires its own off this feed.
"use client";

import { useState } from "react";

// `host` comes from the serving request (the page reads it for the API origin
// too), so the server and the browser render the same URL and hydration matches.
export default function IcsFeed({ initialToken, host }: { initialToken: string | null; host: string }) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
    <section id="calendar-feed" className="scroll-mt-[calc(var(--nav-pt,0px)+4rem)] rounded-card border border-line bg-surface-1 p-4">
      <h3 className="ui-row font-medium">Task calendar feed</h3>
      <p className="mt-1 text-sm text-ink-subtle">
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
              className="rounded border border-line-strong px-3 py-1 text-xs text-ink-muted hover:border-line-strong"
            >
              {copied ? "Copied ✓" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="rounded border border-line px-3 py-1 text-xs text-ink-muted hover:border-line-strong disabled:opacity-50"
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={busy}
              className="rounded border border-line px-3 py-1 text-xs text-red-400 hover:border-red-700 disabled:opacity-50"
            >
              Stop publishing
            </button>
          </div>
          <code className="block overflow-x-auto rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-subtle">
            {httpsUrl}
          </code>
          <p className="text-xs text-ink-faint">
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
