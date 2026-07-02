// Pure unit checks for the template variable resolver (ADR-093, TPL3). No DB —
// the resolver is pure (the caller passes today/now). Run: npx tsx scripts/verify-template-vars.mts
import {
  resolveVars,
  resolveVarsInValue,
  resolveVarsInProps,
  scanAskLabels,
  hasVars,
  resolveDateRule,
  parseDateRule,
  parseApplyConfig,
  type VarContext,
} from "../src/lib/template-vars";

let pass = 0;
let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`}`);
}
function truthy(label: string, cond: boolean) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

// 2026-06-20 is a Saturday.
const ctx: VarContext = {
  todayYmd: "2026-06-20",
  now: new Date("2026-06-20T18:30:00Z"),
  timeZone: "UTC",
  title: "My Title",
  answers: { Topic: "Prayer", "Due owner": "Sam" },
};
const r = (t: string, c: VarContext = ctx) => resolveVars(t, c);

// dates + formats
eq("today default", r("{{today}}"), "Jun 20, 2026");
eq("today:iso", r("{{today:iso}}"), "2026-06-20");
eq("today:long", r("{{today:long}}"), "June 20, 2026");
eq("today:short", r("{{today:short}}"), "Jun 20");
eq("today:us", r("{{today:us}}"), "6/20/2026");
eq("today:day (Saturday)", r("{{today:day}}"), "Saturday");
eq("tomorrow:iso", r("{{tomorrow:iso}}"), "2026-06-21");
eq("yesterday:iso", r("{{yesterday:iso}}"), "2026-06-19");

// offsets
eq("today+7d", r("{{today+7d:iso}}"), "2026-06-27");
eq("today-3d", r("{{today-3d:iso}}"), "2026-06-17");
eq("today+2w", r("{{today+2w:iso}}"), "2026-07-04");
eq("today+1m", r("{{today+1m:iso}}"), "2026-07-20");
eq("today+1y", r("{{today+1y:iso}}"), "2027-06-20");

// weekdays (Sat 6/20 → next Sun = 6/28; this coming Sun = 6/21)
eq("nextSunday:iso", r("{{nextSunday:iso}}"), "2026-06-28");
eq("sunday:iso (this coming)", r("{{sunday:iso}}"), "2026-06-21");

// title + ask
eq("title echo", r("{{title}}"), "My Title");
eq("ask answered", r("{{ask:Topic}}"), "Prayer");
eq("ask label with space", r("{{ask:Due owner}}"), "Sam");
eq("ask unanswered → empty", r("{{ask:Missing}}"), "");

// robustness
eq("unknown token left intact", r("{{bogus}}"), "{{bogus}}");
eq("whitespace inside braces", r("{{ today }}"), "Jun 20, 2026");
eq("case-insensitive base", r("{{TODAY:iso}}"), "2026-06-20");
eq(
  "mixed line",
  r("Sermon for {{nextSunday:long}} on {{ask:Topic}}"),
  "Sermon for June 28, 2026 on Prayer"
);
eq("invalid today → text unchanged", resolveVars("{{today}}", { todayYmd: "nope" }), "{{today}}");

// now (UTC vs tz)
eq("now:time UTC", r("{{now:time}}"), "6:30 PM");
eq("now default UTC", r("{{now}}"), "Jun 20, 2026, 6:30 PM");
eq(
  "now:time in America/New_York (EDT = UTC-4)",
  r("{{now:time}}", { ...ctx, timeZone: "America/New_York" }),
  "2:30 PM"
);
eq("now without an instant → date only", r("{{now}}", { todayYmd: "2026-06-20" }), "Jun 20, 2026");

// scan + hasVars
eq(
  "scanAskLabels distinct + ordered",
  scanAskLabels(["{{ask:Topic}} {{ask:Due owner}}", "{{ask:Topic}} again", null, undefined]),
  ["Topic", "Due owner"]
);
truthy("hasVars date token", hasVars("a {{today}} b"));
truthy("hasVars ask token", hasVars("{{ask:X}}"));
truthy("hasVars false for plain text", !hasVars("nothing here"));
truthy("hasVars false for unknown token", !hasVars("{{bogus}}"));

// --- TPL3b: structured date rules ---
eq("rule none → null", resolveDateRule({ mode: "none" }, "2026-06-20"), null);
eq("rule undefined → null", resolveDateRule(undefined, "2026-06-20"), null);
eq("rule offset +3", resolveDateRule({ mode: "offset", days: 3 }, "2026-06-20"), "2026-06-23");
eq("rule offset 0 = apply day", resolveDateRule({ mode: "offset", days: 0 }, "2026-06-20"), "2026-06-20");
eq("rule offset -2", resolveDateRule({ mode: "offset", days: -2 }, "2026-06-20"), "2026-06-18");
eq("rule offset crosses month", resolveDateRule({ mode: "offset", days: 12 }, "2026-06-20"), "2026-07-02");
eq("rule fixed", resolveDateRule({ mode: "fixed", date: "2026-12-25" }, "2026-06-20"), "2026-12-25");
eq("rule fixed invalid date → null", resolveDateRule({ mode: "fixed", date: "nope" }, "2026-06-20"), null);
eq("parseDateRule offset", parseDateRule({ mode: "offset", days: 5 }), { mode: "offset", days: 5 });
eq("parseDateRule fixed", parseDateRule({ mode: "fixed", date: "2026-01-02" }), { mode: "fixed", date: "2026-01-02" });
eq("parseDateRule none", parseDateRule({ mode: "none" }), { mode: "none" });
eq("parseDateRule unknown mode → null", parseDateRule({ mode: "weird" }), null);
eq("parseDateRule offset non-int → null", parseDateRule({ mode: "offset", days: 1.5 }), null);
eq("parseDateRule fixed bad date → null", parseDateRule({ mode: "fixed", date: "2026-13-40" }), null);
eq(
  "parseApplyConfig keeps valid rules",
  parseApplyConfig({ scheduledDate: { mode: "offset", days: 1 }, dueDate: { mode: "fixed", date: "2026-07-01" }, junk: 1 }),
  { dueDate: { mode: "fixed", date: "2026-07-01" }, scheduledDate: { mode: "offset", days: 1 } }
);
eq("parseApplyConfig drops invalid", parseApplyConfig({ scheduledDate: { mode: "bad" } }), {});
eq("parseApplyConfig non-object → {}", parseApplyConfig(null), {});

// --- TPL6a: property-value token resolution ---
eq("resolveVarsInValue string", resolveVarsInValue("{{today}}", ctx), "Jun 20, 2026");
eq("resolveVarsInValue ask", resolveVarsInValue("{{ask:Topic}}", ctx), "Prayer");
eq("resolveVarsInValue offset date", resolveVarsInValue("{{today+14d:iso}}", ctx), "2026-07-04");
eq("resolveVarsInValue number passes through", resolveVarsInValue(42, ctx), 42);
eq("resolveVarsInValue boolean passes through", resolveVarsInValue(true, ctx), true);
eq(
  "resolveVarsInValue array of strings (multi_select)",
  resolveVarsInValue(["{{ask:Topic}}", "fixed", "{{today:iso}}"], ctx),
  ["Prayer", "fixed", "2026-06-20"]
);
{
  const same = ["a", "b"];
  truthy("resolveVarsInValue array unchanged → same ref", resolveVarsInValue(same, ctx) === same);
}
{
  const { changed, next } = resolveVarsInProps({ due: "{{today+7d:iso}}", note: "plain", n: 3 }, ctx);
  truthy("resolveVarsInProps changed flag", changed === true);
  eq("resolveVarsInProps resolves date prop", next.due, "2026-06-27");
  eq("resolveVarsInProps leaves plain", next.note, "plain");
  eq("resolveVarsInProps leaves number", next.n, 3);
}
{
  const props = { a: "plain", n: 1 };
  const res = resolveVarsInProps(props, ctx);
  truthy("resolveVarsInProps no tokens → same ref + not changed", res.next === props && res.changed === false);
}
eq("resolveVarsInProps null → {}", resolveVarsInProps(null, ctx), { changed: false, next: {} });

console.log(`\n${fail ? "FAIL" : "ALL PASS"} (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
