// Settings > Notifications > Devices: every phone and browser signed up for
// push on THIS copy of Ledgr, with Send test and Remove, plus Turn on for the
// browser you are using when it is not on the list. Sign-ups are per copy, so
// this is the list a reminder or Claude Run notification sent from here goes to.
"use client";

import { useCallback, useEffect, useState } from "react";
import { deviceLabel, usePushSubscription } from "@/components/pwa/PushToggle";

type Device = { id: string; label: string | null; service: string; endpoint: string; createdAt: string };
type TestResult = "sending" | "sent" | "gone" | "failed" | "unconfigured";

const BTN =
  "rounded border border-line-strong px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 disabled:opacity-50";

const RESULT_TEXT: Record<TestResult, string> = {
  sending: "Sending…",
  sent: "Sent. It should appear on that device within a few seconds.",
  gone: "That sign-up no longer works, so it was removed. Turn notifications on again on that device.",
  failed: "The push service refused it.",
  unconfigured: "Push is not set up on this copy.",
};

// This browser's own push sign-up. getRegistration, not `ready`: `ready` never
// settles where no service worker is registered (dev, some browsers), which
// would leave the list loading forever.
async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export default function PushDevices() {
  const push = usePushSubscription();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { r: TestResult; detail?: string }>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/push/devices", { cache: "no-store" });
    if (!res.ok) return;
    const { devices: list } = (await res.json()) as { devices: Device[] };
    const current = await currentSubscription();
    const ep = current?.endpoint ?? null;
    setMine(ep);
    setDevices(list);
    // A sign-up from before devices had names gets this browser's name now.
    const me = list.find((d) => d.endpoint === ep);
    if (me && !me.label && current) {
      const sub = current.toJSON();
      if (sub.endpoint && sub.keys) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: deviceLabel() }),
        });
        setDevices(list.map((d) => (d.id === me.id ? { ...d, label: deviceLabel() } : d)));
      }
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; the list lives on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, push.status]);

  async function test(id: string) {
    setResults((r) => ({ ...r, [id]: { r: "sending" } }));
    const res = await fetch("/api/push/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json().catch(() => ({}))) as { result?: TestResult; detail?: string };
    setResults((r) => ({ ...r, [id]: { r: data.result ?? "failed", detail: data.detail } }));
    if (data.result === "gone") void load();
  }

  async function remove(d: Device) {
    // Removing the browser you are on also unsubscribes it here, so it can sign up again cleanly.
    if (d.endpoint === mine) await push.disable();
    await fetch("/api/push/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: d.id }),
    });
    void load();
  }

  const thisListed = !!mine && !!devices?.some((d) => d.endpoint === mine);

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div>
        <p className="ui-row font-medium">Devices</p>
        <p className="mt-0.5 max-w-prose text-xs text-ink-subtle">
          Every phone and browser that gets notifications from this copy of Ledgr. Each one signs up
          on its own, from the address it opens Ledgr at. Use Send test to check one, and remove any
          you no longer use.
        </p>
      </div>
      {(push.status === "off" || push.status === "busy") && !thisListed && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          This browser is not signed up.
          <button onClick={() => void push.enable()} disabled={push.status === "busy"} className={BTN}>
            {push.status === "busy" ? "…" : "Turn on for this browser"}
          </button>
          {push.note && <span className="text-xs text-ink-subtle">({push.note})</span>}
        </div>
      )}
      {devices === null ? (
        <p className="text-xs text-ink-subtle">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-ink-muted">No devices yet, so notifications from this copy reach nobody.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {devices.map((d) => {
            const res = results[d.id];
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="ui-row text-ink">
                    {d.label ?? "Unnamed device"}
                    {d.endpoint === mine && <span className="ml-2 text-xs text-ink-subtle">(this browser)</span>}
                  </p>
                  <p className="ui-meta text-ink-subtle">
                    Signed up {new Date(d.createdAt).toLocaleDateString()} · via {d.service}
                  </p>
                  {res && (
                    <p className={`ui-meta ${res.r === "sent" || res.r === "sending" ? "text-ink-muted" : "text-red-400"}`}>
                      {RESULT_TEXT[res.r]}
                      {res.detail ? ` (${res.detail})` : ""}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void test(d.id)} disabled={res?.r === "sending"} className={BTN}>
                    Send test
                  </button>
                  <button onClick={() => void remove(d)} className={BTN}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
