// Live item tokens (ADR-live-item-tokens / LT1): {{item.*}}, {{parent.*}},
// {{item.children}} tokens that live in the canonical markdown body and resolve
// from the item's CURRENT state at every render (print, Save Offline, share,
// export, live Preview) — NOT baked once like template apply-time {{today}}
// vars (template-vars.ts). The body stores the token; the value is derived, so
// renaming the item or moving a date keeps every rendered copy right and the
// author never edits the same fact twice.
//
// PURE + client-safe (no db, no Date): the caller (item-tokens-service.ts on the
// server) loads the item + parent + children + relations and hands this resolver
// a plain context, so the same code can back a client preview later and it is
// node-testable. Related/children entries emit the mention-link markdown
// [@Title](ledgr://item/<id>) so the existing render pipeline links + flattens
// them for free (markdown-render.ts).
//
// Supported tokens (case-insensitive base, unknown tokens left untouched):
//   {{item.title}} {{item.status}} {{item.type}} {{item.url}} {{item.priority}}
//   {{item.due}} {{item.scheduled}} {{item.created}} {{item.meeting}}   — dates
//   {{item.due+7d}} {{item.scheduled-2d:long}}                          — date math + format
//   {{item.props.<key>}}   {{item.props.<key>:long}}                    — a custom property
//   {{item.related.<roleOrType>}}   {{item.children}}                   — item lists
//   {{item.children:ul}}  {{item.related.person:ol}}                    — list formats
//   {{parent.title}} {{parent.due:long}} …                             — the parent's fields
//   {{now}} {{now.today}} {{now.tomorrow}} {{now.yesterday}}            — LIVE dates
//   {{now.today+7d}} {{now.today-1w}} {{now.nextweek}}                  — live date math
//   {{now.sunday}} … {{now.saturday}}  {{now.nextfriday}}              — live weekdays
// Date format suffixes match template-vars: iso/long/short/us/day, default
// "Jun 20, 2026". A \{{…}} (backslash-escaped) renders literally.
//
// The {{now.*}} family (LT-live-time) is a SEPARATE vocabulary from template
// apply-time vars (template-vars.ts): {{today}}/{{tomorrow}}/… there BAKE ONCE
// when a template is applied; {{now}}/{{now.*}} here RE-RESOLVE against the
// owner's timezone-aware "today" (ctx.todayYmd) at EVERY render. The live
// resolver never touches the bare {{today}} vocabulary, so apply-time baking is
// untouched. Both read ctx.todayYmd — never Date.now() — so a date never shifts
// across a timezone.
import { addDaysYmd, addMonthsYmd, isYmd, weekdayOf } from "@/lib/recurrence";
import { parseNaturalDate } from "@/lib/nl-date";
import { mentionToMarkdown } from "@/lib/editor/mention-markdown";

// A referenced item (child or related): id + current title, for a mention link.
export type TokenRef = { id: string; title: string };

// The calendar-day fields (YYYY-MM-DD in app tz; the service converts the
// stored timestamps). Absent/null means "unset" → renders empty.
export type TokenDateFields = {
  due?: string | null;
  scheduled?: string | null;
  created?: string | null;
  meeting?: string | null;
};

// One item's scalar fields for {{item.*}} / {{parent.*}}.
export type TokenItemFields = {
  title?: string;
  status?: string;
  type?: string;
  url?: string;
  priority?: string; // "P1".."P6" or "" (none)
  dates?: TokenDateFields;
  // Custom property display strings, keyed by property schema key.
  props?: Record<string, string>;
};

export type ItemTokenContext = {
  // App-timezone "today" as YYYY-MM-DD (the caller computes it; keeps this pure).
  todayYmd: string;
  self?: TokenItemFields;
  parent?: TokenItemFields;
  // Child items (subtasks), in authoring order.
  children?: TokenRef[];
  // Related items keyed by BOTH role (assignee, attendee, …) and target type
  // (person, task, …), lowercased, so {{item.related.person}} and
  // {{item.related.assignee}} both resolve.
  related?: Record<string, TokenRef[]>;
};

// Matches an optional escaping backslash, then a {{ token }}. The backslash lets
// an author write a literal token in prose.
const TOKEN_RE = /(\\?)\{\{\s*([^}]+?)\s*\}\}/g;
// A whole line that is nothing but one list-format token (ul/ol) — this is the
// only place a list token expands to real block-level markdown. Anywhere else it
// falls back to a comma-joined inline list (a bulleted list can't sit mid-line).
const BLOCK_LIST_LINE_RE =
  /^(\s*)(\\?)\{\{\s*(?:item\.children|item\.related\.[a-z0-9_]+|parent\.children|attendees|absentees|groups?)\s*:\s*(ul|ol)\s*\}\}\s*$/i;

// Meeting-friendly aliases (ADR-144 Phase 3): plain-language shorthands for the
// attendance relation roles the event People card writes, so a meeting-note
// template can say {{attendees}} instead of {{item.related.attending}}. Resolved
// LIVE like any related token — always the current roster, never a stale
// snapshot (notes are usually templated before attendance is marked, and the
// People card is the source of truth). Normalized once in splitExpr, so every
// recognition + resolution path picks them up. Keys are lowercased bases.
const TOKEN_ALIASES: Record<string, string> = {
  attendees: "item.related.attending",
  absentees: "item.related.absent",
  group: "item.related.group",
  groups: "item.related.group",
};

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

// Format a YYYY-MM-DD calendar day. Pure string math (no Date), so a date never
// shifts across a timezone. Mirrors template-vars.formatYmd.
function formatYmd(ymd: string, fmt: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  switch (fmt.toLowerCase()) {
    case "iso": return ymd;
    case "short": return `${MONTH_ABBR[m - 1]} ${d}`;
    case "long": return `${MONTH_FULL[m - 1]} ${d}, ${y}`;
    case "us": return `${m}/${d}/${y}`;
    case "day": return FULL_WEEKDAY[weekdayOf(ymd)];
    case "":
    default: return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
  }
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

// Resolve a live {{now.<base>}} word to a YYYY-MM-DD against `todayYmd`, or null
// when the word isn't a recognized "now" base (so an unknown now.* token is left
// raw). Weekday words defer to the shared NL date parser (same semantics as the
// apply-time weekday vars): a bare weekday is the coming one (incl. today),
// "next<weekday>" jumps to next week's.
function resolveNowBase(sub: string, todayYmd: string): string | null {
  const b = sub.trim().toLowerCase();
  if (b === "" || b === "today") return todayYmd;
  if (b === "tomorrow") return addDaysYmd(todayYmd, 1);
  if (b === "yesterday") return addDaysYmd(todayYmd, -1);
  if (b === "nextweek") return addDaysYmd(todayYmd, 7);
  const next = b.startsWith("next") ? b.slice(4) : null;
  return parseNaturalDate(next ? `next ${next}` : b, todayYmd);
}

// Split "expr±Nd:fmt" into { base, offset, fmt }. base keeps its dots, and a
// meeting alias (attendees/absentees/group) is normalized to its canonical
// related base here, so every downstream path (refsFor, recognition) is alias-
// aware for free.
function splitExpr(inner: string): { base: string; offset: string; fmt: string } {
  const colon = inner.indexOf(":");
  const head = (colon >= 0 ? inner.slice(0, colon) : inner).trim();
  const fmt = colon >= 0 ? inner.slice(colon + 1).trim() : "";
  const m = head.match(/^(.*?)([+-]\d+[dwmy])?$/);
  const rawBase = (m?.[1] ?? head).trim();
  const base = TOKEN_ALIASES[rawBase.toLowerCase()] ?? rawBase;
  return { base, offset: m?.[2] ?? "", fmt };
}

// A date-valued field → the formatted string (with optional offset), or "" when
// unset. Returns null when the raw value isn't a calendar day (so a non-date
// prop still renders as plain text).
function renderDate(
  ymd: string | null | undefined,
  offset: string,
  fmt: string
): string | null {
  if (ymd == null || ymd === "") return "";
  if (!isYmd(ymd)) return null;
  let out = ymd;
  if (offset) {
    const shifted = applyOffset(out, offset);
    if (shifted == null) return null;
    out = shifted;
  }
  return formatYmd(out, fmt);
}

// Render one item's scalar field (title/status/type/url/priority/date). Returns
// null if `field` isn't a known scalar (caller then tries lists / leaves raw).
function renderItemField(
  fields: TokenItemFields | undefined,
  field: string,
  offset: string,
  fmt: string
): string | null {
  const f = field.toLowerCase();
  const dates = fields?.dates;
  switch (f) {
    case "title": return fields?.title ?? "";
    case "status": return fields?.status ?? "";
    case "type": return fields?.type ?? "";
    case "url": return fields?.url ?? "";
    case "priority": return fields?.priority ?? "";
    case "due": return renderDate(dates?.due, offset, fmt);
    case "scheduled": return renderDate(dates?.scheduled, offset, fmt);
    case "created": return renderDate(dates?.created, offset, fmt);
    case "meeting": return renderDate(dates?.meeting, offset, fmt);
  }
  // item.props.<key>
  if (f.startsWith("props.")) {
    const key = field.slice("props.".length); // preserve key case
    const raw = fields?.props?.[key];
    if (raw == null) return "";
    // If the property value looks like a calendar day, honor offset/format;
    // otherwise it's plain text (offset/format ignored).
    const asDate = renderDate(raw, offset, fmt);
    return asDate == null ? raw : asDate;
  }
  return null;
}

// Render a list of refs as inline (comma) or block (ul/ol) mention-link markdown.
function renderRefList(refs: TokenRef[], listFmt: string, indent: string): string {
  if (refs.length === 0) return "";
  const links = refs.map((r) => mentionToMarkdown(r.id, r.title));
  const lf = listFmt.toLowerCase();
  if (lf === "ul") return links.map((l) => `${indent}- ${l}`).join("\n");
  if (lf === "ol") return links.map((l, i) => `${indent}${i + 1}. ${l}`).join("\n");
  return links.join(", ");
}

// Resolve a list-valued token (item.children / item.related.<key> / parent.*)
// to its refs, or null if the base isn't a list token.
function refsFor(base: string, ctx: ItemTokenContext): TokenRef[] | null {
  const b = base.toLowerCase();
  if (b === "item.children") return ctx.children ?? [];
  if (b === "parent.children") return null; // parent's children not loaded (v1)
  if (b.startsWith("item.related.")) {
    const key = b.slice("item.related.".length);
    return ctx.related?.[key] ?? [];
  }
  return null;
}

// Resolve one token's inner text to its replacement, or null to leave it raw.
// This is the INLINE path only: a list token here always renders comma-joined
// (a real bulleted/numbered list can't sit mid-line — the block-line path in
// resolveItemTokens is the only place :ul/:ol expands).
function resolveOne(inner: string, ctx: ItemTokenContext): string | null {
  const { base, offset, fmt } = splitExpr(inner);
  const lower = base.toLowerCase();

  // Lists first (item.children, item.related.*), always inline/comma here.
  const refs = refsFor(base, ctx);
  if (refs !== null) return renderRefList(refs, "", "");

  // Live time tokens ({{now}}, {{now.today+7d}}, {{now.friday}}) — always the
  // owner's current app-tz day, re-resolved every render (never baked).
  if (lower === "now" || lower.startsWith("now.")) {
    const ymd = resolveNowBase(lower === "now" ? "" : lower.slice("now.".length), ctx.todayYmd);
    if (ymd == null) return null;
    const shifted = offset ? applyOffset(ymd, offset) : ymd;
    if (shifted == null) return null;
    return formatYmd(shifted, fmt);
  }

  // Scalar fields on the item or its parent.
  if (lower.startsWith("item.")) {
    return renderItemField(ctx.self, base.slice("item.".length), offset, fmt);
  }
  if (lower.startsWith("parent.")) {
    return renderItemField(ctx.parent, base.slice("parent.".length), offset, fmt);
  }
  return null;
}

// Replace every recognized live token in `text` against the item's current
// state. A line that is exactly a `:ul`/`:ol` list token expands to a real
// bulleted/numbered list; every other occurrence resolves inline (list tokens
// there fall back to a comma-joined list). Unknown tokens are left intact so a
// stray `{{...}}` or an apply-time template var passes through untouched.
export function resolveItemTokens(text: string, ctx: ItemTokenContext): string {
  if (!text || !isYmd(ctx.todayYmd)) return text;
  return text
    .split("\n")
    .map((line) => {
      const block = BLOCK_LIST_LINE_RE.exec(line);
      if (block) {
        const [, indent, esc, listFmt] = block;
        if (esc) return line.replace(/\\(\{\{)/, "$1"); // escaped → literal
        // Re-extract the inner base for this block token.
        const innerMatch = line.match(/\{\{\s*([^}]+?)\s*\}\}/);
        const base = innerMatch ? splitExpr(innerMatch[1]).base : "";
        const refs = refsFor(base, ctx);
        if (refs === null) return line;
        return renderRefList(refs, listFmt, indent);
      }
      return line.replace(TOKEN_RE, (full, esc: string, expr: string) => {
        if (esc) return full.slice(1); // drop the backslash, keep {{…}} literal
        const r = resolveOne(expr, ctx);
        return r === null ? full : r;
      });
    })
    .join("\n");
}

// True if `text` contains any recognized live token — lets a caller skip
// building a (DB-backed) context when there's nothing to resolve.
export function hasItemTokens(text: string | null | undefined): boolean {
  if (!text) return false;
  TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) continue; // escaped
    if (isLiveBase(splitExpr(m[2]).base.toLowerCase())) return true;
  }
  return false;
}

// True if a lowercased token base names a recognized live token: an item./parent.
// scalar/date/prop/list, or a {{now.*}} live-time base. The one predicate every
// recognition path shares (resolver gate, editor decoration, scans).
function isLiveBase(lower: string): boolean {
  return (
    lower === "item.children" ||
    lower.startsWith("item.related.") ||
    lower.startsWith("item.") ||
    lower.startsWith("parent.") ||
    lower === "now" ||
    lower.startsWith("now.")
  );
}

// Whether an inner token expression names a recognized live token (item./parent.
// scalar, date, prop, list, or a {{now.*}} live-time token). Shared by the scan
// helpers and the LT2 editor.
export function isLiveTokenExpr(inner: string): boolean {
  return isLiveBase(splitExpr(inner).base.toLowerCase());
}

// Character ranges of every recognized live token in `text` (LT2 editor
// decoration highlighting). Escaped tokens are skipped. `expr` is the inner
// token text (trimmed); [start,end) spans the whole `{{…}}`.
export function findItemTokenRanges(
  text: string
): { start: number; end: number; expr: string }[] {
  const out: { start: number; end: number; expr: string }[] = [];
  if (!text) return out;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) continue; // escaped: m[1] is the backslash, m.index points at it
    if (!isLiveTokenExpr(m[2])) continue;
    const start = m.index ?? 0; // no escape here, so the match starts at "{{"
    out.push({ start, end: start + m[0].length, expr: m[2].trim() });
  }
  return out;
}

// Distinct live-token inner expressions in `text`, first-seen order (drives LT2
// insert UI / validation). Escaped tokens are skipped.
export function scanItemTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1]) continue;
    const inner = m[2].trim();
    if (isLiveBase(splitExpr(inner).base.toLowerCase()) && !seen.has(inner)) {
      seen.add(inner);
      out.push(inner);
    }
  }
  return out;
}
