"use client";

// The control that moves an exclusive scheduled job to this machine, or off it.
//
// Not a per-machine on/off toggle: two machines could both be "on", which is the
// misconfiguration the whole feature exists to make impossible. One slot, three
// gestures, and only "run it here" needs to be pressed on a particular machine.
//
// Claiming confirms with its consequence, because the honest trade differs per
// job and the owner is the one who should weigh it. Handing a job BACK never
// confirms: putting a safety catch on should not need a second click (the same
// asymmetry SyncModeToggle already uses).
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import type { MovableJob } from "@/lib/job-owners";

type Action = "claim" | "nobody" | "default";

export default function JobOwnerControl({
  job,
  jobLabel,
  consequence,
  isOwner,
  claimed,
  blocked,
}: {
  job: MovableJob;
  jobLabel: string;
  /** The reliability trade of running it on this machine, if there is one. */
  consequence: string | null;
  /** True when this machine already holds the job. */
  isOwner: boolean;
  /** True when SOME machine holds it (so "hand it back" is meaningful). */
  claimed: boolean;
  /** Set when the job cannot be moved yet; the reason is shown instead. */
  blocked?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/owner", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job, action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "That could not be changed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const button =
    "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-40";

  if (blocked) {
    return <p className="ui-meta mt-1.5 text-ink-faint">{blocked}</p>;
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {!isOwner && (
        <ConfirmButton
          title={`Run ${jobLabel.toLowerCase()} on this machine?`}
          description="Only one machine may do this, so taking it here stops it running anywhere else. That takes effect everywhere within seconds."
          confirmLabel="Run it here"
          panelClassName="w-80"
          trigger={<span>Run it here</span>}
          triggerClassName={button}
          disabled={busy}
          onConfirm={() => send("claim")}
        >
          <ul className="ui-meta list-disc space-y-1 pl-4 text-ink-muted">
            <li>It only runs while this machine is on.</li>
            {consequence && <li>{consequence}</li>}
            <li>You can hand it back at any time, from any of your devices.</li>
          </ul>
        </ConfirmButton>
      )}
      {isOwner && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void send("default")}
        >
          Stop running it here
        </button>
      )}
      {claimed && !isOwner && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void send("default")}
        >
          Hand it back
        </button>
      )}
      {claimed && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void send("nobody")}
        >
          Pause it everywhere
        </button>
      )}
      {error && <span className="ui-meta text-rose-400">{error}</span>}
    </div>
  );
}
