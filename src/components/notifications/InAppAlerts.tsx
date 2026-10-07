// In-app alerts (ADR-292). When a notification arrives while Ledgr is open,
// show it inside the page, loud in proportion to its urgency: "quiet" leaves it
// to the bell and the tab title, "toast" slides a card into the corner that
// fades after 8 seconds (hover holds it), "banner" pins it across the top until
// it is opened, snoozed, or dismissed. Chosen per kind in Settings, defaulting
// to quiet for the morning agenda, banner for event reminders, toast otherwise.
//
// Triggered by the unread count going up (AppBadgeSync re-reads it on focus,
// every minute while visible, and when a push lands). Only a VISIBLE tab shows
// an alert, and it claims the id in localStorage first, so three open tabs
// show it once; a notification that arrives while every tab is hidden is shown
// by the first tab you come back to. Anything already unread when the page
// loaded is never alerted. The tab title count and favicon dot (TabUnread) are
// what tell you from another tab.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { alertStyleFor, type AlertStyle } from "@/lib/settings";

type Note = { id: string; kind: string; title: string; body: string | null; url: string | null; createdAt: string };
type Shown = Note & { style: Exclude<AlertStyle, "quiet"> };

const CLAIM_KEY = "ledgr:alerted";
const TOAST_MS = 8000;
const SNOOZE_MS = 10 * 60_000;
const MAX_TOASTS = 3;

// First visible tab to claim an id shows it; the rest skip. Best effort: with
// storage blocked every tab claims, which only costs a duplicate.
function claim(id: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(CLAIM_KEY) ?? "[]") as string[];
    if (list.includes(id)) return false;
    localStorage.setItem(CLAIM_KEY, JSON.stringify([...list, id].slice(-200)));
  } catch {
    // storage blocked: show it here
  }
  return true;
}

// A two-note chime. Browsers refuse audio until the page has had a click or
// key press, so the very first alert after a fresh load may be silent.
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.14;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch {
    // no audio: the alert still shows
  }
}

async function unreadList(): Promise<Note[] | null> {
  try {
    const res = await fetch("/api/notifications?filter=unread", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { notifications: Note[] }).notifications;
  } catch {
    return null;
  }
}

async function markRead(id: string) {
  await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [id], state: "read" }),
  }).catch(() => {});
  window.dispatchEvent(new CustomEvent("ledgr:notifications-changed"));
}

export default function InAppAlerts({
  unread,
  styles,
  sound,
}: {
  unread: number;
  styles: Record<string, AlertStyle>;
  sound: boolean;
}) {
  const router = useRouter();
  const [shown, setShown] = useState<Shown[]>([]);
  // Ids already handled here. Anything created before this page loaded is old
  // news, judged by time rather than by a first fetch, which on a slow load can
  // land after a new notification and swallow it.
  const seen = useRef(new Set<string>());
  const [loadedAt] = useState(() => Date.now());
  const opts = useRef({ styles, sound });
  useEffect(() => {
    opts.current = { styles, sound };
  }, [styles, sound]);

  const check = useCallback(async () => {
    const list = await unreadList();
    if (!list || document.visibilityState !== "visible") return;
    // ponytail: compares the server's createdAt to this device's clock; a clock
    // running minutes fast would treat a just-arrived notification as old.
    const fresh = list
      .filter((n) => !seen.current.has(n.id) && Date.parse(n.createdAt) >= loadedAt - 5000)
      .reverse(); // oldest first
    let loud = false;
    const add: Shown[] = [];
    for (const n of fresh) {
      seen.current.add(n.id);
      const style = alertStyleFor(opts.current.styles, n.kind);
      if (style === "quiet" || !claim(n.id)) continue;
      add.push({ ...n, style });
      loud = true;
    }
    if (!add.length) return;
    setShown((s) => {
      const banners = [...s.filter((x) => x.style === "banner"), ...add.filter((x) => x.style === "banner")];
      const toasts = [...s.filter((x) => x.style === "toast"), ...add.filter((x) => x.style === "toast")];
      return [...banners, ...toasts.slice(-MAX_TOASTS)];
    });
    if (loud && opts.current.sound) chime();
  }, [loadedAt]);

  // Check on mount, then look again whenever the count rises or a hidden tab
  // comes back into view.
  const last = useRef(unread);
  useEffect(() => {
    if (unread > last.current) void check();
    last.current = unread;
  }, [unread, check]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  const drop = (id: string) => setShown((s) => s.filter((x) => x.id !== id));
  const open = (n: Shown) => {
    drop(n.id);
    void markRead(n.id);
    if (n.url) router.push(n.url);
  };
  const snooze = (n: Shown) => {
    drop(n.id);
    window.setTimeout(() => setShown((s) => (s.some((x) => x.id === n.id) ? s : [...s, n])), SNOOZE_MS);
  };

  const banners = shown.filter((n) => n.style === "banner");
  const toasts = shown.filter((n) => n.style === "toast");

  return (
    <>
      {banners.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-[58] flex flex-col items-center gap-2 px-4">
          {banners.map((n) => (
            <div
              key={n.id}
              role="alert"
              className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-[var(--accent)] bg-surface-2 px-4 py-2.5 shadow-lg"
            >
              <p className="ui-row min-w-0 flex-1 text-ink">
                <span className="font-medium">{n.title}</span>
                {n.body && <span className="text-ink-muted"> · {n.body}</span>}
              </p>
              <div className="flex gap-2">
                <button onClick={() => open(n)} className="rounded-card bg-surface-3 px-3 py-1 text-sm text-ink hover:bg-surface-1">
                  Open
                </button>
                <button onClick={() => snooze(n)} className="px-2 py-1 text-sm text-ink-muted hover:text-ink">
                  Snooze 10 min
                </button>
                <button
                  onClick={() => {
                    drop(n.id);
                    void markRead(n.id);
                  }}
                  aria-label="Dismiss and mark read"
                  title="Dismiss and mark read"
                  className="px-2 py-1 text-sm text-ink-muted hover:text-ink"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-20 right-4 z-[58] flex flex-col items-end gap-2 md:bottom-4">
          {toasts.map((n) => (
            <Toast key={n.id} n={n} onOpen={() => open(n)} onRead={() => { drop(n.id); void markRead(n.id); }} onClose={() => drop(n.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function Toast({ n, onOpen, onRead, onClose }: { n: Shown; onOpen: () => void; onRead: () => void; onClose: () => void }) {
  const [held, setHeld] = useState(false);
  // The parent re-renders with a fresh onClose; a ref keeps that from
  // restarting the 8-second clock.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (held) return;
    const t = window.setTimeout(() => close.current(), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [held]);
  return (
    <div
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line-strong bg-surface-2 px-4 py-3 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <p className="ui-row min-w-0 flex-1 font-medium text-ink">{n.title}</p>
        <button onClick={onClose} aria-label="Close" className="text-ink-subtle hover:text-ink">
          ✕
        </button>
      </div>
      {n.body && <p className="ui-meta mt-0.5 text-ink-muted">{n.body}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={onOpen} className="rounded-card bg-surface-3 px-3 py-1 text-sm text-ink hover:bg-surface-1">
          Open
        </button>
        <button onClick={onRead} className="px-2 py-1 text-sm text-ink-muted hover:text-ink">
          Mark read
        </button>
      </div>
    </div>
  );
}
