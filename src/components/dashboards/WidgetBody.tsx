// Widget body: renders a widget's content by kind.
//  - view/compact: the cheap list preview (ported from the old DashboardGrid).
//  - view/faithful: the slice-27 ViewRenderer at card scale (mini table/board/
//    calendar/agenda) — reused verbatim, fed the widget's effective view.
//  - stat: a single count.
//  - action: a create/navigation surface (slice 5).
"use client";

import Link from "next/link";
import SubtaskCheckbox from "@/components/subtasks/SubtaskCheckbox";
import ViewRenderer from "@/components/views/ViewRenderer";
import ActionWidgetBody from "./ActionWidgetBody";
import {
  applySettings,
  type ActionWidgetSettings,
  type StatWidgetSettings,
  type TextWidgetSettings,
  type ViewWidgetSettings,
  type WidgetData,
} from "@/lib/dashboard-widgets";

const dueFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export default function WidgetBody({ data }: { data: WidgetData }) {
  const { widget } = data;

  if (widget.kind === "stat") {
    const s = widget.settings as StatWidgetSettings;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
        <span className="text-4xl font-bold tabular-nums text-neutral-100">{data.count}</span>
        <span className="truncate text-xs text-neutral-500">{s.label || data.view?.name || ""}</span>
      </div>
    );
  }

  if (widget.kind === "action") {
    return <ActionWidgetBody settings={widget.settings as ActionWidgetSettings} />;
  }

  if (widget.kind === "text") {
    const t = widget.settings as TextWidgetSettings;
    // No reserved space below the heading: the body only renders (with a small
    // top margin) when there's actually body text. Tight vertical padding so a
    // one-row (≈40px) header hugs the heading.
    return (
      <div className="flex flex-col px-3 py-1.5">
        {t.heading && (
          <h2 className="text-lg font-semibold tracking-tight text-neutral-100">{t.heading}</h2>
        )}
        {t.body && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-400">{t.body}</p>
        )}
        {!t.heading && !t.body && (
          <p className="text-sm text-neutral-600">Empty text block — open the gear to add a heading.</p>
        )}
      </div>
    );
  }

  // view kind
  const settings = widget.settings as ViewWidgetSettings;

  if (settings.renderStyle === "faithful" && data.view) {
    return (
      <div className="h-full overflow-auto px-3 pb-3">
        <ViewRenderer
          view={applySettings(data.view, settings)}
          items={data.items}
          groupOrder={data.groupOrder}
          propertyLabels={data.propertyLabels}
        />
      </div>
    );
  }

  // compact list preview
  return (
    <ul className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      {data.items.length > 0 ? (
        data.items.map((item) => {
          const done = item.statusCategory === "done";
          const isTask = item.type === "task";
          const rel = data.related?.[item.id] ?? [];
          // Prefer a non-task association (the person/meeting/project a task is
          // tagged to) for the chip; fall back to the first related item.
          const assoc = rel.find((r) => r.type !== "task") ?? rel[0];
          return (
            <li key={item.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-800/60">
              {isTask && (
                <span className="cancel-drag shrink-0">
                  <SubtaskCheckbox id={item.id} done={done} />
                </span>
              )}
              <Link
                href={`/items/${item.id}`}
                className={`cancel-drag min-w-0 flex-1 truncate text-sm ${
                  item.title ? "text-neutral-300" : "text-neutral-500"
                } ${done ? "line-through opacity-60" : ""}`}
              >
                {item.title || "Untitled"}
              </Link>
              {assoc && (
                <Link
                  href={`/items/${assoc.id}`}
                  className="cancel-drag shrink-0 max-w-[40%] truncate rounded-full bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
                  title={`Related to ${assoc.title || "Untitled"}${rel.length > 1 ? ` +${rel.length - 1} more` : ""}`}
                >
                  {assoc.title || "Untitled"}
                  {rel.length > 1 ? ` +${rel.length - 1}` : ""}
                </Link>
              )}
              <span className="shrink-0 text-xs text-neutral-600">
                {item.dueDate ? dueFmt.format(item.dueDate) : ""}
              </span>
            </li>
          );
        })
      ) : (
        <li className="px-1.5 py-1 text-sm text-neutral-600">No items match.</li>
      )}
      {widget.viewId && data.count > data.items.length && (
        <li className="px-1.5 pt-1">
          <Link
            href={`/views/${widget.viewId}`}
            className="cancel-drag text-xs text-neutral-500 hover:text-neutral-300"
          >
            +{data.count - data.items.length} more →
          </Link>
        </li>
      )}
    </ul>
  );
}
