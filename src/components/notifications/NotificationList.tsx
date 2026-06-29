// Notification center list (ADR-129): the client leaf for /notifications. Rows
// with per-row mark read/unread + archive, multi-select (the shared ADR-118
// selection layer) with a bulk bar, and "Mark all read". After any change it
// refreshes the server render, broadcasts so the PWA app-icon badge re-syncs,
// and pushes the authoritative unread count straight to the service worker.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import SelectionProvider, {
  useSelection,
} from "@/components/selection/SelectionProvider";
import type { ListFilter, NotificationState } from "@/lib/notifications";
import { NOTIFICATION_KINDS } from "@/lib/settings";

export type ClientNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  state: NotificationState;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  NOTIFICATION_KINDS.map((k) => [k.kind, k.label])
);

const rel = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  const mins = Math.round(diffSec / 60);
  if (Math.abs(mins) < 60) return rel.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rel.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rel.format(days, "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// One PATCH to the notifications API, then sync the world: refresh the server
// render, broadcast for AppBadgeSync, and post the authoritative unread count to
// the service worker so the app-icon badge updates without a round-trip.
async function patchNotifications(
  body: Record<string, unknown>
): Promise<{ changed: number; unread: number } | null> {
  try {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      changed: number;
      counts: { unread: number };
    };
    const unread = data.counts?.unread ?? 0;
    window.dispatchEvent(new CustomEvent("ledgr:notifications-changed"));
    try {
      const reg = await navigator.serviceWorker?.ready;
      reg?.active?.postMessage({ type: "set-badge", count: unread });
    } catch {
      /* no SW (dev / unsupported) — AppBadgeSync still handles the in-tab path */
    }
    return { changed: data.changed, unread };
  } catch {
    return null;
  }
}

// The floating bulk bar — the ADR-118 selection layer, with the notification
// verbs (this surface acts on notifications, not items, so it can't reuse the
// items BulkActionBar; it reuses the same SelectionProvider primitives).
function NotificationBulkBar({ onAfter }: { onAfter: () => void }) {
  const { count, selected, clear } = useSelection();
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;

  const act = async (state: NotificationState) => {
    setBusy(true);
    await patchNotifications({ ids: [...selected], state });
    setBusy(false);
    clear();
    onAfter();
  };

  const btn =
    "rounded px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50";
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-900/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur">
      <span className="px-2 text-sm text-neutral-400">{count} selected</span>
      <button disabled={busy} onClick={() => void act("read")} className={btn}>
        Mark read
      </button>
      <button disabled={busy} onClick={() => void act("unread")} className={btn}>
        Mark unread
      </button>
      <button disabled={busy} onClick={() => void act("archived")} className={btn}>
        Archive
      </button>
      <button onClick={clear} className={`${btn} text-neutral-500`}>
        Cancel
      </button>
    </div>
  );
}

function Row({
  n,
  filter,
  onAfter,
}: {
  n: ClientNotification;
  filter: ListFilter;
  onAfter: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const unread = n.state === "unread";

  const setState = async (state: NotificationState) => {
    setBusy(true);
    await patchNotifications({ ids: [n.id], state });
    setBusy(false);
    onAfter();
  };

  // Clicking through marks read (an unread item you opened is read), then lets
  // the link navigate.
  const onOpen = () => {
    if (unread) void patchNotifications({ ids: [n.id], state: "read" });
  };

  const titleCls = unread ? "text-neutral-100 font-medium" : "text-neutral-300";
  const TitleInner = (
    <>
      {unread && (
        <span
          aria-label="Unread"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: "var(--accent-gradient, var(--accent))" }}
        />
      )}
      {!unread && <span className="mt-1.5 h-2 w-2 shrink-0" />}
      <span className="min-w-0">
        <span className={`block truncate text-sm ${titleCls}`}>{n.title}</span>
        {n.body && (
          <span className="block truncate text-xs text-neutral-500">{n.body}</span>
        )}
        <span className="mt-0.5 block text-[11px] text-neutral-600">
          {KIND_LABEL[n.kind] ?? n.kind} · {relativeTime(n.createdAt)}
        </span>
      </span>
    </>
  );

  const action =
    "rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-50";

  return (
    <li className="group flex items-start gap-2 rounded px-2 py-2 hover:bg-neutral-800/60">
      <div className="pt-1.5">
        <SelectCheckbox id={n.id} />
      </div>
      {n.url ? (
        <Link href={n.url} onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2">
          {TitleInner}
        </Link>
      ) : (
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          {TitleInner}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          disabled={busy}
          onClick={() => void setState(unread ? "read" : "unread")}
          className={action}
        >
          {unread ? "Mark read" : "Mark unread"}
        </button>
        {filter !== "archived" ? (
          <button disabled={busy} onClick={() => void setState("archived")} className={action}>
            Archive
          </button>
        ) : (
          <button disabled={busy} onClick={() => void setState("read")} className={action}>
            Unarchive
          </button>
        )}
      </div>
    </li>
  );
}

export default function NotificationList({
  notifications,
  filter,
  unread,
}: {
  notifications: ClientNotification[];
  filter: ListFilter;
  unread: number;
}) {
  const router = useRouter();
  const onAfter = () => router.refresh();

  if (notifications.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-neutral-600">
        {filter === "archived"
          ? "No archived notifications."
          : filter === "unread"
            ? "No unread notifications."
            : "No notifications yet."}
      </p>
    );
  }

  return (
    <SelectionProvider ids={notifications.map((n) => n.id)}>
      <div className="mt-2 flex items-center justify-between">
        {unread > 0 && filter !== "archived" ? (
          <button
            onClick={async () => {
              await patchNotifications({ markAllRead: true });
              onAfter();
            }}
            className="rounded px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Mark all read
          </button>
        ) : (
          <span />
        )}
        <SelectModeToggle />
      </div>

      <ul className="mt-2">
        {notifications.map((n) => (
          <Row key={n.id} n={n} filter={filter} onAfter={onAfter} />
        ))}
      </ul>

      <NotificationBulkBar onAfter={onAfter} />
    </SelectionProvider>
  );
}
