"use client";

// The task-pull lens as a sentence, not a rule builder (ADR-144): "Show open
// tasks about: [⬡ group | anyone here | everyone here | custom…]". The first
// three pills are presets over the People card — items about the group(s),
// union over the attendees, intersection over the attendees — compiled to the
// existing properties.taskPull shape (ADR-094 E4), so the any/all mental model
// becomes two plainly-named options. "custom…" reveals the full TaskPullControl
// for seed-level rules; the model underneath is unchanged.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PullPreset } from "@/lib/meetings/prep";
import { EVENT_PEOPLE_SEED, type TaskPull } from "@/lib/events/task-pull";
import TaskPullControl from "./TaskPullControl";

type SeedLabel = { id: string; title: string; type: string };

export default function TaskPullPresets({
  eventId,
  preset,
  groupNames,
  rule,
  seeds,
  peopleCount,
}: {
  eventId: string;
  preset: PullPreset;
  groupNames: string[];
  rule: TaskPull;
  seeds: SeedLabel[];
  peopleCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // "custom…" opens the full control; an already-custom rule starts open.
  const [customOpen, setCustomOpen] = useState(preset === "custom");

  async function apply(taskPull: TaskPull | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyPatch: { taskPull } }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // The group preset is the stored-nothing default (the rule tracks the card's
  // groups as they change); anyone/everyone store the explicit @people rule.
  const pickGroup = () => void apply(null);
  const pickAnyone = () =>
    void apply(
      groupNames.length === 0
        ? null // with no group, "anyone here" IS the default — store nothing
        : { groups: [{ match: "any", seeds: [EVENT_PEOPLE_SEED] }], statusScope: rule.statusScope }
    );
  const pickEveryone = () =>
    void apply({
      groups: [{ match: "all", seeds: [EVENT_PEOPLE_SEED] }],
      statusScope: rule.statusScope,
    });

  const pill = (label: string, active: boolean, onClick: () => void, title?: string) => (
    <button
      type="button"
      onClick={() => {
        setCustomOpen(false);
        onClick();
      }}
      disabled={busy || active}
      title={title}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
          : "border-line text-ink-subtle hover:border-line-strong hover:text-ink-muted"
      } disabled:cursor-default`}
    >
      {label}
    </button>
  );

  const active = customOpen ? "custom" : preset;

  return (
    <div className="mb-1.5 px-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
        <span>Show open tasks about:</span>
        {groupNames.length > 0 &&
          pill(
            `⬡ ${groupNames.join(" + ")}`,
            active === "group",
            pickGroup,
            "Items related to the meeting's group(s)"
          )}
        {pill(
          "anyone here",
          active === "anyone",
          pickAnyone,
          "Tasks related to any of the people here (union)"
        )}
        {pill(
          "everyone here",
          active === "everyone",
          pickEveryone,
          "Tasks related to all of the people here (intersection)"
        )}
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            active === "custom"
              ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
              : "border-dashed border-line text-ink-faint hover:text-ink-muted"
          }`}
        >
          custom…
        </button>
      </div>
      {(customOpen || preset === "custom") && (
        <div className="mt-1.5">
          <TaskPullControl eventId={eventId} rule={rule} seeds={seeds} peopleCount={peopleCount} />
        </div>
      )}
    </div>
  );
}
