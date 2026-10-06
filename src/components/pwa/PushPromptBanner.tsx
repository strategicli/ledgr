// "Turn on notifications for this browser?" Shown on every page while the
// Notification center module is on and THIS browser has not signed up for
// push on this copy of Ledgr, so no browser is quietly left out. Browsers only
// allow the permission prompt from a click, hence a banner rather than an
// automatic ask. Hidden when the browser has blocked notifications (it can no
// longer ask) and for a week after "Not now", per browser.
"use client";

import { useState } from "react";
import { usePushSubscription } from "./PushToggle";

const SNOOZE_KEY = "ledgr:push-prompt-snoozed-until";
const SNOOZE_DAYS = 7;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export default function PushPromptBanner() {
  const { status, note, enable } = usePushSubscription();
  const [hidden, setHidden] = useState(false);

  // status only leaves "loading" in the browser, so these reads never run on
  // the server and cannot mismatch hydration.
  if (status !== "off" && status !== "busy") return null;
  if (hidden || snoozed() || Notification.permission === "denied") return null;

  function notNow() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      // storage blocked: hide for this page view only
    }
    setHidden(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Turn on notifications"
      className="fixed inset-x-0 bottom-20 z-[55] flex justify-center px-4 md:bottom-4"
    >
      <div className="flex max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line-strong bg-surface-2 px-4 py-3 shadow-lg">
        <p className="ui-row text-ink">
          Turn on notifications for this browser?
          <span className="ui-meta block text-ink-muted">
            Reminders and Claude Run alerts will reach it even when Ledgr is closed.
            {note && ` (${note})`}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => void enable()}
            disabled={status === "busy"}
            className="rounded-card bg-surface-3 px-3 py-1.5 text-ink hover:bg-surface-1 disabled:opacity-50"
          >
            {status === "busy" ? "…" : "Turn on"}
          </button>
          <button onClick={notNow} className="px-2 py-1.5 text-ink-muted hover:text-ink">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
