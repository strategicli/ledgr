"use client";

// "Runs on: [ ... ]" — one dropdown per shared job.
//
// A dropdown, not a per-machine on/off toggle: two machines could both be "on",
// which is the misconfiguration this whole feature exists to make impossible.
// One slot, one control, one answer.
//
// This is the shape the exploration doc wanted and the first pass could not
// build. It works now because the roster (ADR-220) gives every copy the same
// list of copies, keyed by the same ids the scheduler compares against — so
// naming a machine you are not sitting at is finally expressible.
//
// Moving a job to a machine confirms with its consequence, because the honest
// trade differs per job and the owner is the one who should weigh it. Handing a
// job back never confirms: putting a safety catch on should not need a second
// click (the same asymmetry SyncModeToggle uses).
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import type { MovableJob } from "@/lib/job-owners";
import type { Install } from "@/lib/installs-plan";

const NOBODY = "__nobody__";
const DEFAULT = "__default__";

export default function JobOwnerControl({
  job,
  jobLabel,
  consequence,
  installs,
  currentDeviceId,
  isUnset,
  blocked,
}: {
  job: MovableJob;
  jobLabel: string;
  /** The reliability trade of moving it, if there is one. */
  consequence: string | null;
  /** Every copy the owner runs, from the roster. */
  installs: Install[];
  /** The copy holding the job now, or null when nobody does. */
  currentDeviceId: string | null;
  /** True when the slot is absent: "wherever it is switched on". */
  isUnset: boolean;
  /** Set when the job cannot be moved yet; the reason is shown instead. */
  blocked?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Install | null>(null);

  const value = isUnset ? DEFAULT : (currentDeviceId ?? NOBODY);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/owner", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job, ...body }),
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
      setPending(null);
    }
  }

  function onPick(next: string) {
    setError(null);
    if (next === value) return;
    if (next === DEFAULT) return void send({ action: "default" });
    if (next === NOBODY) return void send({ action: "nobody" });
    // Moving it TO a machine is the consequential direction, so it confirms.
    const target = installs.find((i) => i.id === next);
    if (target) setPending(target);
  }

  if (blocked) {
    return <p className="ui-meta mt-1.5 text-ink-faint">{blocked}</p>;
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="ui-meta text-ink-subtle" htmlFor={`owner-${job}`}>
          Runs on
        </label>
        <select
          id={`owner-${job}`}
          className="ui-meta rounded-card border border-line bg-surface-0 px-1.5 py-1 text-ink disabled:opacity-40"
          value={value}
          disabled={busy}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value={DEFAULT}>Wherever it is switched on</option>
          {installs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.isSelf ? `${i.label} (this one)` : i.label}
            </option>
          ))}
          <option value={NOBODY}>Nowhere, pause it</option>
        </select>
        {error && <span className="ui-meta text-rose-400">{error}</span>}
      </div>

      {/* The confirm for "move it there", shown once a machine is picked. */}
      {pending && (
        <div className="mt-2">
          <ConfirmButton
            title={`Run ${jobLabel.toLowerCase()} on ${pending.label}?`}
            description="Only one machine may do this, so moving it here stops it running anywhere else. That takes effect everywhere within seconds."
            confirmLabel={`Move it to ${pending.label}`}
            panelClassName="w-80"
            trigger={<span>Confirm the move</span>}
            triggerClassName="rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3"
            onConfirm={() => send({ action: "assign", deviceId: pending.id })}
          >
            <ul className="ui-meta list-disc space-y-1 pl-4 text-ink-muted">
              <li>It only runs while {pending.label} is switched on.</li>
              {consequence && <li>{consequence}</li>}
              <li>You can move it again, or pause it, from any of your devices.</li>
            </ul>
          </ConfirmButton>
          <button
            type="button"
            className="ui-meta ml-2 text-ink-subtle underline decoration-dotted underline-offset-2"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
