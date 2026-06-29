// Add / edit a single nav slot (slice: nav customization, ADR-056). A slot is
// either a `destination` (one route) or a `tools` group (a button that opens a
// popover of child destinations, up to 8). Shown inline in the Build-surface nav
// editor; "Done" hands the validated NavSlotConfig back to the orchestrator,
// which owns the array and persists it.
"use client";

import { useEffect, useRef, useState } from "react";
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

const GROUP_ORDER: DestGroup[] = ["Built-in", "Views", "Types", "Build tools"];

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

// The destination chooser (ADR-063): a combobox that replaces a single long
// `<select>`. The route pool is one flat set across the whole system (built-in
// pages, your views, item types, Build tools), which got long — so instead of a
// huge list you browse by category chip and/or type to filter across everything.
// A new user who doesn't know what to search for can still browse; a power user
// can type. Picking prefills the slot's href/kind/label/icon.
function DestinationPicker({
  options,
  valueHref,
  currentLabel,
  currentIcon,
  onSelect,
}: {
  options: DestOption[];
  valueHref: string;
  currentLabel: string;
  currentIcon: string;
  onSelect: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  // Where to open + how tall the list can be, computed from the trigger's
  // viewport position when opening (this editor often sits low on the page, so a
  // downward-only popover gets clipped at the bottom — and the clip would shift
  // as the list length changes, which is the annoying part).
  const [placement, setPlacement] = useState<{ up: boolean; maxList: number }>({
    up: false,
    maxList: 224,
  });
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only show chips for categories that actually have options.
  const present = GROUP_ORDER.filter((g) => options.some((o) => o.group === g));
  const current = findDestOption(options, valueHref);
  const [activeCat, setActiveCat] = useState<DestGroup>(
    current?.group ?? present[0] ?? "Built-in"
  );

  const q = filter.trim().toLowerCase();
  // Filtering searches across every category; browsing shows the active chip.
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options.filter((o) => o.group === activeCat);
  // While filtering, group the matches under category headers; while browsing a
  // single chip, the chip already names the category so the list stays flat.
  const grouped = q
    ? present
        .map((g) => ({ group: g, items: visible.filter((o) => o.group === g) }))
        .filter((x) => x.items.length > 0)
    : [{ group: activeCat, items: visible }];
  const flat = grouped.flatMap((x) => x.items);
  const activeIndex = active < flat.length ? active : 0;

  const close = () => {
    setOpen(false);
    setFilter("");
    setActive(0);
  };

  // Decide direction + list height from the trigger's position, then open. Done
  // in the click handler (not an effect) so we don't sync state inside an effect.
  const openPicker = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 12;
      const reserve = 104; // filter input + chips + panel padding
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const up = below < 240 && above > below;
      const maxList = Math.max(140, Math.min(300, (up ? above : below) - reserve));
      setPlacement({ up, maxList });
    }
    setOpen(true);
  };

  // Focus the filter on open (a DOM call, not state — resets happen in close()).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const choose = (href: string) => {
    onSelect(href);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[activeIndex]) choose(flat[activeIndex].href);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 ${inputClass} text-left`}
      >
        <NavGlyph icon={current?.icon ?? currentIcon} size={16} className="shrink-0 text-neutral-400" />
        <span className="min-w-0 flex-1 truncate">
          {current ? current.label : `${currentLabel} (missing)`}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-neutral-500"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 z-50 flex flex-col gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl shadow-black/50 ${
            placement.up ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Filter destinations…"
            aria-label="Filter destinations"
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-neutral-600"
          />

          {/* Category chips: browse without knowing what to search for. Picking a
              chip clears the filter so you're browsing that category. */}
          <div className="flex flex-wrap gap-1">
            {present.map((g) => {
              const chipActive = !q && g === activeCat;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setActiveCat(g);
                    setFilter("");
                    setActive(0);
                    inputRef.current?.focus();
                  }}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    chipActive
                      ? "bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent)]"
                      : "border border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto pr-1" style={{ maxHeight: placement.maxList }}>
            {flat.length === 0 && (
              <p className="px-1 py-2 text-xs text-neutral-600">
                No destinations match “{filter}”.
              </p>
            )}
            {grouped.map(({ group, items }) => (
              <div key={group} className="mb-1">
                {/* A header only earns its space when filtering spans categories. */}
                {q && (
                  <p className="px-1 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-neutral-600">
                    {group}
                  </p>
                )}
                {items.map((o) => {
                  const idx = flat.indexOf(o);
                  const isActive = idx === activeIndex;
                  const selected = o.href === valueHref;
                  return (
                    <button
                      key={o.href}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(o.href)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                        isActive ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"
                      }`}
                    >
                      <NavGlyph icon={o.icon} size={16} className="shrink-0 text-neutral-500" />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {selected && <span className="shrink-0 text-xs text-[var(--accent)]">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
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
      // Carry this destination's own badge if it has one (inbox / notifications);
      // a destination that can't carry a badge drops it.
      ...(o.badge ? { badge: o.badge } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-400">Points to</span>
        <DestinationPicker
          options={options}
          valueHref={value.href}
          currentLabel={value.label}
          currentIcon={value.icon}
          onSelect={selectDest}
        />
      </div>

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
            checked={!!value.badge}
            onChange={(e) =>
              onChange({
                ...value,
                ...(e.target.checked && current?.badge
                  ? { badge: current.badge }
                  : { badge: undefined }),
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
        <div className="flex items-center gap-2 self-start">
          <div className="flex gap-1 rounded-lg border border-neutral-800 p-0.5 text-sm">
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
          {/* Standard CSS hover tooltip (CLAUDE.md): explain what a Tools group
              is, since it's not self-evident. No JS, server-render safe. */}
          <span className="group relative inline-flex cursor-help text-neutral-500 hover:text-neutral-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" strokeLinecap="round" />
              <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 text-xs font-normal normal-case leading-relaxed text-neutral-300 opacity-0 shadow-xl shadow-black/50 transition-opacity group-hover:opacity-100"
            >
              A <b className="text-neutral-100">Tools group</b> turns one nav slot
              into a button that opens a small popover menu of related
              destinations, so you can fit several places (say Inbox, Search, and
              Trash) into a single slot. Pick it, name the group, then add the
              destinations it should contain.
            </span>
          </span>
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
