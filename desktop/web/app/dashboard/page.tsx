"use client";

// Desktop dashboard detail (read grid). Fetches the fully-resolved widget data
// over the seam (/api/dashboards/:id/resolved → resolveDashboard, shared with
// the cloud DashboardView) and lays the widgets out in a static 12-column grid
// honoring each widget's saved size. This is the read/view surface; the drag/
// resize editor (react-grid-layout) is deferred on desktop (defer-by-hiding) —
// dashboards are still authored/edited in the cloud app. ADR-139.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ItemRows, { type ItemRow } from "@/components/ItemRows";
import { widgetTitle } from "@/components/dashboards/widget-title";
import type {
  ActionWidgetSettings,
  DashboardWidget,
  ImageWidgetSettings,
  TextWidgetSettings,
  WidgetData,
} from "@/lib/dashboard-widgets";
import { apiRequest } from "@/lib/api-client";

type Resolved = {
  id: string;
  name: string;
  focusTitle: string | null;
  widgets: WidgetData[];
};

const toRow = (i: WidgetData["items"][number]): ItemRow => ({
  id: i.id,
  title: i.title,
  type: i.type,
  statusCategory: i.statusCategory,
  dueDate: i.dueDate == null ? null : String(i.dueDate),
  scheduledDate: i.scheduledDate == null ? null : String(i.scheduledDate),
});

function WidgetBody({ data, onOpen }: { data: WidgetData; onOpen: (id: string) => void }) {
  const { widget } = data;

  if (widget.kind === "stat") {
    const label = ("label" in widget.settings && widget.settings.label) || data.view?.name || "";
    return (
      <div className="flex flex-col items-start">
        <span className="text-4xl font-bold tabular-nums text-neutral-100">{data.count}</span>
        {label ? <span className="mt-1 text-sm text-neutral-500">{label}</span> : null}
      </div>
    );
  }

  if (widget.kind === "text") {
    const s = widget.settings as TextWidgetSettings;
    return s.body ? (
      <p className="whitespace-pre-wrap text-sm text-neutral-300">{s.body}</p>
    ) : (
      <p className="text-sm text-neutral-600">No text.</p>
    );
  }

  if (widget.kind === "embed") {
    const body = data.embedItem?.body as { text?: string } | undefined;
    return (
      <div>
        {data.embedItem?.id ? (
          <button
            onClick={() => onOpen(data.embedItem!.id)}
            className="mb-2 text-sm text-neutral-400 hover:underline"
          >
            Open item →
          </button>
        ) : null}
        {body?.text ? (
          <p className="whitespace-pre-wrap text-sm text-neutral-300">{body.text}</p>
        ) : (
          <p className="text-sm text-neutral-600">Empty.</p>
        )}
      </div>
    );
  }

  if (widget.kind === "action") {
    const s = widget.settings as ActionWidgetSettings;
    const href =
      s.action === "link" && s.href
        ? s.href
        : s.targetType
          ? `/list?type=${s.targetType}`
          : "/inbox";
    return (
      <a href={href} className="text-sm text-neutral-300 hover:underline">
        {s.label || (s.action === "link" ? "Open" : "Quick add")} →
      </a>
    );
  }

  if (widget.kind === "image") {
    const s = widget.settings as ImageWidgetSettings;
    return s.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={s.url}
        alt={s.alt}
        className={`max-h-64 w-full rounded ${s.fit === "contain" ? "object-contain" : "object-cover"}`}
      />
    ) : (
      <p className="text-sm text-neutral-600">No image URL.</p>
    );
  }

  if (widget.kind === "tree") {
    const parents = data.parents ?? [];
    if (!parents.length) return <p className="py-2 text-sm text-neutral-500">Nothing here yet.</p>;
    return (
      <ul className="flex list-none flex-col gap-3 p-0">
        {parents.map((p) => {
          const kids = data.childrenByParent?.[p.id] ?? [];
          const total = data.childCountByParent?.[p.id] ?? kids.length;
          return (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p.id)}
                className="text-left font-medium text-neutral-200 hover:underline"
              >
                {p.title || "(untitled)"}
              </button>
              <div className="ml-3 border-l border-neutral-800 pl-3">
                <ItemRows items={kids.map(toRow)} empty="No children." onOpen={onOpen} />
                {total > kids.length ? (
                  <p className="py-1 text-xs text-neutral-600">+{total - kids.length} more</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (widget.kind === "container") {
    const kids = data.childData ?? [];
    return (
      <div className="flex flex-col gap-4">
        {kids.map((c) => (
          <div key={c.widget.id}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {widgetTitle(c)}
            </h4>
            <WidgetBody data={c} onOpen={onOpen} />
          </div>
        ))}
      </div>
    );
  }

  // view kind
  const rows = data.items.map(toRow);
  const more = data.count - data.items.length;
  return (
    <div>
      <ItemRows items={rows} onOpen={onOpen} />
      {more > 0 ? <p className="py-1 text-xs text-neutral-600">+{more} more</p> : null}
    </div>
  );
}

function spanFor(widget: DashboardWidget): number {
  const w = widget.layout.lg?.w ?? widget.layout.md?.w ?? 6;
  return Math.min(12, Math.max(2, w));
}

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const [data, setData] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("No dashboard id.");
      return;
    }
    apiRequest<Resolved>(`/api/dashboards/${id}/resolved`)
      .then(setData)
      .catch(() => setError("Could not load this dashboard."));
  }, [id]);

  const open = (itemId: string) => router.push(`/item?id=${itemId}`);

  if (error) return <section className="p-6 text-neutral-500">{error}</section>;
  if (!data) return <section className="p-6 text-neutral-500">loading…</section>;

  // Order by saved grid position (top-to-bottom, then left-to-right).
  const ordered = [...data.widgets].sort((a, b) => {
    const la = a.widget.layout.lg ?? { x: 0, y: 0 };
    const lb = b.widget.layout.lg ?? { x: 0, y: 0 };
    return la.y - lb.y || la.x - lb.x;
  });

  return (
    <section className="p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-neutral-100">{data.name}</h1>
        {data.focusTitle ? (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">
            Focus: {data.focusTitle}
          </span>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-600">This dashboard has no widgets yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-12 gap-4">
          {ordered.map((d) => (
            <div
              key={d.widget.id}
              className="col-span-12 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
              style={{ gridColumn: `span ${spanFor(d.widget)} / span ${spanFor(d.widget)}` }}
            >
              {d.widget.kind !== "image" ? (
                <h3 className="mb-2 text-sm font-semibold text-neutral-200">{widgetTitle(d)}</h3>
              ) : null}
              <WidgetBody data={d} onOpen={open} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<section className="p-6 text-neutral-500">loading…</section>}>
      <DashboardInner />
    </Suspense>
  );
}
