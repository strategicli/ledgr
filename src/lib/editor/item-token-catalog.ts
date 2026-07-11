// The catalog of live tokens the `{{` insert menu offers (LT2). Pure + client-
// safe: a static list of the recognized {{item.*}}/{{parent.*}} tokens (see
// item-tokens.ts / ADR-139), grouped for the popup, plus a query filter. Custom
// properties aren't enumerated here (they vary per type) — the menu appends an
// "item.props." starter and the decoration highlights whatever you type. Dynamic
// property/related keys can be threaded in later; this keeps LT2 dependency-free.

export type TokenGroup =
  | "Item"
  | "Dates"
  | "Now"
  | "Bakes on apply"
  | "Related"
  | "Parent";

// A token is either LIVE — it re-resolves from the item's current state at
// EVERY render/export/preview (item-tokens.ts / ADR-139) — or a BAKE token that
// resolves ONCE, to the apply date, when a TEMPLATE is applied (template-vars.ts)
// and is inert plain text everywhere else. The two families share the `{{ }}`
// syntax, so the picker labels them distinctly to end the "{{today}} vs
// {{now.today}}" confusion (slice 7 / ADR-154).
export type TokenKind = "live" | "bake";

export type TokenOption = {
  // The token inserted, without braces (e.g. "item.due:long").
  token: string;
  // Menu label.
  label: string;
  // One-line hint of what it resolves to.
  hint: string;
  group: TokenGroup;
  // Defaults to "live"; the "Bakes on apply" group sets "bake".
  kind?: TokenKind;
};

export const TOKEN_CATALOG: TokenOption[] = [
  // Item scalar fields
  { token: "item.title", label: "Title", hint: "This item's current title", group: "Item" },
  { token: "item.status", label: "Status", hint: "This item's status", group: "Item" },
  { token: "item.type", label: "Type", hint: "This item's type", group: "Item" },
  { token: "item.priority", label: "Priority", hint: "P1–P6 (blank if none)", group: "Item" },
  { token: "item.url", label: "URL", hint: "This item's link field", group: "Item" },
  { token: "item.props.", label: "Custom property…", hint: "item.props.<key> — a custom field", group: "Item" },

  // Dates (default format; :long / :iso / :us / :short / :day and ±Nd also work)
  { token: "item.due:long", label: "Due date", hint: "e.g. July 10, 2026", group: "Dates" },
  { token: "item.scheduled:long", label: "Scheduled date", hint: "The planned date", group: "Dates" },
  { token: "item.meeting:long", label: "Meeting date", hint: "The event date/time", group: "Dates" },
  { token: "item.created:long", label: "Created date", hint: "When this item was made", group: "Dates" },

  // Live "now" dates (LT-live-time): re-resolve to the current date at EVERY
  // render (unlike template apply-time {{today}}, which bakes once). Same
  // :iso/:long/:us/:short/:day formats and ±Nd/w/m/y offsets as item dates.
  { token: "now", label: "Today (live)", hint: "The current date, refreshed every render", group: "Now" },
  { token: "now.tomorrow", label: "Tomorrow (live)", hint: "Tomorrow's date, refreshed every render", group: "Now" },
  { token: "now.yesterday", label: "Yesterday (live)", hint: "Yesterday's date, refreshed every render", group: "Now" },
  { token: "now.today+7d", label: "Today + offset (live)", hint: "e.g. now.today+7d, now.today-1w, now.today+1m", group: "Now" },
  { token: "now.nextweek", label: "Next week (live)", hint: "Seven days from today", group: "Now" },
  { token: "now.sunday", label: "A weekday (live)", hint: "The coming Sunday…Saturday (or now.nextsunday)", group: "Now" },

  // Apply-time BAKE tokens (template-vars.ts): fill in ONCE, to the apply date,
  // when a template is applied — then they're plain text (they do NOT re-resolve
  // and stay literal in a non-template note). The live "Now" group above is the
  // opposite: it refreshes every render. Same :iso/:long/:us/:short/:day formats
  // and ±Nd/w/m/y offsets as the date tokens.
  { token: "today", label: "Today", hint: "The apply date, baked once (e.g. July 10, 2026)", group: "Bakes on apply", kind: "bake" },
  { token: "tomorrow", label: "Tomorrow", hint: "The day after apply, baked once", group: "Bakes on apply", kind: "bake" },
  { token: "yesterday", label: "Yesterday", hint: "The day before apply, baked once", group: "Bakes on apply", kind: "bake" },
  { token: "today+7d", label: "Apply date + offset", hint: "e.g. today+7d, today-1w, today+1m — baked once", group: "Bakes on apply", kind: "bake" },
  { token: "sunday", label: "This coming weekday", hint: "The next Sunday…Saturday (incl. today), baked once", group: "Bakes on apply", kind: "bake" },
  { token: "nextSunday", label: "Next week's weekday", hint: "Next week's Sunday…Saturday, baked once", group: "Bakes on apply", kind: "bake" },

  // Related / children (lists — add :ul or :ol on their own line for a list)
  { token: "item.related.person", label: "Related people", hint: "People linked to this item", group: "Related" },
  { token: "item.related.task", label: "Related tasks", hint: "Tasks linked to this item", group: "Related" },
  { token: "item.children", label: "Child items", hint: "Subtasks / children (add :ul for a list)", group: "Related" },
  // Meeting aliases (ADR-144): shorthands for the event People card's roles.
  { token: "attendees", label: "Attendees", hint: "Who's marked here (add :ul for a list)", group: "Related" },
  { token: "absentees", label: "Absentees", hint: "Who's marked OUT", group: "Related" },
  { token: "group", label: "Meeting group", hint: "The group this meeting is for", group: "Related" },

  // Parent
  { token: "parent.title", label: "Parent title", hint: "The parent item's title", group: "Parent" },
  { token: "parent.due:long", label: "Parent due date", hint: "The parent's due date", group: "Parent" },
];

// The catalog rows matching a query (matches token or label, case-insensitive),
// preserving catalog order. An empty query returns everything.
export function filterTokenOptions(query: string): TokenOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOKEN_CATALOG;
  return TOKEN_CATALOG.filter(
    (o) => o.token.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
  );
}
