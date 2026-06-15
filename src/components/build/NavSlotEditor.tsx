// Add / edit a single nav slot (slice: nav customization, ADR-056). A slot is
// either a `destination` (one route) or a `tools` group (a button that opens a
// popover of child destinations, up to 8). Shown inline in the Build-surface nav
// editor; "Done" hands the validated NavSlotConfig back to the orchestrator,
// which owns the array and persists it.
"use client";

import { useState } from "react";
import NavGlyph from "@/components/nav/NavGlyph";
import NavIconPicker from "@/components/build/NavIconPicker";
import type { NavIconKey } from "@/lib/nav-icons";
import {
  findDestOption,
  type DestGroup,
  type DestOption,
} from "@/lib/nav-slot-options";
import {
  MAX_TOOLS_CHILDREN,
  type NavDestination,
  type NavSlotConfig,
} from "@/lib/settings";

const inputClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

const GROUP_ORDER: DestGroup[] = ["Built-in", "Views", "Types"];

// Build the first usable destination (Inbox, normally) for a brand-new slot.
function defaultDestination(options: DestOption[]): NavDestination {
  const o = options[0];
  return o
    ? { kind: o.kind, href: o.href, label: o.label, icon: o.icon }
    : { kind: "builtin", href: "/inbox", label: "Inbox", icon: "inbox" };
}

// A collapsible icon control: a chip showing the current icon that toggles the
// full searchable picker. Keeps the editor compact, especially per-child.
function IconControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: NavIconKey) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Choose icon"
        className="flex items-center gap-1.5 self-start rounded border border-neutral-800 px-2 py-1.5 text-xs text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
      >
        <NavGlyph icon={value} size={16} />
        <span className="text-neutral-500">Icon</span>
      </button>
      {open && (
        <NavIconPicker
          value={value}
          onChange={(k) => {
            onChange(k);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// The shared fields for a destination (used for a single-destination slot and
// for each child of a tools group). Picking from "Points to" prefills label +
// icon; the label and icon stay editable after.
function DestinationFields({
  value,
  options,
  onChange,
}: {
  value: NavDestination;
  options: DestOption[];
  onChange: (d: NavDestination) => void;
}) {
  const current = findDestOption(options, value.href);
  const badgeEligible = current?.badgeEligible ?? false;

  function selectDest(href: string) {
    const o = options.find((x) => x.href === href);
    if (!o) return;
    onChange({
      kind: o.kind,
      href: o.href,
      label: o.label,
      icon: o.icon,
      // Drop the badge if the new destination can't carry one.
      ...(o.badgeEligible && value.badge ? { badge: "inbox" as const } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-400">Points to</span>
        <select
          value={value.href}
          onChange={(e) => selectDest(e.target.value)}
          className={inputClass}
        >
          {/* An orphaned href (e.g. a deleted view) keeps a slot working: show
              it as a fallback option so the select isn't blank. */}
          {!current && (
            <option value={value.href}>{value.label} (missing)</option>
          )}
          {GROUP_ORDER.map((group) => {
            const inGroup = options.filter((o) => o.group === group);
            if (inGroup.length === 0) return null;
            return (
              <optgroup key={group} label={group}>
                {inGroup.map((o) => (
                  <option key={o.href} value={o.href}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Label</span>
          <input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder="Slot name"
            className={inputClass}
          />
        </label>
        <IconControl
          value={value.icon}
          onChange={(icon) => onChange({ ...value, icon })}
        />
      </div>

      {badgeEligible && (
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={value.badge === "inbox"}
            onChange={(e) =>
              onChange({
                ...value,
                ...(e.target.checked ? { badge: "inbox" as const } : { badge: undefined }),
              })
            }
            className="ledgr-check"
          />
          Show unread count
        </label>
      )}
    </div>
  );
}

export default function NavSlotEditor({
  initial,
  options,
  onSave,
  onCancel,
}: {
  initial?: NavSlotConfig;
  options: DestOption[];
  onSave: (slot: NavSlotConfig) => void;
  onCancel: () => void;
}) {
  const editing = !!initial;
  // When adding, a type toggle picks destination vs tools group; when editing,
  // the slot's type is fixed (its shape can't change underneath stored data).
  const [type, setType] = useState<"destination" | "tools">(
    initial?.type ?? "destination"
  );

  const [dest, setDest] = useState<NavDestination>(
    initial && initial.type === "destination"
      ? {
          kind: initial.kind,
          href: initial.href,
          label: initial.label,
          icon: initial.icon,
          badge: initial.badge,
        }
      : defaultDestination(options)
  );

  const [groupLabel, setGroupLabel] = useState(
    initial && initial.type === "tools" ? initial.label : ""
  );
  const [groupIcon, setGroupIcon] = useState(
    initial && initial.type === "tools" ? initial.icon : "tools"
  );
  const [children, setChildren] = useState<NavDestination[]>(
    initial && initial.type === "tools"
      ? initial.children
      : [defaultDestination(options)]
  );
  const [error, setError] = useState<string | null>(null);

  function updateChild(i: number, d: NavDestination) {
    setChildren((cs) => cs.map((c, idx) => (idx === i ? d : c)));
  }
  function removeChild(i: number) {
    setChildren((cs) => cs.filter((_, idx) => idx !== i));
  }
  function moveChild(i: number, dir: -1 | 1) {
    setChildren((cs) => {
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const copy = [...cs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  function done() {
    setError(null);
    if (type === "destination") {
      if (!dest.label.trim()) {
        setError("Give the slot a label.");
        return;
      }
      onSave({ type: "destination", ...dest, label: dest.label.trim() });
      return;
    }
    if (!groupLabel.trim()) {
      setError("Give the group a name.");
      return;
    }
    if (children.length === 0) {
      setError("A group needs at least one destination.");
      return;
    }
    onSave({
      type: "tools",
      label: groupLabel.trim(),
      icon: groupIcon,
      children: children.map((c) => ({ ...c, label: c.label.trim() || "Untitled" })),
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-neutral-700 bg-neutral-900/60 p-3">
      {!editing && (
        <div className="flex gap-1 self-start rounded-lg border border-neutral-800 p-0.5 text-sm">
          {(["destination", "tools"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-3 py-1 ${
                type === t
                  ? "bg-neutral-700 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t === "destination" ? "Destination" : "Tools group"}
            </button>
          ))}
        </div>
      )}

      {type === "destination" ? (
        <DestinationFields value={dest} options={options} onChange={setDest} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-neutral-400">Group name</span>
              <input
                value={groupLabel}
                onChange={(e) => setGroupLabel(e.target.value)}
                placeholder="e.g. Library"
                className={inputClass}
              />
            </label>
            <IconControl value={groupIcon} onChange={setGroupIcon} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-neutral-400">
              Destinations in this group
            </p>
            {children.map((child, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded border border-neutral-800/70 bg-neutral-900/40 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                    #{i + 1}
                  </span>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => moveChild(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveChild(i, 1)}
                      disabled={i === children.length - 1}
                      aria-label="Move down"
                      className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChild(i)}
                      disabled={children.length === 1}
                      aria-label="Remove destination"
                      className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400 disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <DestinationFields
                  value={child}
                  options={options}
                  onChange={(d) => updateChild(i, d)}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setChildren((cs) => [...cs, defaultDestination(options)])}
              disabled={children.length >= MAX_TOOLS_CHILDREN}
              className="self-start rounded border border-neutral-800 px-2.5 py-1 text-sm text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60 disabled:opacity-40"
            >
              + Add destination{children.length >= MAX_TOOLS_CHILDREN ? " (max 8)" : ""}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={done}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
