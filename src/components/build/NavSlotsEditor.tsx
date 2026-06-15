// The live nav-slot editor on the Build surface (slice: nav customization,
// ADR-056). Replaces the old read-only slot list. Owns the desktop + (optional)
// mobile slot arrays, persists the whole array to PATCH /api/settings on every
// change, and renders a live preview bar + a drag-to-reorder slot list + the
// add/edit panel. No DnD or drag library — native HTML5 drag (Principle 5).
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import NavGlyph from "@/components/nav/NavGlyph";
import NavSlotEditor from "@/components/build/NavSlotEditor";
import ConfirmButton from "@/components/ui/ConfirmButton";
import type { DestOption } from "@/lib/nav-slot-options";
import {
  MAX_MOBILE_NAV_SLOTS,
  MAX_NAV_SLOTS,
  type NavSlotConfig,
} from "@/lib/settings";

type ListKey = "desktop" | "mobile";

// One chip in the live preview bar.
function PreviewChip({
  icon,
  label,
  accent = false,
  dim = false,
}: {
  icon: string;
  label: string;
  accent?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] ${
        accent ? "text-[var(--accent)]" : "text-neutral-400"
      } ${dim ? "opacity-30" : ""}`}
    >
      <NavGlyph icon={icon} size={18} />
      <span className="max-w-[3.5rem] truncate">{label}</span>
    </div>
  );
}

function PreviewBar({
  slots,
  max,
  phone = false,
}: {
  slots: NavSlotConfig[];
  max: number;
  phone?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1 overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/95 p-1.5 ${
        phone ? "mx-auto w-[390px] max-w-full" : ""
      }`}
    >
      <PreviewChip icon="home" label="Home" />
      {slots.map((s, i) => (
        <PreviewChip
          key={i}
          icon={s.icon}
          label={s.label}
          dim={i >= max}
        />
      ))}
      <PreviewChip icon="tools" label="New" accent />
      <PreviewChip icon="items" label="More" />
    </div>
  );
}

export default function NavSlotsEditor({
  initialDesktop,
  initialMobile,
  options,
}: {
  initialDesktop: NavSlotConfig[];
  initialMobile: NavSlotConfig[] | null;
  options: DestOption[];
}) {
  const [desktop, setDesktop] = useState<NavSlotConfig[]>(initialDesktop);
  const [mobileMode, setMobileMode] = useState<"mirror" | "custom">(
    initialMobile ? "custom" : "mirror"
  );
  // The custom mobile list is seeded from the desktop list the first time the
  // user switches to custom (so they start from something, not empty).
  const [mobile, setMobile] = useState<NavSlotConfig[]>(
    initialMobile ?? initialDesktop.slice(0, MAX_MOBILE_NAV_SLOTS)
  );
  const [tab, setTab] = useState<ListKey>("desktop");
  // The add/edit panel: which list + which index (null = adding a new slot).
  const [editor, setEditor] = useState<{ index: number | null } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const activeKey: ListKey = mobileMode === "custom" ? tab : "desktop";
  const list = activeKey === "mobile" ? mobile : desktop;
  const max = activeKey === "mobile" ? MAX_MOBILE_NAV_SLOTS : MAX_NAV_SLOTS;

  // Persist the whole config (always the full arrays — no partial updates), then
  // router.refresh() so the live nav (a server component) re-renders with the
  // new slots right away. The editor's own state is seeded from props only at
  // mount, so the refresh updates the nav without resetting the form.
  function persist(nextDesktop: NavSlotConfig[], mode: "mirror" | "custom", nextMobile: NavSlotConfig[]) {
    setSaved(false);
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        navSlots: nextDesktop,
        mobileNavSlots: mode === "custom" ? nextMobile : null,
      }),
    })
      .then(() => {
        setSaved(true);
        router.refresh();
      })
      .catch(() => {});
  }

  // Write back the active list and persist.
  function commit(next: NavSlotConfig[]) {
    if (activeKey === "mobile") {
      setMobile(next);
      persist(desktop, mobileMode, next);
    } else {
      setDesktop(next);
      persist(next, mobileMode, mobile);
    }
  }

  function setMode(mode: "mirror" | "custom") {
    setMobileMode(mode);
    setEditor(null);
    if (mode === "mirror") {
      setTab("desktop");
      persist(desktop, "mirror", mobile);
    } else {
      // Seed the mobile list from desktop if it's empty (first switch).
      const seeded = mobile.length ? mobile : desktop.slice(0, MAX_MOBILE_NAV_SLOTS);
      setMobile(seeded);
      persist(desktop, "custom", seeded);
    }
  }

  function saveSlot(slot: NavSlotConfig) {
    const next =
      editor?.index == null
        ? [...list, slot].slice(0, max)
        : list.map((s, i) => (i === editor!.index ? slot : s));
    commit(next);
    setEditor(null);
  }

  function removeSlot(i: number) {
    commit(list.filter((_, idx) => idx !== i));
  }

  // Native drag reorder within the active list.
  function onDrop(target: number) {
    if (dragIndex == null || dragIndex === target) return;
    const next = [...list];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    setDragIndex(null);
    commit(next);
  }

  const previewSlots = activeKey === "mobile" ? mobile : desktop;

  return (
    <div className="mt-2 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          The middle slots between Home and the New / More buttons. Drag to
          reorder.
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <span className="text-neutral-500">Mobile:</span>
          <select
            value={mobileMode}
            onChange={(e) => setMode(e.target.value as "mirror" | "custom")}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          >
            <option value="mirror">Same as desktop</option>
            <option value="custom">Custom</option>
          </select>
        </label>
      </div>

      {mobileMode === "custom" && (
        <div className="flex gap-1 self-start rounded-lg border border-neutral-800 p-0.5 text-sm">
          {(["desktop", "mobile"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setEditor(null);
              }}
              className={`rounded px-3 py-1 capitalize ${
                tab === t
                  ? "bg-neutral-700 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Live preview. */}
      <div>
        <p className="pb-1 text-xs font-medium text-neutral-500">
          Preview {activeKey === "mobile" ? "(phone bottom bar)" : ""}
        </p>
        <PreviewBar slots={previewSlots} max={max} phone={activeKey === "mobile"} />
        {activeKey === "mobile" && (
          <p className="pt-1 text-xs text-neutral-600">
            The mobile bottom bar fits about {MAX_MOBILE_NAV_SLOTS} slots.
          </p>
        )}
      </div>

      {/* Slot list. */}
      <ul className="flex flex-col gap-1">
        {list.map((slot, i) => (
          <li
            key={i}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            onDragEnd={() => setDragIndex(null)}
            className={`flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 ${
              dragIndex === i ? "opacity-50" : ""
            }`}
          >
            <span className="cursor-grab select-none text-neutral-600" aria-hidden>
              ⠿
            </span>
            <span className="text-neutral-300">
              <NavGlyph icon={slot.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
              {slot.label}
            </span>
            <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
              {slot.type === "tools" ? `group · ${slot.children.length}` : "page"}
            </span>
            <button
              type="button"
              onClick={() => setEditor({ index: i })}
              className="shrink-0 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              Edit
            </button>
            <ConfirmButton
              onConfirm={() => removeSlot(i)}
              title="Remove this slot?"
              description="It leaves the nav bar but nothing it points to is deleted."
              confirmLabel="Remove"
              align="right"
              triggerLabel="Remove slot"
              triggerClassName="shrink-0 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
              trigger={<span aria-hidden>✕</span>}
            />
          </li>
        ))}
        {list.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-800 px-3 py-4 text-center text-sm text-neutral-600">
            No middle slots. Home, New, and More still show.
          </li>
        )}
      </ul>

      {/* Add / edit panel. */}
      {editor ? (
        <NavSlotEditor
          initial={editor.index != null ? list[editor.index] : undefined}
          options={options}
          onSave={saveSlot}
          onCancel={() => setEditor(null)}
        />
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditor({ index: null })}
            disabled={list.length >= max}
            className="self-start rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800/60 disabled:opacity-40"
          >
            + Add slot
          </button>
          {list.length >= max && (
            <span className="text-xs text-neutral-600">Maximum {max} slots.</span>
          )}
          {saved && <span className="text-xs text-neutral-600">Saved.</span>}
        </div>
      )}
    </div>
  );
}
