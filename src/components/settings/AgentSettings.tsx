// "Claude in Ledgr" settings (ADR-271): the on/off switch for the in-app agent,
// its two model choices, the two seeded prompts (open or revert), a health line
// that says how to sign in when it's red, and the last 7 days of use. Rendered
// only where the agent can run (lib/agent/gate.ts), so a spoke or Vercel never
// shows it.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AGENT_MODELS, type AgentSettings as Agent } from "@/lib/settings";

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5 (strongest)",
  "claude-sonnet-5": "Sonnet 5 (balanced)",
  "claude-haiku-4-5-20251001": "Haiku 4.5 (fastest)",
};

type Day = { key: string; label: string; turns: number; tokens: number };
type Health = {
  authMode: "subscription" | "apikey";
  sdkVersion: string | null;
  lastOkAt: string | null;
  lastError: { at: string; message: string } | null;
  usage: { day: string; turns: number; tokens: number }[];
  days: Day[];
};

// The last 7 days, oldest first, with zero-use days filled in. Built when the
// data arrives (reading the clock during render isn't pure).
function lastWeek(usage: Health["usage"]): Day[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toLocaleDateString("en-CA");
    const u = usage.find((x) => x.day === key);
    return { key, label: d.toLocaleDateString([], { weekday: "short" }), turns: u?.turns ?? 0, tokens: u?.tokens ?? 0 };
  });
}

async function fetchHealth(): Promise<Health | null> {
  const res = await fetch("/api/agent/health").catch(() => null);
  if (!res?.ok) return null;
  const h = (await res.json()) as Omit<Health, "days">;
  return { ...h, days: lastWeek(h.usage) };
}

const btn =
  "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

function when(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function AgentSettings({ initial }: { initial: Agent }) {
  const router = useRouter();
  const [agent, setAgent] = useState(initial);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadHealth() {
    const h = await fetchHealth();
    if (h) setHealth(h);
  }
  useEffect(() => {
    void fetchHealth().then((h) => h && setHealth(h));
  }, []);

  async function save(patch: Partial<Agent>) {
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: patch }),
    }).catch(() => null);
    if (!res?.ok) return setMsg("Couldn't save. Try again.");
    const { settings } = (await res.json()) as { settings: { agent: Agent } };
    setAgent(settings.agent);
    // The root layout mounts the sidebar and toolbar button from this setting.
    if ("enabled" in patch) router.refresh();
  }

  async function check() {
    setBusy("check");
    setMsg(null);
    const res = await fetch("/api/agent/health", { method: "POST" }).catch(() => null);
    const r = res?.ok ? ((await res.json()) as { ok: boolean; error?: string }) : { ok: false, error: "The check didn't reach the server." };
    setMsg(r.ok ? "Signed in. Claude answered." : (r.error ?? "The check failed."));
    await loadHealth();
    setBusy(null);
  }

  async function revert(which: "base" | "inline") {
    setBusy(which);
    setMsg(null);
    const res = await fetch("/api/agent/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revert: which }),
    }).catch(() => null);
    setMsg(res?.ok ? "Reverted to the default prompt." : "Couldn't revert. Try again.");
    setBusy(null);
  }

  // Red only when the most recent thing that happened was a failure.
  const red = !!health?.lastError && (!health.lastOkAt || health.lastError.at > health.lastOkAt);
  const maxTurns = Math.max(1, ...(health?.usage ?? []).map((u) => u.turns));
  const days = health?.days ?? [];

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-neutral-200">Claude in Ledgr</h2>
      <p className="mt-0.5 text-sm text-neutral-500">
        A Claude sidebar (Ctrl/Cmd+J), inline editing of selected text (Ctrl/Cmd+Shift+E), slash prompts, and
        @-mentions, all inside Ledgr. It runs on this computer under its own Claude sign-in and uses Ledgr&rsquo;s tools
        only. Deleting or sharing always asks first.
      </p>

      <label className="mt-2 flex items-start gap-2 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={agent.enabled}
          onChange={(e) => void save({ enabled: e.target.checked })}
          className="ledgr-check mt-0.5"
        />
        <span>
          Turn on Claude in Ledgr
          <span className="block text-xs text-neutral-500">Adds the sidebar button and the editor&rsquo;s sparkle button.</span>
        </span>
      </label>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(
          [
            ["chatModel", "Sidebar model"],
            ["inlineModel", "Inline edit model"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs text-neutral-400">
            {label}
            <select
              value={agent[key]}
              onChange={(e) => void save({ [key]: e.target.value })}
              className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
            >
              {AGENT_MODELS.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {agent.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {agent.basePromptItemId && (
            <a href={`/items/${agent.basePromptItemId}`} className={btn}>
              Open the sidebar prompt
            </a>
          )}
          <button type="button" onClick={() => void revert("base")} disabled={busy !== null} className={btn}>
            {busy === "base" ? "Reverting…" : "Revert sidebar prompt"}
          </button>
          {agent.inlinePromptItemId && (
            <a href={`/items/${agent.inlinePromptItemId}`} className={btn}>
              Open the inline-edit prompt
            </a>
          )}
          <button type="button" onClick={() => void revert("inline")} disabled={busy !== null} className={btn}>
            {busy === "inline" ? "Reverting…" : "Revert inline-edit prompt"}
          </button>
        </div>
      )}

      <div className="mt-3 rounded border border-neutral-800 p-3 text-xs text-neutral-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${red ? "bg-red-500" : health?.lastOkAt ? "bg-emerald-500" : "bg-neutral-600"}`} />
          <span className="text-neutral-300">
            {red ? "Last request failed" : health?.lastOkAt ? `Working, last answer ${when(health.lastOkAt)}` : "Not checked since the last restart"}
          </span>
          <button type="button" onClick={() => void check()} disabled={busy !== null} className={btn}>
            {busy === "check" ? "Checking…" : "Check sign-in"}
          </button>
        </div>
        {red && health?.lastError && <p className="mt-2 text-red-300">{health.lastError.message}</p>}
        {msg && <p className="mt-2 text-neutral-300">{msg}</p>}
        {red && (
          <div className="mt-2 text-neutral-400">
            To sign in: on this computer, open Windows PowerShell and run
            <code className="mt-1 block break-all rounded bg-neutral-800 px-1.5 py-1 font-mono text-[11px] text-neutral-300">
              &amp; &quot;C:\dev\ledgr\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe&quot;
            </code>
            then type <code className="font-mono">/login</code>, choose your Claude account, and finish in the browser. Type{" "}
            <code className="font-mono">/exit</code> when done, then press Check sign-in.
          </div>
        )}
        <p className="mt-2 text-neutral-500">
          Billing: {health?.authMode === "apikey" ? "API key" : "your Claude plan"}
          {health?.sdkVersion ? ` · Agent SDK ${health.sdkVersion}` : ""}
        </p>
      </div>

      {agent.enabled && (
        <div className="mt-3">
          <div className="text-xs text-neutral-400">Last 7 days (Claude replies per day)</div>
          <div className="mt-1 flex h-16 items-end gap-1">
            {days.map((d) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1" title={`${d.turns} replies, ${d.tokens.toLocaleString()} new tokens (cache re-reads not counted)`}>
                <div className="w-full rounded-sm bg-neutral-600" style={{ height: `${(d.turns / maxTurns) * 44}px`, minHeight: d.turns ? 2 : 0 }} />
                <span className="text-[10px] text-neutral-500">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
