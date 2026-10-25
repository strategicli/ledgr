// Mail search language (src/modules/mail/lib/search.ts): parsing and the two
// translations, Gmail's q= and Graph's $search/$filter split. Pure, no network.
// Run: npx tsx scripts/verify-mail-search.mts
import { isTextSearch, parseMailQuery, passesPost, toGmailQuery, toGraphSearch } from "../src/modules/mail/lib/search";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- parsing
const q = parseMailQuery('from:dana subject:"fall budget" roof -pizza has:attachment is:unread after:2026/10/1 before:10/25/2026 in:inbox');
check("operators parsed", eq(q.from, ["dana"]) && eq(q.subject, ["fall budget"]) && eq(q.text, ["roof"]) && eq(q.exclude, ["pizza"]), JSON.stringify(q));
check("flags and dates parsed", q.hasAttachment === true && q.unread === true && q.after === "2026-10-01" && q.before === "2026-10-25" && q.in === "inbox");
check("phrases stay whole", eq(parseMailQuery('"staff retreat" lodging').text, ["staff retreat", "lodging"]));
check("unknown operators stay literal text", eq(parseMailQuery("Re: budget at 10:30").text, ["Re:", "budget", "at", "10:30"]));
check("bad date stays literal", eq(parseMailQuery("after:2026-02-30").text, ["after:2026-02-30"]));
check("bad in: stays literal", eq(parseMailQuery("in:nowhere").text, ["in:nowhere"]) && parseMailQuery("in:nowhere").in === undefined);
check("is:read / -is:unread", parseMailQuery("is:read").unread === false && parseMailQuery("-is:unread").unread === false);
check("is:starred means flagged", parseMailQuery("is:starred").flagged === true);
check("-from: excludes the value", eq(parseMailQuery("-from:amazon").exclude, ["amazon"]));
check("unclosed quote still parses", eq(parseMailQuery('"half open').text, ["half open"]));
check("case-insensitive operators", eq(parseMailQuery("FROM:Dana").from, ["Dana"]));
check("empty input is empty", !isTextSearch(parseMailQuery("   ")));
check("chips alone are not a text search", !isTextSearch({ ...parseMailQuery(""), unread: true, flagged: true }));
check("words are a text search", isTextSearch(parseMailQuery("budget")));
check("long input capped", parseMailQuery("x ".repeat(1000)).text.length <= 250);

// --- Gmail
check("gmail translation", toGmailQuery(q) === 'roof -pizza from:dana subject:"fall budget" has:attachment is:unread after:2026/10/01 before:2026/10/25', toGmailQuery(q));
check("gmail strips stray quotes", toGmailQuery(parseMailQuery('say "hi"')) === "say hi", toGmailQuery(parseMailQuery('say "hi"')));
check("gmail flagged + read", toGmailQuery({ ...parseMailQuery(""), flagged: true, unread: false }) === "-is:unread is:starred");

// --- Graph
const g = toGraphSearch(q);
check("graph KQL", g.search === '"roof" from:"dana" subject:"fall budget" hasAttachments:true received>=2026-10-01 received<2026-10-25 NOT "pizza"', g.search);
check("graph word search has no $filter, read state checked after", g.filter === undefined && g.post.unread === true);
check("graph colons and KQL words stay literal", toGraphSearch(parseMailQuery("Re: AND budget")).search === '"Re:" "AND" "budget"');
const f = toGraphSearch({ ...parseMailQuery(""), unread: true, flagged: true, hasAttachment: true });
check("graph chips become $filter led by receivedDateTime", f.search === undefined && f.filter === "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false and flag/flagStatus eq 'flagged' and hasAttachments eq true", f.filter);
check("graph no query = no filter", toGraphSearch(parseMailQuery("")).filter === undefined);
check("graph date alone is a $filter", toGraphSearch(parseMailQuery("after:2026-10-01")).filter === "receivedDateTime ge 2026-10-01T00:00:00Z");
check("graph only-exclusions does not send a bare NOT", toGraphSearch(parseMailQuery("-pizza")).search === undefined);
check("post filter", passesPost({ read: false, flagged: true }, { unread: true, flagged: true }) && !passesPost({ read: true, flagged: true }, { unread: true }));

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll mail search checks passed");
