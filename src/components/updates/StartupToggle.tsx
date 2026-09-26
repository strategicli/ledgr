"use client";

// "Start Ledgr with the computer" (ADR-211; Mac and Linux since install plan
// step 8, supervisor/login-item.mjs) — the ordinary checkbox any
// desktop app offers, for a local peer that until now only came back after a
// reboot if somebody had run a terminal command at install time.
//
// The app cannot register the task itself, so this writes a request the
// supervisor polls and then re-reads the recorded outcome. The failure is
// expected rather than exceptional (the always-on scope wants elevation), so
// this shows it plainly with the command to run instead — an owner who ticks a
// box and is not told it failed believes their hub survives a reboot.
import { useEffect, useState } from "react";
import type { StartupReport } from "@/lib/startup";

const button =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-60";

type Scope = "logon" | "always";

export default function StartupToggle({ initial }: { initial: StartupReport }) {
  const [report, setReport] = useState(initial);
  const [scope, setScope] = useState<Scope>(initial.state?.scope ?? "logon");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a request is outstanding, poll until the supervisor has acted (it
  // polls every 2s). Without this the owner is left looking at a stale answer.
  useEffect(() => {
    if (!report.pending) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/startup", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as StartupReport;
        if (alive) setReport(next);
      } catch {
        // keep polling; a failed read is not an answer
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [report.pending]);

  if (!report.available) return null;

  async function send(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/startup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, scope }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That change could not be requested.");
      setReport({ ...report, pending: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const on = report.state?.enabled === true && report.state.ok;
  // A Mac can start an app before anyone signs in only with an administrator's
  // help (a system-wide LaunchDaemon), which Ledgr does not do for you.
  const mac = report.platform === "darwin";
  const linux = report.platform === "linux";
  const help =
    scope === "always"
      ? linux
        ? "What a hub needs: your phone and Claude can reach it whether or not anyone is signed in. Ledgr asks Linux to start your own services when the computer starts (systemd \"linger\"). Most systems allow that without a password; if yours does not, this says so and shows the one command to run."
        : "What a hub needs: your phone and Claude can reach it whether or not anyone is signed in. Windows asks for an administrator prompt once. No password is stored: the task is registered the passwordless way and runs with nobody signed in."
      : mac
        ? "No password needed. Ledgr is added to your Login Items, so it comes up after you log in. For a Mac that must come back by itself after a power cut, also turn on automatic login in System Settings → Users & Groups."
        : linux
          ? "No password needed. A systemd user service starts Ledgr after you log in, which is right for a laptop or desktop you use."
          : "No administrator prompt. The device comes up after you log in, which is right for a laptop or desktop you use.";
  // A registered task Windows will only run while signed in must not read as
  // "before anyone signs in" one line above the box that says otherwise.
  const caveat = on && !!report.state?.caveat;

  return (
    <div>
      <p className="text-sm text-ink">
        {report.pending
          ? "Applying…"
          : on
            ? report.state?.scope === "always"
              ? caveat
                ? "On, with one catch: see below."
                : "On — starts at boot, before anyone signs in."
              : "On — starts when you sign in."
            : "Off — this device does not come back on its own after a reboot."}
      </p>

      <label className="ui-meta mt-3 block text-ink-subtle">
        When
        <select
          className="ml-2 rounded-card border border-line bg-surface-0 px-1.5 py-0.5 text-xs text-ink"
          value={scope}
          disabled={busy || report.pending}
          onChange={(e) => setScope(e.target.value as Scope)}
        >
          <option value="logon">When I sign in</option>
          {!mac && <option value="always">At boot, always on</option>}
        </select>
      </label>
      <p className="ui-meta mt-1 text-ink-subtle">{help}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || report.pending}
          onClick={() => void send(true)}
        >
          {on ? "Update this setting" : "Turn it on"}
        </button>
        {report.state?.enabled && (
          <button
            type="button"
            className={button}
            disabled={busy || report.pending}
            onClick={() => void send(false)}
          >
            Turn it off
          </button>
        )}
        {error && <span className="ui-meta text-rose-400">{error}</span>}
      </div>

      {report.state?.ok && report.state.caveat && !report.pending && (
        <div className="mt-3 rounded-card border border-amber-700/60 bg-amber-950/20 p-3">
          <p className="text-sm text-amber-300">Registered — with one catch.</p>
          <p className="ui-meta mt-1 text-ink-muted">{report.state.caveat}</p>
        </div>
      )}

      {report.state && !report.state.ok && !report.pending && (
        <div className="mt-3 rounded-card border border-amber-700/60 bg-amber-950/20 p-3">
          <p className="text-sm text-amber-300">That did not take effect.</p>
          <p className="ui-meta mt-1 text-ink-muted">{report.state.detail}</p>
          {report.state.command && (
            <>
              <p className="ui-meta mt-2 text-ink-subtle">
                {report.platform === "win32"
                  ? "Run this in an Administrator PowerShell instead:"
                  : "Run this in a terminal instead:"}
              </p>
              <code className="ui-meta mt-1 block overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-ink">
                {report.state.command}
              </code>
            </>
          )}
        </div>
      )}
    </div>
  );
}
