// The Year Map grid and its controls (ADR-287), ported from the design mock
// (explorations/year-map-mock.html). A click on a bar opens its item; dragging
// edits dates (slice 2, useYearEdit). Every control saves to the view (display.modes.year),
// so each saved view of the same rows keeps its own look, and print uses it.
"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PlacementSpec } from "@/lib/placement";
import type { ViewDefinition } from "@/lib/views";
import { useYearEdit, type YearEdit } from "./useYearEdit";
import {
  PAPERS,
  addMonths,
  colorFor,
  fmtDay,
  daysIn,
  monthColumns,
  monthSegments,
  parseYearSettings,
  styleFor,
  weekdayOf,
  windowLength,
  windowStart,
  ymKey,
  YEAR_MODE,
  type OutlookSpan,
  type Paper,
  type YearSettings,
  type Ym,
} from "./lib";
import "./year-map.css";

export type YearEntry = {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD
  end: string; // inclusive; equals start for a one-day chip
  vals: Record<string, string[]>; // field → values (tag, type, status, prop:<key>)
  edit?: YearEdit; // absent = read-only
};
export type YearField = { key: string; label: string; hidden?: boolean };

const NONE = "None";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Page sizes as explicit landscape dimensions: "tabloid" is not a CSS keyword.
const PAGE_SIZE: Record<Paper, string> = {
  letter: "11in 8.5in",
  legal: "14in 8.5in",
  tabloid: "17in 11in",
  a4: "297mm 210mm",
  a3: "420mm 297mm",
};

const first = (e: YearEntry, field: string) => e.vals[field]?.[0] ?? NONE;

// Everything the client grid takes: what prepareYearMap (YearMap.tsx) returns,
// plus `compact` from the mount (a dashboard widget).
export type YearMapProps = {
  view: ViewDefinition;
  settingsRaw: unknown;
  entries: YearEntry[];
  fields: YearField[];
  today: string;
  tz: string;
  specs: PlacementSpec[];
  createType: string; // the type a click-drag creates
  month?: string;
  navHref?: string;
  events?: OutlookSpan[]; // cached Outlook all-day and multi-day events, read-only
  calendarAvailable?: boolean; // calendar sync is on, so the Outlook toggle shows
  compact?: boolean; // widget scale: no controls, legend or note; always Fit
};

export default function YearMapClient({
  view,
  settingsRaw,
  entries,
  fields,
  today,
  tz,
  specs,
  createType,
  month,
  navHref,
  events = [],
  calendarAvailable = false,
  compact = false,
}: YearMapProps) {
  const router = useRouter();
  const [s, setS] = useState<YearSettings>(() => parseYearSettings(settingsRaw));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pop, setPop] = useState<{ id: string; top: number } | null>(null);
  const [fitDayW, setFitDayW] = useState(99);
  const layout = compact ? "fit" : s.layout;
  const wrapRef = useRef<HTMLDivElement>(null);
  const ed = useYearEdit({ tz, specs, createType });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save the settings onto the view, debounced so typing a number is one write.
  // A built-in (system) view can't be edited, so its changes stay on screen only.
  function update(patch: Partial<YearSettings>) {
    setS((prev) => {
      const next = { ...prev, ...patch };
      if (!view.isSystem) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void save(next), 600);
      }
      return next;
    });
  }
  async function save(next: YearSettings): Promise<boolean> {
    const display = { ...view.display, modes: { ...view.display?.modes, [YEAR_MODE]: next } };
    try {
      const res = await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: view.name,
          layout: view.layout,
          filter: view.filter,
          sort: view.sort,
          grouping: view.grouping,
          columns: view.columns,
          dateProperty: view.dateProperty,
          display,
        }),
      });
      setSaveError(res.ok ? null : `Couldn't save these settings (${res.status}).`);
      return res.ok;
    } catch {
      setSaveError("Couldn't save these settings (offline?).");
      return false;
    }
  }
  // The Outlook toggle saves at once, then refreshes so the server (which reads
  // the saved setting) fetches the events.
  async function toggleCalendar(on: boolean) {
    const next = { ...s, showCalendar: on };
    setS(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (await save(next)) router.refresh();
  }

  // The window: which months, starting where.
  const anchor: Ym = month
    ? { y: Number(month.slice(0, 4)), m: Number(month.slice(5, 7)) }
    : { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
  const start = windowStart(s, anchor);
  const n = windowLength(s);
  const months = Array.from({ length: n }, (_, i) => addMonths(start, i));
  const endYm = months[months.length - 1];
  const title =
    s.window === "year"
      ? String(start.y)
      : `${MONTHS[start.m - 1]} ${start.y} – ${MONTHS[endYm.m - 1]} ${endYm.y}`;
  const navTo = (ym: Ym) => `${navHref}?month=${ymKey(ym)}`;

  // Legend values for the color and style fields, sorted so a palette slot
  // stays put as items come and go.
  const valuesOf = (field: string | null) =>
    field ? [...new Set(entries.map((e) => first(e, field)))].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b))) : [];
  const colorValues = useMemo(() => valuesOf(s.colorBy), [entries, s.colorBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const styleValues = useMemo(() => valuesOf(s.styleBy), [entries, s.styleBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const off = new Set(s.off[s.colorBy] ?? []);
  const shown = entries
    .filter((e) => !off.has(first(e, s.colorBy)))
    .map((e) => (ed.override[e.id] ? { ...e, ...ed.override[e.id] } : e));
  // Outlook bars ride the same lanes as items, ids prefixed so they can't collide.
  const evById = useMemo(() => new Map(events.map((e) => [`ev:${e.id}`, e])), [events]);
  const evSpans = s.showCalendar && calendarAvailable ? [...evById].map(([id, e]) => ({ id, start: e.start, end: e.end })) : [];
  // The hover card reads the live entry, so it shows a drag's new dates.
  const popEntry = pop ? shown.find((x) => x.id === pop.id) : undefined;
  const popEv = pop ? evById.get(pop.id) : undefined;
  const inDraft = (ymd: string) => !!ed.draft && ymd >= ed.draft.start && ymd <= ed.draft.end;
  const byId = new Map(shown.map((e) => [e.id, e]));

  // Chips collapse to dots when a day is too narrow for a word. Fit measures
  // the real column width; Scroll knows it from the setting.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || layout !== "fit") return;
    const cols = s.align === "weekday" ? 37 : 31;
    const ro = new ResizeObserver(() => setFitDayW((el.clientWidth - 56) / cols));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, s.align]);
  const dayW = layout === "fit" ? fitDayW : s.dayPx;
  const narrow = s.dots && dayW < Math.max(22, s.textPx * 2.4);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const cols = s.align === "weekday" ? 37 : 31;
  const rootStyle = { "--fs": `${s.textPx}px`, "--dayw": `${s.dayPx}px`, "--cols": cols } as CSSProperties;
  const fieldLabel = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const fieldOpts = fields.map((f) => (
    <option key={f.key} value={f.key}>
      {f.label}
      {f.hidden ? " (hidden)" : ""}
    </option>
  ));

  function seg<K extends "layout" | "align">(key: K, opts: [YearSettings[K], string][]) {
    return (
      <span className="ym-seg">
        {opts.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={s[key] === v} onClick={() => update({ [key]: v } as Partial<YearSettings>)}>
            {label}
          </button>
        ))}
      </span>
    );
  }

  return (
    <div className={`ym-root ${layout === "fit" ? "ym-fit" : ""}`} style={rootStyle}>
      <style>{`@page{size:${PAGE_SIZE[s.paper]};margin:8mm}`}</style>
      {!compact && <div className="ym-controls">
        <span className="ym-nav">
          {navHref && <a href={navTo(addMonths(start, -n))} aria-label="Previous">‹</a>}
          <span>{title}</span>
          {navHref && <a href={navTo(addMonths(start, n))} aria-label="Next">›</a>}
          {navHref && month && <a href={navHref} className="font-normal">Today</a>}
        </span>
        <label>Layout {seg("layout", [["fit", "Fit"], ["scroll", "Scroll"]])}</label>
        <label>Columns {seg("align", [["weekday", "Weekdays"], ["day1", "Day 1"]])}</label>
        <label>
          Text
          <input type="number" min={5} max={20} step={1} value={s.textPx}
            onChange={(e) => update({ textPx: Math.min(20, Math.max(5, Number(e.target.value) || 11)) })} />
          px
        </label>
        {s.layout === "scroll" && (
          <label>
            Day
            <input type="number" min={12} max={120} step={4} value={s.dayPx}
              onChange={(e) => update({ dayPx: Math.min(120, Math.max(12, Number(e.target.value) || 40)) })} />
            px
          </label>
        )}
        <label>
          Window
          <select value={s.window} onChange={(e) => update({ window: e.target.value as YearSettings["window"] })}>
            <option value="year">Calendar year</option>
            <option value="fiscal">Fiscal year</option>
            <option value="rolling">Rolling months</option>
          </select>
        </label>
        {s.window === "fiscal" && (
          <label>
            from
            <select value={s.fiscalStart} onChange={(e) => update({ fiscalStart: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        )}
        {s.window === "rolling" && (
          <label>
            <input type="number" min={1} max={24} value={s.months}
              onChange={(e) => update({ months: Math.min(24, Math.max(1, Number(e.target.value) || 3)) })} />
            months
          </label>
        )}
        <label>
          Color by
          <select value={s.colorBy} onChange={(e) => update({ colorBy: e.target.value })}>{fieldOpts}</select>
        </label>
        <label>
          Style by
          <select value={s.styleBy ?? ""} onChange={(e) => update({ styleBy: e.target.value || null })}>
            <option value="">None</option>
            {fieldOpts}
          </select>
        </label>
        <details className="ym-more">
          <summary>More ▾</summary>
          <div>
            <label><input type="checkbox" checked={s.fadePast} onChange={(e) => update({ fadePast: e.target.checked })} /> Fade past items</label>
            <label><input type="checkbox" checked={s.weekends} onChange={(e) => update({ weekends: e.target.checked })} /> Shade weekends</label>
            {calendarAvailable && !view.isSystem && (
              <label>
                <input type="checkbox" checked={s.showCalendar} onChange={(e) => void toggleCalendar(e.target.checked)} /> Show Outlook all-day and multi-day events
              </label>
            )}
            <label><input type="checkbox" checked={s.dots} onChange={(e) => update({ dots: e.target.checked })} /> Show one-day items as dots when days are narrow</label>
            <label>
              Paper
              <select value={s.paper} onChange={(e) => update({ paper: e.target.value as Paper })}>
                {(Object.keys(PAPERS) as Paper[]).map((p) => <option key={p} value={p}>{PAPERS[p]} landscape</option>)}
              </select>
            </label>
            <button type="button" className="ym-btn" onClick={() => window.print()}>Print / Save as PDF</button>
          </div>
        </details>
      </div>}

      {!compact && <div className="ym-legend">
        <span className="k">Color: {fieldLabel(s.colorBy)}</span>
        {colorValues.map((v) => {
          const c = colorFor(s, s.colorBy, v, colorValues);
          const isOff = off.has(v);
          return (
            <span key={v} className={`ym-chip ${isOff ? "off" : ""}`}>
              <input type="color" value={c} aria-label={`Color for ${v}`}
                onChange={(e) => update({ colors: { ...s.colors, [s.colorBy]: { ...s.colors[s.colorBy], [v]: e.target.value } } })} />
              <button type="button" title={isOff ? "Show this group" : "Hide this group"}
                onClick={() => {
                  const list = isOff ? [...off].filter((x) => x !== v) : [...off, v];
                  update({ off: { ...s.off, [s.colorBy]: list } });
                }}>
                {v}
              </button>
            </span>
          );
        })}
        {s.styleBy && (
          <>
            <span className="k" style={{ marginLeft: 12 }}>Style: {fieldLabel(s.styleBy)}</span>
            {styleValues.map((v) => (
              <span key={v} className="ym-chip" style={{ paddingLeft: 3 }}>
                <span className={`ym-bar ${styleFor(v, styleValues)}`}>{v}</span>
              </span>
            ))}
          </>
        )}
      </div>}

      <div className="ym-wrap" ref={wrapRef} onScroll={() => setPop(null)}>
        <div className={`ym-grid ${narrow ? "ym-dots" : ""}`} onPointerDown={ed.beginCreate} onDoubleClick={ed.createOnDay}>
          <div className="ym-month ym-head">
            <div className="ym-mlabel">{s.window === "year" ? start.y : ""}</div>
            {Array.from({ length: cols }, (_, c) =>
              s.align === "weekday" ? (
                <div key={c} className={`h ${s.weekends && c % 7 >= 5 ? "we" : ""}`}>{narrow ? WEEKDAYS[c % 7][0] : WEEKDAYS[c % 7]}</div>
              ) : (
                <div key={c} className="h">{c + 1}</div>
              )
            )}
          </div>
          {months.map((ym) => {
            const { offset } = monthColumns(s, ym);
            const nd = daysIn(ym);
            const { segs, lanes } = monthSegments([...shown, ...evSpans], ym);
            return (
              <div key={ymKey(ym)} className="ym-month"
                style={{ gridTemplateRows: `13px repeat(${Math.max(lanes, 1)}, var(--lane-h))` }}>
                <div className="ym-mlabel">
                  {MONTHS[ym.m - 1]}
                  {s.window !== "year" ? ` '${String(ym.y).slice(2)}` : ""}
                </div>
                {Array.from({ length: cols }, (_, c) => {
                  const day = c - offset + 1;
                  if (day < 1 || day > nd) return <div key={c} className="ym-pad" style={{ gridColumn: c + 2 }} />;
                  const we = s.weekends && weekdayOf(ym.y, ym.m, day) >= 5;
                  const ymd = `${ymKey(ym)}-${String(day).padStart(2, "0")}`;
                  return (
                    <div key={c} data-ymd={ymd}
                      className={`ym-day ${we ? "we" : ""} ${ymd === today ? "today" : ""} ${inDraft(ymd) ? "sel" : ""}`}
                      style={{ gridColumn: c + 2 }}>
                      <span className="n">{day}</span>
                    </div>
                  );
                })}
                {segs.map((sg) => {
                  const ev = evById.get(sg.id);
                  if (ev) {
                    // A read-only Outlook bar: no link, drag or handles, and the
                    // legend and fade-past don't touch it.
                    return (
                      <div key={sg.id} className={`ym-bar ym-ev ${sg.single ? "one" : ""}`}
                        style={{ gridColumn: `${sg.from + offset + 1} / ${sg.to + offset + 2}`, gridRow: sg.lane + 2 } as CSSProperties}
                        onMouseEnter={(m) => setPop({ id: sg.id, top: m.currentTarget.getBoundingClientRect().bottom + 6 })}
                        onMouseLeave={() => setPop(null)}>
                        <span className="t">{ev.title}</span>
                      </div>
                    );
                  }
                  const e = byId.get(sg.id)!;
                  const cls = [
                    "ym-bar",
                    s.styleBy ? styleFor(first(e, s.styleBy), styleValues) : "",
                    sg.single ? "one" : "",
                    s.fadePast && e.end < today ? "past" : "",
                    e.edit?.can.move ? "drag" : "",
                  ].join(" ");
                  // Edge handles only where the span really starts or ends.
                  const canStart = e.edit && (e.edit.can.resizeStart || e.edit.stretch) && e.start >= `${ymKey(ym)}-01`;
                  const canEnd = e.edit && (e.edit.can.resizeEnd || e.edit.stretch) && e.end <= `${ymKey(ym)}-${String(nd).padStart(2, "0")}`;
                  return (
                    <a key={sg.id} href={`/items/${e.id}`} className={cls}
                      style={{
                        "--c": colorFor(s, s.colorBy, first(e, s.colorBy), colorValues),
                        gridColumn: `${sg.from + offset + 1} / ${sg.to + offset + 2}`,
                        gridRow: sg.lane + 2,
                      } as CSSProperties}
                      onPointerDown={(ev) => {
                        setPop(null);
                        ed.beginDrag(ev, e, "move");
                      }}
                      onClick={(ev) => {
                        if (ed.dragged.current) {
                          ev.preventDefault();
                          ed.dragged.current = false;
                        }
                      }}
                      draggable={false}
                      onMouseEnter={(ev) => setPop({ id: e.id, top: ev.currentTarget.getBoundingClientRect().bottom + 6 })}
                      onMouseLeave={() => setPop(null)}>
                      {canStart && <span className="ym-h l" title="Drag to change the start" onPointerDown={(ev) => ed.beginDrag(ev, e, "start")} />}
                      <span className="t">{e.title}</span>
                      {canEnd && <span className="ym-h r" title="Drag to change the end" onPointerDown={(ev) => ed.beginDrag(ev, e, "end")} />}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {popEv && pop && (
        <div className="ym-pop" style={{ top: pop.top }} role="tooltip">
          <b>{popEv.title}</b>
          <span className="m">{["Outlook event", popEv.location].filter(Boolean).join(" · ")}</span>
          <br />
          <span className="m">
            {fmtDay(popEv.start)}
            {popEv.end !== popEv.start ? ` → ${fmtDay(popEv.end)}` : ""}
          </span>
        </div>
      )}
      {popEntry && pop && (
        <div className="ym-pop" style={{ top: pop.top }} role="tooltip">
          <b>{popEntry.title}</b>
          <span className="m">
            {[first(popEntry, "type"), first(popEntry, "status"), ...(popEntry.vals.tag ?? [])].join(" · ")}
          </span>
          <br />
          <span className="m">
            {fmtDay(popEntry.start)}
            {popEntry.end !== popEntry.start ? ` → ${fmtDay(popEntry.end)}` : ""}
          </span>
        </div>
      )}
      {ed.prompt && (
        <form className="ym-new" style={{ left: Math.min(ed.prompt.x, window.innerWidth - 260), top: ed.prompt.y + 8 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            void ed.create(new FormData(ev.currentTarget).get("title") as string);
          }}>
          <span className="m">
            New {createType} · {fmtDay(ed.prompt.span.start)}
            {ed.prompt.span.end !== ed.prompt.span.start ? ` → ${fmtDay(ed.prompt.span.end)}` : ""}
          </span>
          <input name="title" autoFocus placeholder="Title, then Enter" aria-label="New item title"
            onKeyDown={(ev) => ev.key === "Escape" && ed.cancelCreate()} onBlur={() => ed.cancelCreate()} />
        </form>
      )}
      {saveError && <p className="ym-note" role="alert">{saveError}</p>}
      {!compact && <p className="ym-note">
        Click a legend label to hide or show that group; click its swatch to recolor it. Drag a bar to move it, or its ends to
        change its dates. Drag across empty days, or double-click one, to add an item. Settings save to this view.
      </p>}
    </div>
  );
}
