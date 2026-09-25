"use client";

// Build → Network → "Keep a copy in the cloud" (ADR-277). One flow: paste the
// address of a fresh cloud copy, get a one-time code, type it on that copy's
// setup page, and this computer fills it and keeps it in sync. Also where the
// public address for share links is set. The logic is server-side
// (src/lib/sync/pairing-hub.ts); this island only asks and shows.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Pairing = {
  url: string;
  code: string | null;
  status: "waiting" | "filling" | "done" | "failed";
  progress: { table: string; tables: number; done: number; rows: number } | null;
  filesNote: string | null;
  movedJobs: string[];
  publicUrlSet: boolean;
  signIn: string | null;
  error: string | null;
} | null;

const button =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-60";
const input =
  "w-full rounded-card border border-line bg-surface-0 px-2 py-1 text-sm text-ink focus:border-line-strong focus:outline-none";

async function call(method: string, body?: unknown): Promise<{ pairing?: Pairing; error?: string }> {
  const res = await fetch("/api/sync/pair", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { pairing?: Pairing; error?: string };
  if (!res.ok) return { error: data.error ?? "That didn't work. Try again." };
  return data;
}

export default function CloudCopy({ initial, publicUrl }: { initial: Pairing; publicUrl: string | null }) {
  const router = useRouter();
  const [p, setP] = useState<Pairing>(initial);
  const [url, setUrl] = useState("");
  const [useForShares, setUseForShares] = useState(true);
  const [bigger, setBigger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moving = p?.status === "waiting" || p?.status === "filling";
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(async () => {
      const r = await call("GET").catch(() => null);
      if (!r || r.error) return;
      setP(r.pairing ?? null);
      if (r.pairing?.status === "done") router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [moving, router]);

  async function run(method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r: { pairing?: Pairing; error?: string } = await call(method, body).catch(() => ({
      error: "That didn't work. Try again.",
    }));
    setBusy(false);
    if (r.error) setError(r.error);
    else {
      setP(r.pairing ?? null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {!p && (
        <>
          <p className="text-sm text-ink-muted">
            A copy in the cloud keeps working when this computer is off, so your phone and browsers can fall back to
            it, and it can open your share links for anyone. This computer sends it your changes; it never has to
            reach this computer.
          </p>
          <label className="ui-meta block text-ink-subtle" htmlFor="cloud-url">
            Web address of a new, empty cloud copy of Ledgr
          </label>
          <input
            id="cloud-url"
            className={input}
            placeholder="https://your-ledgr.vercel.app"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {!publicUrl && (
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <input type="checkbox" className="ledgr-check mt-0.5" checked={useForShares} onChange={(e) => setUseForShares(e.target.checked)} />
              Make share links with the cloud copy&apos;s address, so people you send them to can open them
            </label>
          )}
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input type="checkbox" className="ledgr-check mt-0.5" checked={bigger} onChange={(e) => setBigger(e.target.checked)} />
            My cloud database has more room than a free Neon database (0.5 GB)
          </label>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>Everything you have is copied there, including your sign-in password, so the same password works.</li>
            <li>
              Scheduled jobs that no machine has been given yet (backups, calendar, email) will run on this computer.
              You can move any of them later under Scheduled Jobs.
            </li>
            <li>Only a brand-new, empty copy can be filled, and it must be made within the last two hours.</li>
          </ul>
          <button
            type="button"
            className={button}
            disabled={busy || !url.trim()}
            onClick={() => void run("POST", { action: "start", url, biggerPlan: bigger, usePublicUrl: useForShares })}
          >
            {busy ? "Checking the copy…" : "Get a pairing code"}
          </button>
        </>
      )}

      {p?.status === "waiting" && (
        <>
          <p className="text-sm text-ink">
            On any device, open{" "}
            <a href={`${p.url}/setup`} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
              {p.url}/setup
            </a>{" "}
            and type this code:
          </p>
          <p className="select-all font-mono text-2xl tracking-widest text-ink">{p.code}</p>
          <p className="ui-meta text-ink-subtle">
            This page moves on by itself once the code is typed there. The code works once.
          </p>
        </>
      )}

      {p?.status === "filling" && (
        <p className="text-sm text-ink">
          Copying everything to {p.url}.{" "}
          {p.progress
            ? `${p.progress.rows.toLocaleString()} rows sent so far (${p.progress.table}, table ${p.progress.done} of ${p.progress.tables}).`
            : "Starting…"}{" "}
          You can leave this page; it carries on.
        </p>
      )}

      {p?.status === "failed" && (
        <>
          <p className="text-sm text-amber-400">The copy stopped: {p.error}</p>
          <p className="ui-meta text-ink-subtle">
            Trying again starts over from the top. Nothing already copied is lost, and nothing on this computer changes.
          </p>
        </>
      )}

      {p?.status === "done" && (
        <div className="space-y-1.5 text-sm text-ink-muted">
          <p className="text-ink">Your cloud copy at {p.url} is filled and listed above. It stays in sync from now on.</p>
          <p>
            {p.signIn === "password"
              ? "Sign in there with the same password you use here."
              : p.signIn === "clerk"
                ? "Sign in there the way that copy is set up to (Clerk), with the same email address."
                : "Sign-in on that copy still needs setting up."}
          </p>
          {p.movedJobs.length > 0 && <p>Now running on this computer: {p.movedJobs.join(", ")}.</p>}
          {p.publicUrlSet && <p>New share links now use the cloud copy&apos;s address.</p>}
        </div>
      )}

      {p && p.status !== "done" && p.error && p.status !== "failed" && (
        <p className="text-sm text-amber-400">{p.error}</p>
      )}
      {p?.filesNote && <p className="ui-meta text-ink-subtle">{p.filesNote}</p>}
      {error && <p className="text-sm text-amber-400">{error}</p>}

      {p && (
        <div className="flex flex-wrap gap-3">
          {p.status === "failed" && (
            <button type="button" className={button} disabled={busy} onClick={() => void run("POST", { action: "retry" })}>
              Try again
            </button>
          )}
          {p.status !== "done" && (
            <button type="button" className={button} disabled={busy} onClick={() => void run("DELETE")}>
              Cancel
            </button>
          )}
          {p.status === "done" && (
            <button type="button" className={button} disabled={busy} onClick={() => void run("POST", { action: "dismiss" })}>
              Done
            </button>
          )}
        </div>
      )}

      <PublicAddress current={publicUrl} />
    </div>
  );
}

/** The one synced "public address" share links use (ADR-277). */
function PublicAddress({ current }: { current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  async function save(next: string | null) {
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicUrl: next }),
    }).catch(() => null);
    if (!res?.ok) return setMsg("That didn't save. Try again.");
    const saved = ((await res.json().catch(() => ({}))) as { settings?: { publicUrl?: string | null } }).settings?.publicUrl ?? null;
    if (next && !saved) return setMsg("That isn't a web address. It looks like https://your-ledgr.vercel.app");
    setValue(saved ?? "");
    setMsg(saved ? "Saved. New share links use this address." : "Cleared. Share links use the address you are on.");
    router.refresh();
  }

  return (
    <details className="rounded-card border border-line bg-surface-2 p-3">
      <summary className="ui-meta cursor-pointer text-ink-subtle">
        Public address for share links{current ? `: ${current}` : ""}
      </summary>
      <div className="mt-2 space-y-2 text-sm text-ink-muted">
        <p>
          Share links you make on any of your copies use this address, so they open for the people you send them to.
          Leave it empty to use whichever address you are on, which is how Ledgr has always worked.
        </p>
        <input className={input} placeholder="https://your-ledgr.vercel.app" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex gap-3">
          <button type="button" className={button} onClick={() => void save(value.trim() || null)}>
            Save
          </button>
          {current && (
            <button type="button" className={button} onClick={() => void save(null)}>
              Clear
            </button>
          )}
        </div>
        {msg && <p className="ui-meta text-ink-subtle">{msg}</p>}
      </div>
    </details>
  );
}
