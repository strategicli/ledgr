// Per-widget settings (the gear, edit mode only). A small popover anchored to
// the gear button — matches the ConfirmButton chrome (dark panel, outside-click
// / Esc close). Fields by kind; every change calls onChange with the FULL new
// settings object (display-only — never mutates the backing view). The parent
// persists + refetches where the change affects data.
"use client";

import { useEffect, useRef } from "react";
import type {
  ActionKind,
  ActionWidgetSettings,
  DashboardWidget,
  RenderStyle,
  StatWidgetSettings,
  TextWidgetSettings,
  ViewWidgetSettings,
  WidgetSettings,
} from "@/lib/dashboard-widgets";

// Client-safe copy of the view sort fields (views.ts is server-only).
const SORT_FIELD_OPTS = ["updatedAt", "createdAt", "dueDate", "meetingAt", "title"] as const;
const ITEM_LIMIT_OPTS = [5, 10, 15, 20, 50] as const;
const ACTION_OPTS: { value: ActionKind; label: string }[] = [
  { value: "quick-capture", label: "Quick capture" },
  { value: "new-from-template", label: "New from template" },
  { value: "link", label: "Link" },
];

const field = "text-xs text-neutral-400";
const input =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200";

export default function WidgetSettingsPopover({
  widget,
  onChange,
  onClose,
}: {
  widget: DashboardWidget;
  onChange: (settings: WidgetSettings) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="cancel-drag absolute right-0 z-40 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl"
    >
      <div className="flex flex-col gap-2">{renderFields(widget, onChange)}</div>
    </div>
  );
}

function renderFields(widget: DashboardWidget, onChange: (s: WidgetSettings) => void) {
  if (widget.kind === "view") {
    const s = widget.settings as ViewWidgetSettings;
    return (
      <>
        <label className={field}>
          Render
          <select
            value={s.renderStyle}
            onChange={(e) => onChange({ ...s, renderStyle: e.target.value as RenderStyle })}
            className={input}
          >
            <option value="compact">Compact list</option>
            <option value="faithful">Faithful layout</option>
          </select>
        </label>
        <label className={field}>
          Items shown
          <select
            value={s.itemLimit ?? ""}
            onChange={(e) =>
              onChange({ ...s, itemLimit: e.target.value ? Number(e.target.value) : null })
            }
            className={input}
          >
            <option value="">Default</option>
            {ITEM_LIMIT_OPTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Sort
          <div className="flex gap-1">
            <select
              value={s.sortOverride?.field ?? ""}
              onChange={(e) =>
                onChange({
                  ...s,
                  sortOverride: e.target.value
                    ? { field: e.target.value as (typeof SORT_FIELD_OPTS)[number], dir: s.sortOverride?.dir ?? "desc" }
                    : null,
                })
              }
              className={input}
            >
              <option value="">View default</option>
              {SORT_FIELD_OPTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            {s.sortOverride && (
              <select
                value={s.sortOverride.dir}
                onChange={(e) =>
                  onChange({
                    ...s,
                    sortOverride: { field: s.sortOverride!.field, dir: e.target.value as "asc" | "desc" },
                  })
                }
                className={input}
              >
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
            )}
          </div>
        </label>
        <label className={field}>
          Title
          <input
            type="text"
            value={s.titleOverride ?? ""}
            placeholder="(view name)"
            onChange={(e) => onChange({ ...s, titleOverride: e.target.value || null })}
            className={input}
          />
        </label>
      </>
    );
  }

  if (widget.kind === "stat") {
    const s = widget.settings as StatWidgetSettings;
    return (
      <label className={field}>
        Label
        <input
          type="text"
          value={s.label}
          placeholder="(view name)"
          onChange={(e) => onChange({ ...s, label: e.target.value })}
          className={input}
        />
      </label>
    );
  }

  if (widget.kind === "text") {
    const s = widget.settings as TextWidgetSettings;
    return (
      <>
        <label className={field}>
          Heading
          <input
            type="text"
            value={s.heading}
            placeholder="Section title"
            onChange={(e) => onChange({ ...s, heading: e.target.value })}
            className={input}
          />
        </label>
        <label className={field}>
          Note
          <textarea
            value={s.body}
            rows={4}
            placeholder="Optional text…"
            onChange={(e) => onChange({ ...s, body: e.target.value })}
            className={input}
          />
        </label>
      </>
    );
  }

  // action
  const s = widget.settings as ActionWidgetSettings;
  return (
    <>
      <label className={field}>
        Action
        <select
          value={s.action}
          onChange={(e) => onChange({ ...s, action: e.target.value as ActionKind })}
          className={input}
        >
          {ACTION_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Label
        <input
          type="text"
          value={s.label}
          onChange={(e) => onChange({ ...s, label: e.target.value })}
          className={input}
        />
      </label>
      {s.action !== "link" && (
        <label className={field}>
          Type key
          <input
            type="text"
            value={s.targetType ?? ""}
            placeholder="e.g. task"
            onChange={(e) => onChange({ ...s, targetType: e.target.value || null })}
            className={input}
          />
        </label>
      )}
      {s.action === "new-from-template" && (
        <label className={field}>
          Template id
          <input
            type="text"
            value={s.templateId ?? ""}
            onChange={(e) => onChange({ ...s, templateId: e.target.value || null })}
            className={input}
          />
        </label>
      )}
      {s.action === "link" && (
        <label className={field}>
          URL / path
          <input
            type="text"
            value={s.href ?? ""}
            placeholder="/tasks or https://…"
            onChange={(e) => onChange({ ...s, href: e.target.value || null })}
            className={input}
          />
        </label>
      )}
    </>
  );
}
