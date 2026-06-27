// EM1 (ADR-123) verification: templates as the calendar match-rule source.
// Covers validateMatchConfig (strict), the matchConfig round-trip through
// template CRUD, listEventRules (rule-bearing event templates only, owner-scoped,
// live prototype only), and matchEventToTemplate (kind precedence, fuzzy gating,
// oldest-template tie-break). Against live Neon under a throwaway owner; reuses
// the global `event` type. Run:
//   node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/verify-event-rules.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, templates, users } = await import("../src/db/schema");
const { createTemplate, updateTemplate, getTemplate, parseTemplateInput } = await import(
  "../src/lib/templates"
);
const { validateMatchConfig, parseMatchConfig } = await import(
  "../src/lib/templates/match-config"
);
const { listEventRules, matchEventToTemplate } = await import(
  "../src/lib/calendar/event-rules"
);
const { ItemError, softDeleteItem } = await import("../src/lib/items");
const { eq, inArray } = await import("drizzle-orm");

type CalendarEvent = import("../src/lib/calendar/types").CalendarEvent;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
async function throws(name: string, fn: () => Promise<unknown> | unknown, code?: string) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    const ok = err instanceof ItemError && (!code || err.code === code);
    check(name, ok, err instanceof Error ? err.message : String(err));
  }
}

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    title: "",
    startUtc: new Date(),
    endUtc: null,
    isCancelled: false,
    organizer: null,
    attendees: [],
    location: null,
    isOnline: false,
    joinUrl: null,
    webLink: null,
    seriesMasterId: null,
    bodyPreview: null,
    lastModified: null,
    ...partial,
  };
}

const stamp = Date.now();
const db = getDb();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-event-rules-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-event-rules-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  // --- validateMatchConfig (pure, strict) ---
  const good = validateMatchConfig({ condition: { kind: "attendeeEmail", email: "Roger@X.com" }, autoApply: true });
  check("validate accepts a good condition + lowercases email", good.condition.kind === "attendeeEmail" && (good.condition as { email: string }).email === "roger@x.com" && good.autoApply === true);
  check("validate defaults autoApply to false", validateMatchConfig({ condition: { kind: "seriesId", seriesMasterId: "s1" } }).autoApply === false);
  await throws("validate rejects a missing condition", () => validateMatchConfig({ autoApply: true }), "bad_request");
  await throws("validate rejects an email without @", () => validateMatchConfig({ condition: { kind: "attendeeEmail", email: "nope" } }), "bad_request");
  await throws("validate rejects a non-boolean autoApply", () => validateMatchConfig({ condition: { kind: "seriesId", seriesMasterId: "s" }, autoApply: "yes" }), "bad_request");
  await throws("validate rejects a bad regex", () => validateMatchConfig({ condition: { kind: "titleRegex", pattern: "(" } }), "bad_request");
  check("parseMatchConfig(null) is null", parseMatchConfig(null) === null);
  check("parseMatchConfig(garbage) is null (tolerant read)", parseMatchConfig({ nope: 1 }) === null);

  // --- parseTemplateInput patch accepts/validates/clears matchConfig ---
  const p1 = parseTemplateInput({ matchConfig: { condition: { kind: "seriesId", seriesMasterId: "s9" }, autoApply: true } }, "patch");
  check("patch parses a matchConfig", p1.matchConfig?.condition.kind === "seriesId" && p1.matchConfig.autoApply === true);
  const p2 = parseTemplateInput({ matchConfig: null }, "patch");
  check("patch accepts matchConfig: null (clear)", p2.matchConfig === null);
  await throws("patch rejects a bad matchConfig (strict)", () => parseTemplateInput({ matchConfig: { condition: { kind: "attendeeEmail", email: "bad" } } }, "patch"), "bad_request");

  // --- matchConfig round-trip through template CRUD ---
  const t = await createTemplate(owner.id, { type: "event", name: `Roger 1:1 ${stamp}` });
  check("a new event template starts with no matchConfig", t.matchConfig === null);
  const tUpdated = await updateTemplate(owner.id, t.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "roger@x.com" }, autoApply: true } });
  check("updateTemplate persists matchConfig", tUpdated.matchConfig?.condition.kind === "attendeeEmail" && tUpdated.matchConfig.autoApply === true);
  check("getTemplate round-trips matchConfig", (await getTemplate(owner.id, t.id)).matchConfig?.autoApply === true);
  const tCleared = await updateTemplate(owner.id, t.id, { matchConfig: null });
  check("updateTemplate clears matchConfig with null", tCleared.matchConfig === null);
  // re-arm it for the matching tests
  await updateTemplate(owner.id, t.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "roger@x.com" }, autoApply: true } });

  // --- listEventRules: rule-bearing EVENT templates only, owner-scoped ---
  const plain = await createTemplate(owner.id, { type: "event", name: `Plain content ${stamp}` });
  const taskRule = await createTemplate(owner.id, { type: "task", name: `Task rule ${stamp}` });
  await updateTemplate(owner.id, taskRule.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "roger@x.com" }, autoApply: false } });
  const rules = await listEventRules(owner.id);
  check("listEventRules includes the rule-bearing event template", rules.some((r) => r.templateId === t.id));
  check("listEventRules excludes a plain (no-rule) event template", !rules.some((r) => r.templateId === plain.id));
  check("listEventRules excludes a non-event (task) rule template", !rules.some((r) => r.templateId === taskRule.id));
  check("listEventRules is owner-scoped", (await listEventRules(other.id)).length === 0);

  // --- matchEventToTemplate: attendeeEmail ---
  const mEmail = await matchEventToTemplate(owner.id, ev({ title: "Roger / Brandon 1:1", attendees: [{ name: "Roger", email: "ROGER@x.com" }] }));
  check("attendeeEmail rule matches an event with that attendee (case-insensitive)", mEmail?.rule.templateId === t.id);
  check("matched rule carries autoApply", mEmail?.rule.autoApply === true);
  check("no match when the email isn't on the event", (await matchEventToTemplate(owner.id, ev({ title: "Unrelated", attendees: [{ name: "X", email: "x@y.com" }] }))) === null);
  const mOrg = await matchEventToTemplate(owner.id, ev({ title: "x", organizer: { name: "Roger", email: "roger@x.com" } }));
  check("attendeeEmail also matches the organizer email", mOrg?.rule.templateId === t.id);

  // --- seriesId + titleRegex ---
  const series = await createTemplate(owner.id, { type: "event", name: `Staff series ${stamp}` });
  await updateTemplate(owner.id, series.id, { matchConfig: { condition: { kind: "seriesId", seriesMasterId: "series-123" }, autoApply: false } });
  check("seriesId rule matches an event in that series", (await matchEventToTemplate(owner.id, ev({ title: "Staff", seriesMasterId: "series-123" })))?.rule.templateId === series.id);
  check("seriesId rule does not match a different series", (await matchEventToTemplate(owner.id, ev({ title: "Staff", seriesMasterId: "other" })))?.rule.templateId !== series.id);

  const rx = await createTemplate(owner.id, { type: "event", name: `Regex elders ${stamp}` });
  await updateTemplate(owner.id, rx.id, { matchConfig: { condition: { kind: "titleRegex", pattern: "Elders Meeting", flags: "i" }, autoApply: false } });
  check("titleRegex rule matches the title", (await matchEventToTemplate(owner.id, ev({ title: "Monthly elders meeting" })))?.rule.templateId === rx.id);

  // --- precedence: attendeeEmail (rank 0) beats titleRegex (rank 2) ---
  // The Roger email rule (t) and a regex rule that also matches the title.
  const rxAlso = await createTemplate(owner.id, { type: "event", name: `Regex also ${stamp}` });
  await updateTemplate(owner.id, rxAlso.id, { matchConfig: { condition: { kind: "titleRegex", pattern: "1:1" }, autoApply: false } });
  const bothNonFuzzy = await matchEventToTemplate(owner.id, ev({ title: "Roger / Brandon 1:1", attendees: [{ name: "Roger", email: "roger@x.com" }] }));
  check("attendeeEmail wins over titleRegex (kind precedence)", bothNonFuzzy?.rule.templateId === t.id);

  // --- fuzzy gating + a fuzzy hit ---
  const fuzzy = await createTemplate(owner.id, { type: "event", name: `Fuzzy huddle ${stamp}` });
  await updateTemplate(owner.id, fuzzy.id, { matchConfig: { condition: { kind: "titleFuzzy", pattern: "Weekly Staff Huddle", threshold: 0.4 }, autoApply: false } });
  check("a fuzzy rule matches a near-identical title", (await matchEventToTemplate(owner.id, ev({ title: "Weekly Staff Huddle" })))?.rule.templateId === fuzzy.id);
  check("a fuzzy rule does not match an unrelated title", (await matchEventToTemplate(owner.id, ev({ title: "Totally unrelated thing" })))?.rule.templateId !== fuzzy.id);
  // When the email rule ALSO hits, fuzzy is gated out (non-fuzzy wins).
  const gated = await matchEventToTemplate(owner.id, ev({ title: "Weekly Staff Huddle", attendees: [{ name: "Roger", email: "roger@x.com" }] }));
  check("fuzzy is gated when a non-fuzzy rule hits", gated?.rule.templateId === t.id);

  // --- oldest-template tie-break among equal-kind matches ---
  const tieA = await createTemplate(owner.id, { type: "event", name: `Tie A ${stamp}` });
  const tieB = await createTemplate(owner.id, { type: "event", name: `Tie B ${stamp}` });
  await updateTemplate(owner.id, tieA.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "tie@x.com" }, autoApply: false } });
  await updateTemplate(owner.id, tieB.id, { matchConfig: { condition: { kind: "attendeeEmail", email: "tie@x.com" }, autoApply: false } });
  // Pin deterministic createdAt: A older than B.
  await db.update(templates).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(templates.id, tieA.id));
  await db.update(templates).set({ createdAt: new Date("2026-02-01T00:00:00Z") }).where(eq(templates.id, tieB.id));
  check("equal-kind tie goes to the oldest template", (await matchEventToTemplate(owner.id, ev({ title: "tie", attendees: [{ name: "T", email: "tie@x.com" }] })))?.rule.templateId === tieA.id);

  // --- a rule whose prototype was soft-deleted drops out (innerJoin live only) ---
  await softDeleteItem(owner.id, series.prototypeItemId);
  check("a rule with a trashed prototype is excluded", !(await listEventRules(owner.id)).some((r) => r.templateId === series.id));
} finally {
  await db.delete(items).where(inArray(items.ownerId, [owner.id, other.id]));
  await db.delete(templates).where(inArray(templates.ownerId, [owner.id, other.id]));
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
