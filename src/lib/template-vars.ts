// Template variable resolution (ADR-093, TPL3): the pure resolver that turns
// {{tokens}} in a template's titles and bodies into concrete text at apply time.
// PURE + client-safe (no db, no Date.now — the caller passes today/now), so the
// apply path and a UI preview share one implementation and it's node-testable.
//
// Supported tokens (case-insensitive base):
//   {{today}} {{tomorrow}} {{yesterday}}        — calendar dates
//   {{today+7d}} {{today-3d}} {{today+2w}} {{today+1m}} {{today+1y}}
//   {{nextSunday}} … {{nextSaturday}}           — next week's weekday
//   {{sunday}} … {{saturday}}                   — this coming weekday (incl. today)
//   {{now}}                                     — date + time (needs ctx.now)
//   {{title}}                                   — the applied item's (resolved) title
//   {{ask:Label}}                               — a value collected on apply
// Optional :format on any date token — {{today:iso}}, {{nextSunday:long}}, …
//   (default) "Jun 20, 2026"   iso "2026-06-20"   long "June 20, 2026"
//   short "Jun 20"   day "Friday"   us "6/20/2026"
// An unrecognized token is left untouched (so stray braces never get mangled).
import { addDaysYmd, addMonthsYmd, isYmd, weekdayOf } from "@/lib/recurrence";
import { parseNaturalDate } from "@/lib/nl-date";

export type VarContext = {
  // App-timezone "today" as YYYY-MM-DD (the caller computes it; keeps this pure).
  todayYmd: string;
  // For {{now}}'s time component; omit for date-only contexts (a UI preview).
  now?: Date;
  // Timezone for {{now}} formatting (default UTC). The server passes APP_TIMEZONE.
  timeZone?: string;
  // The resolved root title, for {{title}} echo in bodies/descendants.
  title?: string;
  // {{ask:Label}} answers collected on apply.
  answers?: Record<string, string>;
};

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const FULL_WEEKDAY: Record<string, string> = {
  SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday",
  TH: "Thursday", FR: "Friday", SA: "Saturday",
};
const WEEKDAY_WORDS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

// Format a YYYY-MM-DD calendar day. Pure string math (no Date), so a date never
// shifts across a timezone when formatted.
function formatYmd(ymd: string, fmt: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  switch (fmt.toLowerCase()) {
    case "iso":
      return ymd;
    case "short":
      return `${MONTH_ABBR[m - 1]} ${d}`;
    case "long":
      return `${MONTH_FULL[m - 1]} ${d}, ${y}`;
    case "us":
      return `${m}/${d}/${y}`;
    case "day":
      return FULL_WEEKDAY[weekdayOf(ymd)];
    case "":
    default:
      return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
  }
}

// Resolve a date base token (no offset, no format) to a YYYY-MM-DD, or null if
// the word isn't a date base.
function resolveDateBase(base: string, ctx: VarContext): string | null {
  const b = base.toLowerCase();
  if (b === "today") return ctx.todayYmd;
  if (b === "tomorrow") return addDaysYmd(ctx.todayYmd, 1);
  if (b === "yesterday") return addDaysYmd(ctx.todayYmd, -1);
  // next<weekday> → next week's; bare <weekday> → this coming (incl. today).
  const next = b.startsWith("next") ? b.slice(4) : null;
  if (next && WEEKDAY_WORDS.includes(next)) {
    return parseNaturalDate(`next ${next}`, ctx.todayYmd);
  }
  if (WEEKDAY_WORDS.includes(b)) {
    return parseNaturalDate(b, ctx.todayYmd);
  }
  return null;
}

function applyOffset(ymd: string, offset: string): string | null {
  const m = offset.match(/^([+-]\d+)([dwmy])$/);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "d": return addDaysYmd(ymd, n);
    case "w": return addDaysYmd(ymd, n * 7);
    case "m": return addMonthsYmd(ymd, n);
    case "y": return addMonthsYmd(ymd, n * 12);
  }
  return null;
}

function formatNow(ctx: VarContext, fmt: string): string {
  // Date-only formats reuse the YMD formatter against today.
  if (fmt && fmt.toLowerCase() !== "time") return formatYmd(ctx.todayYmd, fmt);
  if (!ctx.now) {
    // No instant supplied (e.g. a client preview): fall back to today's date.
    return formatYmd(ctx.todayYmd, "");
  }
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ctx.timeZone || "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(ctx.now);
  if (fmt.toLowerCase() === "time") return time;
  return `${formatYmd(ctx.todayYmd, "")}, ${time}`;
}

// Resolve one token's inner text to its replacement, or null to leave it as-is.
function resolveOne(inner: string, ctx: VarContext): string | null {
  const trimmed = inner.trim();
  if (/^ask\s*:/i.test(trimmed)) {
    const label = trimmed.replace(/^ask\s*:/i, "").trim();
    return ctx.answers?.[label] ?? "";
  }
  const colon = trimmed.indexOf(":");
  const expr = (colon >= 0 ? trimmed.slice(0, colon) : trimmed).trim();
  const fmt = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";
  const lower = expr.toLowerCase();
  if (lower === "title") return ctx.title ?? "";
  if (lower === "now") return formatNow(ctx, fmt);

  const m = expr.match(/^([a-zA-Z]+)([+-]\d+[dwmy])?$/);
  if (!m) return null;
  let ymd = resolveDateBase(m[1], ctx);
  if (ymd == null) return null;
  if (m[2]) {
    ymd = applyOffset(ymd, m[2]);
    if (ymd == null) return null;
  }
  return formatYmd(ymd, fmt);
}

// Replace every recognized {{token}} in `text`. Unknown tokens are left intact.
export function resolveVars(text: string, ctx: VarContext): string {
  if (!text || !isYmd(ctx.todayYmd)) return text;
  return text.replace(TOKEN_RE, (full, inner: string) => {
    const r = resolveOne(inner, ctx);
    return r === null ? full : r;
  });
}

// The distinct {{ask:Label}} labels across a set of texts (titles + bodies),
// in first-seen order — drives the apply-time prompt form. Duplicate labels
// collapse to one prompt (the answer fills every occurrence).
export function scanAskLabels(texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(TOKEN_RE)) {
      const inner = m[1].trim();
      if (/^ask\s*:/i.test(inner)) {
        const label = inner.replace(/^ask\s*:/i, "").trim();
        if (label && !seen.has(label)) {
          seen.add(label);
          out.push(label);
        }
      }
    }
  }
  return out;
}

// ===========================================================================
// Structured date rules (ADR-093, TPL3b): how an applied item's due / scheduled
// dates are set. The clone clears the prototype's own dated fields, so these
// rules are the source of an applied item's dates. PURE: the caller passes today.
//   none   — leave the field empty (the clone default)
//   fixed  — an absolute calendar day (e.g. always due Dec 25)
//   offset — apply date ± N days (0 = the apply day itself); relative subtasks
//            then recompute off the root's scheduled day (ADR-085)
export type DateRule =
  | { mode: "none" }
  | { mode: "fixed"; date: string } // YYYY-MM-DD
  | { mode: "offset"; days: number };

export type ApplyConfig = {
  dueDate?: DateRule;
  scheduledDate?: DateRule;
};

// Resolve a rule to a YYYY-MM-DD calendar day, or null (none / invalid).
export function resolveDateRule(
  rule: DateRule | undefined,
  todayYmd: string
): string | null {
  if (!rule || !isYmd(todayYmd)) return null;
  if (rule.mode === "fixed") return isYmd(rule.date) ? rule.date : null;
  if (rule.mode === "offset") {
    return Number.isInteger(rule.days) ? addDaysYmd(todayYmd, rule.days) : null;
  }
  return null; // none
}

// Tolerant parse of a stored/posted rule → a valid DateRule or null (dropped).
export function parseDateRule(raw: unknown): DateRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.mode === "none") return { mode: "none" };
  if (r.mode === "fixed" && typeof r.date === "string" && isYmd(r.date)) {
    return { mode: "fixed", date: r.date };
  }
  if (r.mode === "offset" && typeof r.days === "number" && Number.isInteger(r.days)) {
    return { mode: "offset", days: r.days };
  }
  return null;
}

// Tolerant parse of the whole apply_config jsonb. Unknown keys dropped; a "none"
// rule is kept (an explicit "leave empty") but is a no-op at apply.
export function parseApplyConfig(raw: unknown): ApplyConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: ApplyConfig = {};
  const due = parseDateRule(r.dueDate);
  const scheduled = parseDateRule(r.scheduledDate);
  if (due) out.dueDate = due;
  if (scheduled) out.scheduledDate = scheduled;
  return out;
}

// True if `text` contains any recognized template token (date/now/title/ask) —
// used to decide whether resolution needs to run at all.
export function hasVars(text: string | null | undefined): boolean {
  if (!text) return false;
  TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (resolveOne(m[1], { todayYmd: "2000-01-01" }) !== null || /^ask\s*:/i.test(m[1].trim())) {
      return true;
    }
  }
  return false;
}
