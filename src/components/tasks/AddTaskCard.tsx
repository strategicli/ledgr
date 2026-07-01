// The one task-add card, used everywhere a task is created (global capture, the
// per-day Add task in Upcoming, project cards) so the experience is consistent
// (Tyler, 2026-06-21 — Image #15). Title with live NL token highlighting +
// Description + an SVG chip row (Date · Priority · Assignee · …)
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
const IconFlag = <I d="M5 21V4" extra={<path d="M5 4h12l-2 4 2 4H5" />} />;
const IconDots = <I d="M5 12h.01M12 12h.01M19 12h.01" />;
const IconInbox = <I d="M4 13h4l1 3h6l1-3h4" extra={<path d="M4 13l2-7h12l2 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />} />;
const IconDescription = <I d="M4 7h16M4 12h16M4 17h10" />;
const IconCanvas = <I d="M4 14c2 0 2-6 4-6s2 8 4 8 2-10 4-10 2 6 4 6" />;
const IconChevron = <I d="M6 9l6 6 6-6" />;
const IconX = <I d="M6 6l12 12M18 6L6 18" />;
const IconRepeat = <I d="M17 2l4 4-4 4" extra={<><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>} />;
const IconHash = <I d="M4 9h16M4 15h15M10 3L8 21M16 3l-2 18" />;
const IconUser = <I d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" extra={<circle cx="12" cy="8" r="4" />} />;

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
  lockDestination = false,
  onDone,
  onCancel,
}: {
  defaultDueYmd?: string;
  // The item the task is added FROM (a project card, a note, …): the task
  // auto-associates with it instead of landing in the Inbox. role defaults to
  // "related" ("project" for a project host).
  host?: { id: string; label: string; role?: string };
  autoFocus?: boolean;
  // Destination is fixed to the host (e.g. a project's Tasks card): hide the
  // destination picker entirely and always file onto the host.
  lockDestination?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  // due/scheduled hold an explicit PICK only. The defaultDueYmd is a fallback
  // (used when nothing is typed or picked) so a typed date ("…Saturday") always
  // wins over it; dateCleared lets the ✕ suppress that fallback too.
  const [due, setDue] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [dateCleared, setDateCleared] = useState(false);
  const [urgency, setUrgency] = useState<Priority | null>(null);
  const [dest, setDest] = useState<string>(host?.id ?? "inbox");
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [people, setPeople] = useState<ProjectOpt[]>([]);
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
    fetch("/api/items?type=person&limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPeople(Array.isArray(d?.items) ? d.items : []))
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
  // @person-name → assign to a matching person (create-on-miss is a follow-up).
  const personMatch = useMemo(() => {
    const m = title.match(/@([\w-]+)/);
    if (!m) return null;
    const q = m[1].replace(/-/g, " ").toLowerCase();
    const person = people.find((pr) => (pr.title || "").toLowerCase().includes(q)) ?? null;
    return { token: m[0], person };
  }, [title, people]);
  const segments = useMemo(
    () => buildSegments(title, [
      ...(preview?.detections ?? []),
      ...(projectMatch ? [{ source: projectMatch.token }] : []),
      ...(personMatch ? [{ source: personMatch.token }] : []),
    ]),
    [title, preview, projectMatch, personMatch]
  );

  // Effective dates: an explicit pick wins, then what was parsed from the title,
  // then the host's default (suppressed once the user clears). This is the single
  // source of truth for both the chip label and what create() saves.
  const effDue = due || preview?.dueDate || "";
  const effScheduled = scheduled || preview?.scheduledDate || "";
  const effDefault = !effDue && !effScheduled && !dateCleared ? (defaultDueYmd ?? "") : "";
  const dateLabel = useMemo(() => {
    const ymd = effDue || effScheduled || effDefault;
    if (!ymd) return null;
    if (ymd === localTodayYmd()) return "Today";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }, [effDue, effScheduled, effDefault]);
  // Detected recurrence has no chip of its own; it folds into the Date chip
  // (Todoist-style: a date with a repeat icon). The chip text shows both.
  const recurrenceLabel = useMemo(
    () => preview?.detections.find((d) => d.field === "recurrence")?.label ?? null,
    [preview]
  );
  // The Date chip combines date + recurrence ("Today · Weekly"); falls back to either alone.
  const scheduleLabel = [dateLabel, recurrenceLabel].filter(Boolean).join(" · ") || null;
  // Priority shown reflects a manual pick first, otherwise what was parsed from the title.
  const effUrgency = (urgency ?? preview?.urgency ?? null) as Priority | null;
  const pStyle = effUrgency ? priorityStyle(effUrgency) : null;
  // A "#project" in the title drives the destination directly; otherwise the manual pick.
  const effDest = projectMatch?.project?.id ?? dest;

  async function create() {
    const raw = title.trim();
    if (!raw || busy) return;
    const p = parseTaskTitle(raw, localTodayYmd());
    const finalTitle = (p.title || raw).replace(/[#@][\w-]+/g, "").replace(/\s+/g, " ").trim();
    const destId = lockDestination && host ? host.id : (projectMatch?.project?.id ?? dest);
    const assigneeId = personMatch?.person?.id ?? null;
    const dueDay = effDue || effDefault;
    const sched = effScheduled;
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
      if (destId !== "inbox" || assigneeId) {
        const { item } = (await res.json()) as { item: { id: string } };
        const rel = (targetId: string, role: string) =>
          fetch(`/api/items/${item.id}/relations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetId, role }),
          }).catch(() => {});
        if (destId !== "inbox") await rel(destId, destId === host?.id ? host.role ?? "related" : "project");
        if (assigneeId) await rel(assigneeId, "assignee");
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
  const destProject = projects.find((p) => p.id === effDest);

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-lg shadow-black/40">
      {/* title + top-right toggles */}
      <div className="flex items-start gap-2">
        {/* The title wraps to multiple lines as it grows: a textarea overlays an
            in-flow mirror that holds the SAME wrapped text, so the mirror defines
            the height (the textarea fills it, no JS resize) and the highlight stays
            character-aligned. Both share identical typography + wrapping. */}
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none min-h-6 whitespace-pre-wrap break-words text-base font-medium leading-6 text-transparent">
            {segments.length === 0
              ? " "
              : segments.map((s, i) =>
                  // px adds the padding "around" the detected word; the matching -mx
                  // pulls layout back so the mirror stays aligned with the textarea
                  // (the bg just bleeds past the text). Kept to ~1.5px so two adjacent
                  // tokens ("Saturday" + "every week") leave a visible gap rather than
                  // merging. py rounds it into a pill.
                  s.hl ? <mark key={i} className="rounded px-[1.5px] py-0.5 -mx-[1.5px] bg-[var(--accent)]/35 text-transparent">{s.text}</mark> : <span key={i}>{s.text}</span>
                )}
          </div>
          <textarea
            autoFocus={autoFocus}
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            // Enter submits (no newlines in a title); Shift+Enter is ignored too.
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } if (e.key === "Escape") onCancel(); }}
            placeholder="Task name"
            aria-label="Task name"
            className="absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-base font-medium leading-6 text-neutral-100 outline-none placeholder:text-neutral-500"
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

      {/* SVG chip row — detected date/recurrence/priority/project fill these in */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3">
        {showAction("deadline") && (
          <span className="relative">
            <button type="button" className={`${chip} ${scheduleLabel ? "text-[var(--accent)]" : ""}`} onClick={() => setPickDate((v) => !v)}>
              {recurrenceLabel ? IconRepeat : IconCalendar} {scheduleLabel ?? "Date"}
              {scheduleLabel && (
                <span role="button" aria-label="Clear date" onClick={(e) => { e.stopPropagation(); setDue(""); setScheduled(""); setDateCleared(true); }} className="text-neutral-500 hover:text-neutral-200">{IconX}</span>
              )}
            </button>
            {pickDate && (
              <input
                type="date"
                value={due}
                autoFocus
                onChange={(e) => { setDue(e.target.value); setPickDate(false); setDateCleared(false); }}
                className="absolute left-0 top-full z-10 mt-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 [color-scheme:dark]"
              />
            )}
          </span>
        )}
        {showAction("priority") && (
          <span className="relative inline-flex items-center">
            <select
              value={effUrgency ?? ""}
              onChange={(e) => setUrgency(e.target.value ? (Number(e.target.value) as Priority) : null)}
              aria-label="Priority"
              // Text + border take the priority color (P2 gold, P3 purple…); the
              // neutral defaults are only applied when no priority is set, so they
              // never fight the colored classes (Tailwind has no order guarantee).
              className={`flex appearance-none items-center gap-1.5 rounded-md border py-1 pl-2 pr-7 text-sm ${pStyle ? `${pStyle.text} ${pStyle.border}` : "border-neutral-700 text-neutral-300 hover:border-neutral-600"}`}
            >
              <option value="">Priority</option>
              {[1, 2, 3, 4, 5, 6].map((u) => <option key={u} value={u}>P{u}</option>)}
            </select>
            <span className={`pointer-events-none absolute right-1.5 ${pStyle ? pStyle.text : "text-neutral-500"}`}>{IconFlag}</span>
          </span>
        )}
        {showAction("assignee") && (
          <span className={`${chip} ${personMatch?.person ? "text-[var(--accent)]" : ""}`} title={personMatch?.person ? `Assigned to ${personMatch.person.title}` : "Type @name to assign"}>
            {IconUser} {personMatch?.person?.title ?? "Assignee"}
          </span>
        )}
        <button type="button" className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-400 hover:border-neutral-600" title="More" aria-label="More">{IconDots}</button>
      </div>

      {/* footer: destination + actions. When the destination is locked to the
          host (a project's Tasks card), the picker is hidden and the actions get
          the full row. */}
      <div className={`mt-3 flex items-center gap-2 ${lockDestination ? "justify-end" : "justify-between"}`}>
        {!lockDestination && (
          <span className="relative inline-flex items-center text-sm text-neutral-300">
            <span className="pointer-events-none absolute left-1.5 text-neutral-500">{destProject ? IconHash : IconInbox}</span>
            <select
              value={effDest}
              onChange={(e) => setDest(e.target.value)}
              disabled={!!projectMatch?.project}
              aria-label="Destination"
              className="appearance-none rounded-md bg-transparent py-1 pl-7 pr-5 text-sm text-neutral-300 outline-none disabled:opacity-100"
            >
              {host && host.role !== "project" && <option value={host.id}>{host.label}</option>}
              <option value="inbox">Inbox</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title || "Untitled project"}</option>)}
            </select>
            <span className="pointer-events-none absolute right-0 text-neutral-500">{IconChevron}</span>
          </span>
        )}
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
