// The one task-add card, used everywhere a task is created (global capture, the
// per-day Add task in Upcoming, project cards) so the experience is consistent
// (Tyler, 2026-06-21 — Image #15). Title with live NL token highlighting +
// Description + an SVG chip row (Date · Attachment · Priority · Reminders · …)
// gated by the Quick Add config (settings.quickAddHidden) + a destination picker
// (Inbox / a project) + Cancel / Add task. Inline (in a list) or inside the
// capture modal — same component.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTaskTitle } from "@/lib/nl-date";
import { priorityStyle, type Priority } from "@/lib/priority";
import { enqueueCapture } from "@/lib/outbox";

function localTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- inline title highlighting (shared shape with the old capture) ---
type Seg = { text: string; hl?: boolean };
function buildSegments(title: string, detections: { source: string }[]): Seg[] {
  if (!title) return [];
  const lower = title.toLowerCase();
  const ranges: [number, number][] = [];
  for (const d of detections) {
    const src = d.source?.trim();
    if (!src) continue;
    const idx = lower.indexOf(src.toLowerCase());
    if (idx >= 0) ranges.push([idx, idx + src.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segs: Seg[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos) continue;
    if (start > pos) segs.push({ text: title.slice(pos, start) });
    segs.push({ text: title.slice(start, end), hl: true });
    pos = end;
  }
  if (pos < title.length) segs.push({ text: title.slice(pos) });
  return segs;
}

// --- inline SVG icons (16px, currentColor) ---
function I({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
      {extra}
    </svg>
  );
}
const IconCalendar = <I d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" extra={<><path d="M4 9h16" /><path d="M8 3v3M16 3v3" /></>} />;
const IconPaperclip = <I d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />;
const IconFlag = <I d="M5 21V4" extra={<path d="M5 4h12l-2 4 2 4H5" />} />;
const IconAlarm = <I d="M12 9v4l2 2" extra={<><circle cx="12" cy="13" r="7" /><path d="M5 3L2 6M19 3l3 3" /></>} />;
const IconDots = <I d="M5 12h.01M12 12h.01M19 12h.01" />;
const IconInbox = <I d="M4 13h4l1 3h6l1-3h4" extra={<path d="M4 13l2-7h12l2 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />} />;
const IconDescription = <I d="M4 7h16M4 12h16M4 17h10" />;
const IconCanvas = <I d="M4 14c2 0 2-6 4-6s2 8 4 8 2-10 4-10 2 6 4 6" />;
const IconChevron = <I d="M6 9l6 6 6-6" />;
const IconX = <I d="M6 6l12 12M18 6L6 18" />;
const IconRepeat = <I d="M17 2l4 4-4 4" extra={<><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>} />;
const IconHash = <I d="M4 9h16M4 15h15M10 3L8 21M16 3l-2 18" />;

let quickAddPromise: Promise<string[]> | null = null;
function loadQuickAddHidden(): Promise<string[]> {
  quickAddPromise ??= fetch("/api/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (Array.isArray(d?.settings?.quickAddHidden) ? (d.settings.quickAddHidden as string[]) : []))
    .catch(() => []);
  return quickAddPromise;
}

type ProjectOpt = { id: string; title: string };

export default function AddTaskCard({
  defaultDueYmd,
  host,
  autoFocus = true,
  onDone,
  onCancel,
}: {
  defaultDueYmd?: string;
  // The item the task is added FROM (a project card, a note, …): the task
  // auto-associates with it instead of landing in the Inbox. role defaults to
  // "related" ("project" for a project host).
  host?: { id: string; label: string; role?: string };
  autoFocus?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const [due, setDue] = useState(defaultDueYmd ?? "");
  const [scheduled, setScheduled] = useState("");
  const [urgency, setUrgency] = useState<Priority | null>(null);
  const [dest, setDest] = useState<string>(host?.id ?? "inbox");
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [qaHidden, setQaHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pickDate, setPickDate] = useState(false);
  const showAction = (id: string) => !qaHidden.has(id);

  useEffect(() => {
    loadQuickAddHidden().then((ids) => setQaHidden(new Set(ids)));
    fetch("/api/items?type=project&limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProjects(Array.isArray(d?.items) ? d.items : []))
      .catch(() => {});
  }, []);

  const preview = useMemo(() => (title.trim() ? parseTaskTitle(title, localTodayYmd()) : null), [title]);
  // #project-name → attach to a matching project (create-on-miss is a follow-up).
  const projectMatch = useMemo(() => {
    const m = title.match(/#([\w-]+)/);
    if (!m) return null;
    const q = m[1].replace(/-/g, " ").toLowerCase();
    const project = projects.find((pr) => (pr.title || "").toLowerCase().includes(q)) ?? null;
    return { token: m[0], project };
  }, [title, projects]);
  const segments = useMemo(
    () => buildSegments(title, [...(preview?.detections ?? []), ...(projectMatch ? [{ source: projectMatch.token }] : [])]),
    [title, preview, projectMatch]
  );

  const dateLabel = useMemo(() => {
    const ymd = due || preview?.dueDate || scheduled || preview?.scheduledDate || "";
    if (!ymd) return null;
    if (ymd === localTodayYmd()) return "Today";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }, [due, scheduled, preview]);

  async function create() {
    const raw = title.trim();
    if (!raw || busy) return;
    const p = parseTaskTitle(raw, localTodayYmd());
    const finalTitle = (p.title || raw).replace(/#[\w-]+/g, "").replace(/\s+/g, " ").trim();
    const destId = projectMatch?.project?.id ?? dest;
    const dueDay = due || p.dueDate || "";
    const sched = scheduled || p.scheduledDate || "";
    const urg = urgency ?? p.urgency ?? null;
    const rec = p.recurrence ?? null;
    setBusy(true);
    const body: Record<string, unknown> = { type: "task", title: finalTitle };
    if (destId === "inbox") body.inbox = true;
    if (dueDay) body.dueDate = `${dueDay}T00:00:00.000Z`;
    if (sched) body.scheduledDate = `${sched}T00:00:00.000Z`;
    if (urg != null) body.urgency = urg;
    const props: Record<string, unknown> = {};
    if (rec) props.recurrence = rec;
    if (Object.keys(props).length) body.properties = props;
    if (description.trim()) body.body = { format: "markdown", text: description.trim() };
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (destId !== "inbox") {
        const { item } = (await res.json()) as { item: { id: string } };
        const role = destId === host?.id ? host.role ?? "related" : "project";
        await fetch(`/api/items/${item.id}/relations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: destId, role }),
        }).catch(() => {});
      }
      router.refresh();
      onDone();
    } catch {
      enqueueCapture(body);
      window.dispatchEvent(new Event("ledgr:outbox"));
      onDone();
    }
  }

  const chip = "flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-sm text-neutral-300 hover:border-neutral-600";
  const destProject = projects.find((p) => p.id === dest);

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-lg shadow-black/40">
      {/* title + top-right toggles */}
      <div className="flex items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-base font-medium text-transparent">
            {segments.map((s, i) =>
              s.hl ? <mark key={i} className="rounded bg-[var(--accent)]/35 text-transparent">{s.text}</mark> : <span key={i}>{s.text}</span>
            )}
          </div>
          <input
            autoFocus={autoFocus}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") onCancel(); }}
            placeholder="Task name"
            aria-label="Task name"
            className="relative w-full bg-transparent text-base font-medium text-neutral-100 outline-none placeholder:text-neutral-500"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 text-neutral-500">
          <button type="button" title="Toggle description" aria-label="Toggle description" onClick={() => setShowDesc((v) => !v)} className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-300">{IconDescription}</button>
          <button type="button" title="Rich editor" aria-label="Rich editor" className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-300">{IconCanvas}</button>
        </div>
      </div>

      {(showDesc || description) && (
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          aria-label="Description"
          className="mt-1 w-full bg-transparent text-sm text-neutral-300 outline-none placeholder:text-neutral-600"
        />
      )}

      {/* detected preview */}
      {((preview && preview.detections.length > 0) || projectMatch?.project) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span>Detected</span>
          {preview?.detections.map((d, i) => {
            if (d.field === "urgency") {
              const n = Number(d.label.replace(/\D/g, "")) as Priority;
              const st = priorityStyle(n);
              return <span key={i} className={`rounded border px-1.5 py-0.5 ${st.text} ${st.border}`}>{d.label}</span>;
            }
            return (
              <span key={i} className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-1.5 py-0.5 text-neutral-300">
                {d.field === "recurrence" ? IconRepeat : IconCalendar}
                {d.label}
              </span>
            );
          })}
          {projectMatch?.project && (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-1.5 py-0.5 text-neutral-300">
              {IconHash}
              {projectMatch.project.title || "Project"}
            </span>
          )}
          <span className="text-neutral-600">→ “{(preview?.title || title).replace(/#[\w-]+/g, "").trim() || "…"}”</span>
        </div>
      )}

      {/* SVG chip row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3">
        {showAction("deadline") && (
          <span className="relative">
            <button type="button" className={`${chip} ${dateLabel ? "text-[var(--accent)]" : ""}`} onClick={() => setPickDate((v) => !v)}>
              {IconCalendar} {dateLabel ?? "Date"}
              {dateLabel && (
                <span role="button" aria-label="Clear date" onClick={(e) => { e.stopPropagation(); setDue(""); setScheduled(""); }} className="text-neutral-500 hover:text-neutral-200">{IconX}</span>
              )}
            </button>
            {pickDate && (
              <input
                type="date"
                value={due}
                autoFocus
                onChange={(e) => { setDue(e.target.value); setPickDate(false); }}
                className="absolute left-0 top-full z-10 mt-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 [color-scheme:dark]"
              />
            )}
          </span>
        )}
        <button type="button" className={chip} title="Attachment">{IconPaperclip} Attachment</button>
        {showAction("priority") && (
          <span className="relative inline-flex items-center">
            <select
              value={urgency ?? ""}
              onChange={(e) => setUrgency(e.target.value ? (Number(e.target.value) as Priority) : null)}
              aria-label="Priority"
              className={`${chip} appearance-none pr-6 ${urgency ? priorityStyle(urgency).text : ""}`}
            >
              <option value="">Priority</option>
              {[1, 2, 3, 4, 5, 6].map((u) => <option key={u} value={u}>P{u}</option>)}
            </select>
            <span className="pointer-events-none absolute right-1 text-neutral-500">{IconFlag}</span>
          </span>
        )}
        <button type="button" className={chip} title="Reminders">{IconAlarm} Reminders</button>
        <button type="button" className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-400 hover:border-neutral-600" title="More" aria-label="More">{IconDots}</button>
      </div>

      {/* footer: destination + actions */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="relative inline-flex items-center text-sm text-neutral-300">
          <span className="pointer-events-none absolute left-1.5 text-neutral-500">{destProject ? null : IconInbox}</span>
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            aria-label="Destination"
            className={`appearance-none rounded-md bg-transparent py-1 pr-5 text-sm text-neutral-300 outline-none ${destProject ? "pl-1.5" : "pl-7"}`}
          >
            {host && host.role !== "project" && <option value={host.id}>{host.label}</option>}
            <option value="inbox">Inbox</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title || "Untitled project"}</option>)}
          </select>
          <span className="pointer-events-none absolute right-0 text-neutral-500">{IconChevron}</span>
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">Cancel</button>
          <button type="button" disabled={!title.trim() || busy} onClick={() => void create()} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40">
            {busy ? "Adding…" : "Add task"}
          </button>
        </div>
      </div>
    </div>
  );
}
