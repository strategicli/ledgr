// Populates realistic test data for Ledgr dev and manual testing.
// Run: npm run db:seed-test
//
// ⚠️  Deletes ALL items for the owner before inserting. Dev only.
// Re-running is safe — it wipes and rebuilds from scratch.
//
// What's included:
//   12 entities (people, orgs, projects, topics)
//   10 meetings (past, upcoming, various intervals)
//   16 tasks (open/done, various urgencies, subtasks, overdue, inbox)
//    5 notes (sermon prep, meeting notes, ideas, reflection)
//    5 links
//   ~60 relations (attendees, tagged, references, a few suggested)

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error("DATABASE_URL must be the Neon pooler connection string.");
  process.exit(1);
}

const sql = neon(url);

const [owner] = await sql`
  SELECT id FROM users WHERE email = 'brandoncollins@edgewoodcommunity.org'
`;
if (!owner) {
  console.error("No user found — run npm run db:seed first.");
  process.exit(1);
}
const ownerId = owner.id;

// Wipe existing items (relations/revisions/attachments/share_tokens cascade)
const { rowCount } = await sql`DELETE FROM items WHERE owner_id = ${ownerId}`;
console.log(`Cleared ${rowCount ?? 0} existing items.`);

// --- Date helpers (all ISO strings, UTC) ---
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function daysFromNow(n) {
  return daysAgo(-n);
}
function weeksAgo(n) {
  return daysAgo(n * 7);
}
function weeksFromNow(n) {
  return daysFromNow(n * 7);
}
// Set time-of-day for meetings
function meetingTime(isoDate, hour = 9, minute = 0) {
  const d = new Date(isoDate);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// --- Body helpers ---
function md(text) {
  return JSON.stringify({ format: "markdown", text });
}
// Lightweight markdown stripper for body_text (full version lives in body-text.ts)
function stripMd(text) {
  return text
    .replace(/#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

// --- Insert helpers ---
async function insertItem({
  id = randomUUID(),
  type,
  title,
  body = null,
  status = "open",
  dueDate = null,
  urgency = null,
  meetingAt = null,
  url: itemUrl = null,
  kind = null,
  inbox = false,
  parentId = null,
  properties = null,
  createdAt = null,
  updatedAt = null,
} = {}) {
  const bodyJson = body ? body : null; // already JSON.stringify'd
  const bodyText = body ? stripMd(JSON.parse(body).text) : null;
  const propsJson = properties ? JSON.stringify(properties) : null;
  const created = createdAt ?? new Date().toISOString();
  const updated = updatedAt ?? created;

  await sql`
    INSERT INTO items (
      id, owner_id, type, title,
      body, body_text,
      status, due_date, urgency,
      meeting_at, url, kind,
      inbox, parent_id, properties,
      created_at, updated_at
    ) VALUES (
      ${id}, ${ownerId}, ${type}, ${title},
      ${bodyJson}::jsonb, ${bodyText},
      ${status}::item_status,
      ${dueDate},
      ${urgency}::urgency,
      ${meetingAt}, ${itemUrl}, ${kind},
      ${inbox}, ${parentId},
      ${propsJson}::jsonb,
      ${created}, ${updated}
    )
  `;
  return id;
}

async function rel(sourceId, targetId, role = "related", state = "confirmed") {
  await sql`
    INSERT INTO relations (id, source_id, target_id, role, match_state)
    VALUES (
      ${randomUUID()}, ${sourceId}, ${targetId}, ${role},
      ${state}::match_state
    )
    ON CONFLICT (source_id, target_id, role) DO NOTHING
  `;
}

// ============================================================
// ENTITIES — 12 items
// ============================================================
console.log("Inserting entities...");

const E = {}; // entity id map

E.roger = await insertItem({
  type: "entity", kind: "person", title: "Roger Martinez",
  body: md(
    "## Roger Martinez\n\nWorship Pastor. At Edgewood since 2019.\n\n" +
    "**Email:** roger.martinez@edgewoodcommunity.org\n\n" +
    "### Notes\n\n" +
    "- Strong in pastoral care for his team\n" +
    "- Working on expanded creative calendar for fall\n" +
    "- Interested in attending Worship Leader Summit in October (Atlanta, ~$1,800)\n" +
    "- Raised sound board feedback issue at the 8am service — three consecutive weeks"
  ),
  createdAt: weeksAgo(20),
});

E.sarah = await insertItem({
  type: "entity", kind: "person", title: "Sarah Chen",
  body: md(
    "## Sarah Chen\n\nChildren's Ministry Director.\n\n" +
    "**Email:** sarah.chen@edgewoodcommunity.org\n\n" +
    "### Notes\n\n" +
    "- Launched new curriculum in January; strong early adoption\n" +
    "- Deep volunteer pipeline (largest roster in church history)\n" +
    "- Summer camp 2026 lead coordinator — targeting 80 families"
  ),
  createdAt: weeksAgo(18),
});

E.mike = await insertItem({
  type: "entity", kind: "person", title: "Mike Thompson",
  body: md(
    "## Mike Thompson\n\nFacilities Director.\n\n" +
    "**Email:** mike.thompson@edgewoodcommunity.org\n\n" +
    "### Notes\n\n" +
    "- Overseeing the 2026 building renovation\n" +
    "- Has strong contractor relationships from his previous church\n" +
    "- Growth area: communicating disruptions to staff before they become surprises\n" +
    "- Detail-oriented, excellent at project tracking"
  ),
  createdAt: weeksAgo(18),
});

E.lisa = await insertItem({
  type: "entity", kind: "person", title: "Lisa Park",
  body: md(
    "## Lisa Park\n\nYouth Pastor (middle school + high school).\n\n" +
    "**Email:** lisa.park@edgewoodcommunity.org\n\n" +
    "### Notes\n\n" +
    "- Second year on staff; still building trust with parents\n" +
    "- Q2 survey: 78% satisfaction (down from 84%) — main feedback is 'wants more community outside Sunday'\n" +
    "- Summer retreat planned for August\n" +
    "- Would benefit from more intentional 1-on-1 investment from me"
  ),
  createdAt: weeksAgo(16),
});

E.tom = await insertItem({
  type: "entity", kind: "person", title: "Tom Bradley",
  body: md(
    "## Tom Bradley\n\nSenior Pastor. Primary preacher (40+ Sundays/year).\n\n" +
    "### Notes\n\n" +
    "- Delegating more operational decisions to me in 2026\n" +
    "- Vision for Ledgr: a 'clarity system,' not just a task manager\n" +
    "- Wants Vision Sunday to be celebration-first this year, not a vision-dump\n" +
    "- Guest speaker for Kingdom Come week 4: exploring Phil Bowman (Providence Church)"
  ),
  createdAt: weeksAgo(24),
});

E.emma = await insertItem({
  type: "entity", kind: "person", title: "Emma Wilson",
  body: md(
    "## Emma Wilson\n\nCandidate: Communications Coordinator\n\n" +
    "**Status:** Interview scheduled — June 16\n\n" +
    "### Background\n\n" +
    "Redesigned all communications at Riverside Church over 18 months. " +
    "Comfortable with church management software. Strong design portfolio.\n\n" +
    "### References to check\n\n" +
    "- Mark Delaney (Riverside Church, former supervisor)\n" +
    "- Pam Singh (previous employer, nonprofit sector)"
  ),
  createdAt: daysAgo(5),
});

E.edgewood = await insertItem({
  type: "entity", kind: "org", title: "Edgewood Community Church",
  body: md(
    "## Edgewood Community Church\n\n" +
    "**Location:** 4200 Oak Street, Riverside\n\n" +
    "**Weekend attendance:** ~620 (avg combined services)\n\n" +
    "**Staff:** 12 full-time, 8 part-time\n\n" +
    "### Key dates 2026\n\n" +
    "- Vision Sunday: July 27\n" +
    "- Summer Family Camp: August 10-14\n" +
    "- Fall Launch: September 7\n" +
    "- Kingdom Come series: September 7 - October 18\n" +
    "- Annual Giving Campaign: November"
  ),
  createdAt: weeksAgo(24),
});

E.crossroads = await insertItem({
  type: "entity", kind: "org", title: "Crossroads Fellowship",
  body: md(
    "## Crossroads Fellowship\n\nPartner church, metro area.\n\n" +
    "**Lead Pastor:** David Kim\n\n" +
    "### Collaboration areas\n\n" +
    "- Joint community outreach (annual fall block party)\n" +
    "- Shared Guatemala missions partnership\n" +
    "- Staff training resource sharing\n\n" +
    "### Pending\n\nFollow up with David about fall outreach and co-sponsoring Guatemala trip."
  ),
  createdAt: weeksAgo(12),
});

E.buildingReno = await insertItem({
  type: "entity", kind: "project", title: "Building Renovation 2026",
  body: md(
    "## Building Renovation 2026\n\n" +
    "**Budget:** $280,000\n\n" +
    "**Timeline:** April - October 2026\n\n" +
    "### Scope\n\n" +
    "- Children's wing expansion (2,400 sq ft, 3 classrooms + check-in lobby)\n" +
    "- Full HVAC replacement in main sanctuary (Blue Ridge Systems, $62K)\n" +
    "- ADA-compliant restroom renovation (both; change order ~$18K pending elder approval)\n" +
    "- Parking lot resurfacing + 7 new ADA spaces (Phase 3, September)\n\n" +
    "### Status\n\n" +
    "Phase 1 (children's wing framing) complete — on time, under budget ($94,200 vs $98,000). " +
    "Phase 2 HVAC begins July 7."
  ),
  createdAt: weeksAgo(16),
});

E.summerCamp = await insertItem({
  type: "entity", kind: "project", title: "Summer Family Camp 2026",
  body: md(
    "## Summer Family Camp 2026\n\n" +
    "**Dates:** August 10-14\n\n" +
    "**Venue:** Cedar Ridge Camp\n\n" +
    "**Theme:** Rooted (Colossians 2:6-7)\n\n" +
    "**Target:** 80 families | **Current registrations:** 31\n\n" +
    "### Leadership\n\n" +
    "- Overall: Sarah Chen\n" +
    "- Youth track: Lisa Park\n" +
    "- Worship: Roger Martinez\n\n" +
    "### Budget\n\n" +
    "- Camp rental: $18,000\n" +
    "- Transportation: $4,000\n" +
    "- Programming: $3,500"
  ),
  createdAt: weeksAgo(14),
});

E.kingdomCome = await insertItem({
  type: "entity", kind: "topic", title: "Kingdom Come Sermon Series",
  body: md(
    "## Kingdom Come\n\n" +
    "**Season:** Fall 2026 (September 7 - October 18)\n\n" +
    "**Texts:** Matthew 5-7 (Sermon on the Mount)\n\n" +
    "### Outline (draft)\n\n" +
    "1. The Upside-Down Kingdom (Matt 5:1-12)\n" +
    "2. Salt and Light (Matt 5:13-16)\n" +
    "3. A Better Righteousness (Matt 5:17-48)\n" +
    "4. How We Pray (Matt 6:5-15) — guest speaker TBD\n" +
    "5. Where Is Your Treasure? (Matt 6:19-34)\n" +
    "6. The Narrow Gate (Matt 7:13-27)\n\n" +
    "### Open questions\n\n" +
    "- Guest speaker for week 4: Phil Bowman (Providence Church)? Check availability.\n" +
    "- Small group curriculum: build internally or license RightNow Media?\n" +
    "- Baptism Sunday: integrate into week 6?"
  ),
  createdAt: weeksAgo(8),
});

E.staffDev = await insertItem({
  type: "entity", kind: "topic", title: "Staff Development Initiative",
  body: md(
    "## Staff Development Initiative 2026\n\n" +
    "**Goal:** Invest in each staff member's professional and spiritual growth.\n\n" +
    "### Components\n\n" +
    "- Quarterly 1-on-1 reviews for all direct reports\n" +
    "- $500/person annual learning budget\n" +
    "- Monthly staff devotional (rotating leader)\n" +
    "- Annual retreat (August 19-20, venue TBD)\n\n" +
    "### Q2 review status\n\n" +
    "- [x] Roger Martinez\n" +
    "- [x] Sarah Chen\n" +
    "- [ ] Mike Thompson (in progress)\n" +
    "- [ ] Lisa Park"
  ),
  createdAt: weeksAgo(20),
});

// ============================================================
// MEETINGS — 10 items
// ============================================================
console.log("Inserting meetings...");

const M = {};

M.staff1 = await insertItem({
  type: "meeting", title: "Weekly Staff Meeting",
  meetingAt: meetingTime(weeksAgo(4), 9),
  status: "done",
  body: md(
    "## Weekly Staff Meeting\n\n" +
    "### Updates\n\n" +
    "- Children's wing framing on schedule\n" +
    "- Summer camp registration opens next week\n" +
    "- Kingdom Come series: Tom confirmed 6-week arc in Matthew 5-7\n\n" +
    "### Decisions\n\n" +
    "Approved moving Vision Sunday to a 'celebration-first' format. " +
    "Elder board gets the pilot in July.\n\n" +
    "### Action items\n\n" +
    "- Brandon: send contractor timeline to elders by Friday\n" +
    "- Sarah: finalize camp registration form\n" +
    "- Roger: confirm worship team availability for fall series"
  ),
  createdAt: weeksAgo(4),
  updatedAt: weeksAgo(4),
});

M.staff2 = await insertItem({
  type: "meeting", title: "Weekly Staff Meeting",
  meetingAt: meetingTime(weeksAgo(3), 9),
  status: "done",
  body: md(
    "## Weekly Staff Meeting\n\n" +
    "### Updates\n\n" +
    "- Camp registration live — 14 families in first 4 days\n" +
    "- HVAC contractor walkthrough scheduled for next week\n" +
    "- Communications coordinator posting: 22 applicants in 5 days\n\n" +
    "### Discussion: Vision Sunday\n\n" +
    "Spent 20 min on format. Tom wants 'celebration of what God has done' " +
    "as the frame, then point forward. Will pilot with elders in July.\n\n" +
    "### Action items\n\n" +
    "- Brandon: schedule panel interviews for communications finalists\n" +
    "- Lisa: share Q2 youth survey results before next week's meeting"
  ),
  createdAt: weeksAgo(3),
  updatedAt: weeksAgo(3),
});

M.staff3 = await insertItem({
  type: "meeting", title: "Weekly Staff Meeting",
  meetingAt: meetingTime(weeksAgo(2), 9),
  status: "done",
  body: md(
    "## Weekly Staff Meeting\n\n" +
    "### Updates\n\n" +
    "- 31 families registered for summer camp\n" +
    "- Communications interviews: 3 finalists, panel next week\n" +
    "- Q2 staff reviews: Roger done, Sarah done, Mike in progress, Lisa not started\n\n" +
    "### Highlight\n\n" +
    "Roger previewed a new worship set for the fall series. " +
    "Strong response from the team — the emotional arc he mapped out is compelling.\n\n" +
    "### Action items\n\n" +
    "- Brandon: complete Mike's Q2 review this week\n" +
    "- Sarah: order camp t-shirts by July 1 (supplier needs 4 weeks)\n" +
    "- Roger: share set list with Tom for approval before July 1"
  ),
  createdAt: weeksAgo(2),
  updatedAt: weeksAgo(2),
});

M.staff4 = await insertItem({
  type: "meeting", title: "Weekly Staff Meeting",
  meetingAt: meetingTime(daysFromNow(2), 9),
  status: "open",
  body: md(
    "## Weekly Staff Meeting\n\n" +
    "### Agenda\n\n" +
    "1. Check-in (10 min)\n" +
    "2. Summer camp update — Sarah\n" +
    "3. Building renovation Phase 2 timeline — Mike\n" +
    "4. Kingdom Come series prep — Roger + Brandon\n" +
    "5. Communications hire decision (Emma Wilson panel feedback)\n" +
    "6. Prayer"
  ),
  createdAt: daysAgo(1),
});

M.elderQ2 = await insertItem({
  type: "meeting", title: "Elder Board Q2 Review",
  meetingAt: meetingTime(weeksAgo(6), 18, 30),
  status: "done",
  body: md(
    "## Elder Board Q2 Review\n\n" +
    "### Report\n\n" +
    "1. Attendance summary: 618 average (up from 594 in Q1)\n" +
    "2. Financial: $148,204 given vs $142,000 budget (4% ahead)\n" +
    "3. Building renovation: Phase 1 complete, under budget\n" +
    "4. Staff updates: communications search in progress\n\n" +
    "### Decisions\n\n" +
    "- Approved Phase 2 of building renovation (motion carried 6-1)\n" +
    "- Affirmed Vision Sunday date: July 27\n" +
    "- Requested written job description for communications role before final hire vote\n\n" +
    "### Notes\n\n" +
    "Elder Jim Hartley raised a question about the Guatemala missions budget. " +
    "Will bring a clearer breakdown to the July meeting."
  ),
  createdAt: weeksAgo(6),
  updatedAt: weeksAgo(6),
});

M.building1 = await insertItem({
  type: "meeting", title: "Building Committee Review",
  meetingAt: meetingTime(weeksAgo(3), 10),
  status: "done",
  body: md(
    "## Building Committee Review\n\n" +
    "**Present:** Brandon Collins, Mike Thompson, Jim Carey (Apex Construction)\n\n" +
    "### Phase 1 status\n\n" +
    "- Framing complete, 2 days ahead of schedule\n" +
    "- Inspections passed: structural, electrical rough-in\n" +
    "- Remaining: drywall and paint (estimated 3 weeks)\n\n" +
    "### Phase 2 planning\n\n" +
    "- HVAC work begins July 7 (Blue Ridge confirmed)\n" +
    "- ADA restrooms: change order coming (~$18K additional) — needs elder board approval\n" +
    "- Parking lot: September start\n\n" +
    "### Budget update\n\n" +
    "Phase 1 final: $94,200 (budget $98,000). Phase 2 estimate: $141,000."
  ),
  createdAt: weeksAgo(3),
  updatedAt: weeksAgo(3),
});

M.building2 = await insertItem({
  type: "meeting", title: "Building Committee Review",
  meetingAt: meetingTime(weeksFromNow(1), 10),
  status: "open",
  body: md(
    "## Building Committee Review\n\n" +
    "### Agenda\n\n" +
    "1. Phase 1 final walkthrough report from Apex\n" +
    "2. Phase 2 HVAC schedule confirmation (July 7 start)\n" +
    "3. ADA restroom change order: scope + elder approval path\n" +
    "4. Sunday schedule impact during HVAC work\n" +
    "5. Phase 3 (parking lot) timeline update"
  ),
  createdAt: daysAgo(3),
});

M.roger1on1 = await insertItem({
  type: "meeting", title: "1:1 with Roger Martinez",
  meetingAt: meetingTime(daysAgo(10), 10, 30),
  status: "done",
  properties: { oneOnOne: { person: "Roger Martinez", quarter: "Q2 2026" } },
  body: md(
    "## 1:1 with Roger Martinez — Q2 Check-in\n\n" +
    "### Personal check-in\n\n" +
    "Roger is energized. The fall series outline has given him a clear creative north star. " +
    "Worth noting: some friction with the sound team around scheduling (not relational — logistical). " +
    "Worth monitoring.\n\n" +
    "### Worship team health\n\n" +
    "Core team strong. Two singers taking August off (vacation, new baby). " +
    "Need to identify subs before camp.\n\n" +
    "### Development conversation\n\n" +
    "Roger asked about the learning budget for Worship Leader Summit in October (Atlanta). " +
    "All-in about $1,800. Strong ROI on his last two attendances — best networking he does. " +
    "I said yes tentatively; need to confirm budget.\n\n" +
    "### Action items\n\n" +
    "- Brandon: confirm learning budget availability for Worship Leader Summit\n" +
    "- Roger: draft August worship schedule with sub plan by June 20"
  ),
  createdAt: daysAgo(10),
  updatedAt: daysAgo(10),
});

M.interview = await insertItem({
  type: "meeting", title: "Interview: Communications Coordinator — Emma Wilson",
  meetingAt: meetingTime(daysFromNow(3), 14),
  status: "open",
  body: md(
    "## Interview: Communications Coordinator\n\n" +
    "**Candidate:** Emma Wilson\n\n" +
    "**Format:** 45-minute panel\n\n" +
    "**Panel:** Brandon Collins, Tom Bradley\n\n" +
    "### Questions\n\n" +
    "1. Tell us about a communications campaign you're proud of.\n" +
    "2. How do you approach creative work under deadline pressure?\n" +
    "3. What does effective church communications look like to you?\n" +
    "4. How do you handle feedback on your creative work?\n" +
    "5. Where do you see this role going in 2-3 years?\n\n" +
    "### After the interview\n\n" +
    "- Check references: Mark Delaney (Riverside), Pam Singh\n" +
    "- Bring hiring recommendation to elder board (July 15 meeting)\n" +
    "- If yes: elder board approved job description is already on file"
  ),
  createdAt: daysAgo(5),
});

M.retreat = await insertItem({
  type: "meeting", title: "All-Staff Retreat Planning",
  meetingAt: meetingTime(weeksFromNow(2), 9),
  status: "open",
  body: md(
    "## All-Staff Retreat Planning\n\n" +
    "### Purpose\n\n" +
    "Tom's framing: not a working retreat. Focus on spiritual formation, rest, and team health. " +
    "Minimal agenda. 1.5 days.\n\n" +
    "### Agenda items\n\n" +
    "1. Retreat date confirmation (August 19-20?)\n" +
    "2. Venue: Cedar Ridge vs. Lakeside Conference Center\n" +
    "3. Theme and possible outside facilitator\n" +
    "4. Budget (target $4,500)\n" +
    "5. Pre-retreat reflection prompt for the team"
  ),
  createdAt: daysAgo(2),
});

// ============================================================
// TASKS — 16 items (including 3 subtasks)
// ============================================================
console.log("Inserting tasks...");

const T = {};

T.sundayOutline = await insertItem({
  type: "task", title: "Prepare Sunday message outline (July 20)",
  dueDate: daysFromNow(3),
  urgency: "high",
  body: md(
    "## Prepare Sunday message outline\n\n" +
    "**Series:** Guest Sunday before Kingdom Come\n\n" +
    "**Text:** Psalm 23\n\n" +
    "### Outline draft\n\n" +
    "- Opening: The familiar made strange — what we say without meaning\n" +
    "- Point 1: The shepherd knows the sheep by name (John 10:3)\n" +
    "- Point 2: Green pastures aren't always obvious — 'makes me lie down'\n" +
    "- Point 3: The valley is the training ground, not the abandonment\n" +
    "- Close: The invitation of Psalm 23 is not 'feel better,' it's 'follow'\n\n" +
    "### Still needed\n\n" +
    "- Illustration for Point 2 (search Preaching Today)\n" +
    "- Check with Roger on worship set alignment"
  ),
  createdAt: daysAgo(4),
});

T.facilitiesProposal = await insertItem({
  type: "task", title: "Review building renovation Phase 2 proposal",
  dueDate: daysFromNow(7),
  urgency: "normal",
  body: md(
    "Review Mike's updated scope document for Phase 2.\n\n" +
    "Pay specific attention to:\n\n" +
    "- The ADA restroom change order ($18K) — elders want specifics before approving\n" +
    "- Sunday schedule impact of HVAC work (noise during 10:30am service)\n" +
    "- Updated project completion date\n\n" +
    "Bring questions to the building committee meeting next week."
  ),
  createdAt: daysAgo(3),
});

T.elderReport = await insertItem({
  type: "task", title: "Send Q2 report to elder board",
  dueDate: daysAgo(2),
  urgency: "critical",
  inbox: true,
  body: md(
    "## Q2 Report to Elder Board\n\n" +
    "**Status:** Overdue — send this week\n\n" +
    "### Sections needed\n\n" +
    "- [ ] Attendance summary (get final numbers from Tom)\n" +
    "- [x] Giving report (pulled from Pushpay — 4% ahead of budget)\n" +
    "- [ ] Staff updates\n" +
    "- [ ] Building renovation Phase 1 completion\n" +
    "- [ ] Summer camp outlook\n" +
    "- [ ] Guatemala missions update\n\n" +
    "Send as PDF to the elder board group email."
  ),
  createdAt: daysAgo(5),
});

T.crossroadsFollowup = await insertItem({
  type: "task", title: "Follow up with Crossroads Fellowship on fall collaboration",
  dueDate: daysFromNow(8),
  urgency: "normal",
  body: md(
    "Email Pastor David Kim. Two options to propose:\n\n" +
    "1. Joint block party (September, our parking lot)\n" +
    "2. Combined Thanksgiving service (November)\n\n" +
    "Also ask if Crossroads wants to co-sponsor the Guatemala trip again."
  ),
  createdAt: daysAgo(6),
});

T.annualReviews = await insertItem({
  type: "task", title: "Complete Q2 reviews for all direct reports",
  urgency: "low",
  body: md(
    "### Q2 review status\n\n" +
    "- [x] Roger Martinez\n" +
    "- [x] Sarah Chen\n" +
    "- [ ] Mike Thompson (in progress)\n" +
    "- [ ] Lisa Park\n\n" +
    "Use the standard template. Schedule 1-on-1 meetings for feedback delivery."
  ),
  createdAt: daysAgo(14),
});

T.communionSupplies = await insertItem({
  type: "task", title: "Order communion supplies for July",
  status: "done",
  body: md(
    "Order from LifeWay: communion cups (500-pack ×3) and wafers (500-pack ×2). Budget: $120.\n\n" +
    "Ordered and confirmed. Delivery expected June 25."
  ),
  createdAt: daysAgo(18),
  updatedAt: daysAgo(10),
});

T.givingTracking = await insertItem({
  type: "task", title: "Update giving campaign tracking spreadsheet",
  status: "done",
  body: md(
    "Updated Pushpay export in the giving tracker.\n\n" +
    "**Q2 final:** $148,204 (budget $142,000)\n\n" +
    "**YTD:** $286,441 (budget $276,500) — 4% ahead of plan.\n\n" +
    "Sent summary to Tom and treasurer."
  ),
  createdAt: daysAgo(9),
  updatedAt: daysAgo(7),
});

// Parent task: summer camp registration
T.campReg = await insertItem({
  type: "task", title: "Finalize summer camp registration (target: 80 families)",
  dueDate: weeksFromNow(2),
  urgency: "high",
  body: md(
    "## Finalize Summer Camp Registration\n\n" +
    "**Goal:** 80 families registered by August 1 (Cedar Ridge roster deadline)\n\n" +
    "**Current:** 31 families\n\n" +
    "Sarah is primary lead. Brandon's role: unblock, review communications, approve budget.\n\n" +
    "See subtasks."
  ),
  createdAt: weeksAgo(3),
});

// Subtasks of camp registration
T.campRegForm = await insertItem({
  type: "task", title: "Create online registration form",
  status: "done",
  parentId: T.campReg,
  body: md(
    "Built in Church Community Builder. Includes T-shirt sizing, medical/allergy, emergency contacts. " +
    "Live at edgewoodcommunity.org/camp. 31 families registered so far."
  ),
  createdAt: weeksAgo(3),
  updatedAt: weeksAgo(2),
});

T.campPayment = await insertItem({
  type: "task", title: "Set up camp payment portal (Pushpay)",
  parentId: T.campReg,
  dueDate: daysFromNow(7),
  body: md(
    "Configure Pushpay fund: $350/family with $100 deposit option and payment plan.\n\n" +
    "Test with a dummy transaction before announcing."
  ),
  createdAt: weeksAgo(2),
});

T.campEmail = await insertItem({
  type: "task", title: "Send camp registration announcement to congregation",
  parentId: T.campReg,
  dueDate: daysFromNow(5),
  urgency: "high",
  body: md(
    "Send to full congregation email list.\n\n" +
    "Highlights to include:\n\n" +
    "- Theme: Rooted (Colossians 2:6-7)\n" +
    "- Dates: August 10-14, Cedar Ridge Camp\n" +
    "- Early bird pricing ends July 15\n" +
    "- Family testimonials from last year's camp\n\n" +
    "Ask Roger for 2-3 photos from the 2025 camp for the header image."
  ),
  createdAt: weeksAgo(2),
});

T.kingdomComeReview = await insertItem({
  type: "task", title: "Review Kingdom Come outline with Tom",
  dueDate: daysFromNow(1),
  urgency: "high",
  body: md(
    "Schedule 30 minutes with Tom. Key questions:\n\n" +
    "1. Week 4 guest speaker: Phil Bowman (Providence Church)? Need to confirm availability.\n" +
    "2. Small group curriculum: build internally (6 discussion guides) or license RightNow Media?\n" +
    "3. Baptism Sunday: integrate into week 6 or keep separate?"
  ),
  createdAt: daysAgo(2),
});

T.contractorContact = await insertItem({
  type: "task", title: "Confirm Phase 2 start date with Apex Construction",
  status: "done",
  body: md(
    "Called Jim Carey (Apex). July 7 start confirmed. " +
    "Sending revised Phase 2 milestone schedule by end of week. " +
    "HVAC crew has confirmed availability with Blue Ridge."
  ),
  createdAt: daysAgo(8),
  updatedAt: daysAgo(6),
});

T.elderAgenda = await insertItem({
  type: "task", title: "Draft elder board agenda for July 15 meeting",
  dueDate: daysFromNow(5),
  urgency: "normal",
  inbox: true,
  body: md(
    "## Elder Board Meeting — July 15 Agenda (Draft)\n\n" +
    "1. Opening / devotional (Tom) — 10 min\n" +
    "2. Q2 financial and ministry report (Brandon) — 15 min\n" +
    "3. Building Phase 2 update (Brandon + Mike) — 10 min\n" +
    "4. Communications coordinator hire decision — 10 min\n" +
    "5. Vision Sunday planning — 15 min\n" +
    "6. Guatemala budget question (from Elder Jim Hartley) — 5 min\n" +
    "7. Prayer / close\n\n" +
    "Send to Tom for review 5 days before distribution."
  ),
  createdAt: daysAgo(1),
});

T.annualReport = await insertItem({
  type: "task", title: "Prepare 2025-2026 annual report (for Vision Sunday)",
  dueDate: weeksFromNow(3),
  urgency: "normal",
  body: md(
    "Distributed at Vision Sunday (July 27).\n\n" +
    "### Sections\n\n" +
    "- Message from the pastors (Tom writes, I review)\n" +
    "- Year in numbers: attendance, giving, baptisms, groups\n" +
    "- Ministry highlights (one per ministry area)\n" +
    "- Building renovation progress\n" +
    "- Looking forward: 2026-2027\n" +
    "- Financials summary\n\n" +
    "Design: if Emma joins as communications coordinator, ask her to template it. " +
    "Otherwise use last year's InDesign file."
  ),
  createdAt: weeksAgo(1),
});

T.mikeReview = await insertItem({
  type: "task", title: "Complete Q2 review with Mike Thompson",
  dueDate: daysFromNow(4),
  urgency: "normal",
  body: md(
    "## Mike Thompson — Q2 Review Prep\n\n" +
    "### Strengths this quarter\n\n" +
    "- Phase 1 construction on time and $3,800 under budget\n" +
    "- Strong contractor relationship management (Apex, Blue Ridge)\n" +
    "- Improved facilities request turnaround (avg down from 8 days to 4)\n\n" +
    "### Growth areas\n\n" +
    "- Communication with staff about construction noise/disruption — surprises undermine trust\n" +
    "- Delegation: still doing too much himself; facilities team has capacity\n\n" +
    "### Development conversation\n\n" +
    "Would benefit from a project management course. Explore interest and identify an option."
  ),
  createdAt: weeksAgo(2),
});

// ============================================================
// NOTES — 5 items
// ============================================================
console.log("Inserting notes...");

const N = {};

N.goodShepherd = await insertItem({
  type: "note", title: "The Good Shepherd — Sermon Notes",
  body: md(
    "# The Good Shepherd\n\n" +
    "**Text:** Psalm 23 / John 10:1-18\n\n" +
    "**Date preached:** June 1, 2026\n\n" +
    "---\n\n" +
    "## Introduction\n\n" +
    '"The Lord is my shepherd" — six words that have comforted more people in more ' +
    "moments of crisis than perhaps any other sentence in human history. But familiarity " +
    "is the enemy of meaning.\n\n" +
    "We say these words the way we say 'I'm fine.' Automatically. Without weight.\n\n" +
    "What if we slowed down?\n\n" +
    "---\n\n" +
    "## The image\n\n" +
    "Shepherding was dirty, dangerous work. First-century listeners wouldn't have " +
    "romanticized this. Shepherds:\n\n" +
    "- Slept in fields\n" +
    "- Knew each animal's habits, injuries, tendencies\n" +
    "- Put their bodies between the flock and the threat\n\n" +
    "This is not a sentimental image. This is costly love.\n\n" +
    "---\n\n" +
    "## Point 1: The shepherd knows you by name\n\n" +
    "John 10:3 — *He calls his own sheep by name.*\n\n" +
    "Not by category. Not by row. By name.\n\n" +
    "**Illustration:** [story of the surgeon who memorized every patient's name — search archive]\n\n" +
    "The creator of the universe is not managing a flock. He is tending a person.\n\n" +
    "---\n\n" +
    "## Point 2: Green pastures aren't always obvious\n\n" +
    "Psalm 23:2 — *He makes me lie down in green pastures.*\n\n" +
    "Note: 'makes me.' The sheep doesn't always see the pasture for what it is. " +
    "The shepherd leads toward rest the sheep wouldn't choose on its own.\n\n" +
    "**Application:** What am I resisting right now that might be provision?\n\n" +
    "---\n\n" +
    "## Point 3: The valley is the training ground\n\n" +
    "Psalm 23:4 — *Even though I walk through the darkest valley...*\n\n" +
    "*Through* — not around. The shepherd doesn't eliminate the valley. He walks through it with us.\n\n" +
    "The rod and staff are tools of guidance and protection, not comfort objects. " +
    "The shepherd is working, even in the dark.\n\n" +
    "---\n\n" +
    "## Close\n\n" +
    "The question isn't whether life has a shepherd. It's who yours is.\n\n" +
    "The invitation of Psalm 23 is not 'feel better.' It's 'follow.'"
  ),
  createdAt: daysAgo(13),
});

N.staffMtgJune = await insertItem({
  type: "note", title: "Staff Meeting Notes — June 2026",
  body: md(
    "# Staff Meeting Notes — June 2026\n\n" +
    "Running notes from the June staff meetings.\n\n" +
    "---\n\n" +
    "## June 9\n\n" +
    "- **Roger:** Confirmed fall series worship plan. Sound board feedback at 8am " +
    "service — three consecutive weeks. Mike to investigate.\n" +
    "- **Sarah:** 31 camp registrations. Targeting 50 by July 1. Needs help drafting " +
    "the announcement email.\n" +
    "- **Mike:** Phase 1 wrapping up well. Phase 2 HVAC starts July 7. ADA restroom " +
    "change order coming — requires elder approval (~$18K).\n" +
    "- **Lisa:** Q2 youth survey: 78% satisfaction (down from 84%). Main theme: " +
    "'wants more community outside of Sunday.'\n\n" +
    "---\n\n" +
    "## June 3\n\n" +
    "- Q2 giving: 4% ahead of budget. Strong generosity culture.\n" +
    "- Vision Sunday format: celebration-first, vision second. Pilot with elders in July.\n" +
    "- Communications finalist pool finalized: 3 candidates. Scheduling panel interviews.\n" +
    "- Prayer focus: families preparing for summer camp; summer staff energy."
  ),
  createdAt: daysAgo(4),
});

N.kingdomComeIdeas = await insertItem({
  type: "note", title: "Kingdom Come — Ideas and Resources",
  body: md(
    "# Kingdom Come — Working Ideas\n\n" +
    "*For fall series prep. Not final.*\n\n" +
    "---\n\n" +
    "## Illustration candidates\n\n" +
    "- **Week 1 (Beatitudes):** Mandela choosing not to be embittered — " +
    "power of meekness and the counterintuitive kingdom\n" +
    "- **Week 3 (Better righteousness):** The difference between rule-following " +
    "and heart-change — the tax reform analogy could work here\n" +
    "- **Week 5 (Treasure):** The investor who liquidated everything to return " +
    "to family farming — NYT Magazine 2023, find the link\n\n" +
    "## Guest speaker (Week 4)\n\n" +
    "Tom mentioned Phil Bowman (Providence Church). Preached a strong series " +
    "on the Lord's Prayer last year. Check availability for October 18.\n\n" +
    "## Small group curriculum options\n\n" +
    "1. Build internally: 6 discussion guides (2-3 pages each) tied to each sermon\n" +
    "2. License from RightNow Media: several Sermon on the Mount options available\n" +
    "3. Commission a designer (Emma Wilson if hired?)\n\n" +
    "## Per-week worship themes (Roger's initial ideas)\n\n" +
    "- Week 1: *Build My Life* + older hymn on the Beatitudes\n" +
    "- Week 6: *Yet Not I But Through Christ in Me* — strong thematic fit for the narrow gate\n\n" +
    "## Video possibilities\n\n" +
    "Weeks 2 and 5: short 90-second 'person on the street' answers to " +
    "questions like 'What does a good life look like to you?'"
  ),
  createdAt: weeksAgo(1),
});

N.teamCulture = await insertItem({
  type: "note", title: "Reflection: Staff Culture Health Check",
  inbox: true,
  body: md(
    "# Staff Culture Health Check\n\n" +
    "*Written for myself — quarterly gut check. Not for distribution.*\n\n" +
    "---\n\n" +
    "## What's strong\n\n" +
    "The team genuinely likes each other. The humor in staff meetings is real, " +
    "not performative. Roger and Sarah have developed a natural partnership " +
    "around family programming that neither of us planned. Mike is growing into " +
    "his voice in leadership conversations — less 'I just do what I'm told' energy.\n\n" +
    "## What concerns me\n\n" +
    "Lisa is isolated. Youngest, newest, and her ministry sits adjacent to " +
    "everyone else's but doesn't intersect naturally. I need to be more intentional. " +
    "Also, a 'Tom's vision / Brandon's execution' dynamic is forming that I want " +
    "to interrupt before it calcifies. We're not a CEO-COO structure.\n\n" +
    "## What I'm watching\n\n" +
    "The sound board issue Roger raised. On the surface it's a facilities matter. " +
    "But if it keeps happening, it becomes a 'Mike doesn't respond' narrative, " +
    "which becomes a team division story.\n\n" +
    "## What I want to do\n\n" +
    "1. Propose a monthly team dinner — casual, no agenda\n" +
    "2. Rotate the staff devotional: each person leads once per quarter\n" +
    "3. Have a direct conversation with Lisa about how she's really doing, " +
    "without it feeling like a performance review"
  ),
  createdAt: daysAgo(3),
});

N.buildingReq = await insertItem({
  type: "note", title: "Building Renovation — Requirements Log",
  body: md(
    "# Building Renovation Requirements\n\n" +
    "*Capturing requirements, decisions, and constraints as they emerge.*\n\n" +
    "---\n\n" +
    "## ADA compliance\n\n" +
    "- Both restrooms (men's and women's) require full ADA renovation\n" +
    "- Contractor's original quote excluded one restroom — change order incoming (~$18K)\n" +
    "- Elder board must approve (over $10K threshold per policy)\n" +
    "- Hard deadline: complete before December per occupancy permit\n\n" +
    "## HVAC\n\n" +
    "- Current system: 22 years old, uses R-22 refrigerant (phased out)\n" +
    "- Blue Ridge Systems quote: $62,000 full sanctuary replacement\n" +
    "- Side benefit: improved air quality in children's areas\n" +
    "- Scheduling constraint: no HVAC work during Sunday services\n\n" +
    "## Children's wing\n\n" +
    "- 2,400 sq ft addition; code requires sprinklers throughout\n" +
    "- 3 classrooms + dedicated check-in lobby\n" +
    "- Furniture not included in renovation contract (separate budget: ~$15K)\n\n" +
    "## Parking\n\n" +
    "- Resurfacing + 12 new spaces; ADA count goes from 4 to 7 (code requirement)\n" +
    "- Phase 3 start: September — won't impact summer programming"
  ),
  createdAt: weeksAgo(2),
});

// ============================================================
// LINKS — 5 items
// ============================================================
console.log("Inserting links...");

const L = {};

L.bibleGateway = await insertItem({
  type: "link", title: "Matthew 6-7 — Bible Gateway (NIV)",
  url: "https://www.biblegateway.com/passage/?search=Matthew+6-7&version=NIV",
  body: md("Sermon on the Mount core texts for Kingdom Come series. Covers the Lord's Prayer, treasure and anxiety, and the narrow gate."),
  createdAt: weeksAgo(1),
});

L.preachingToday = await insertItem({
  type: "link", title: "Preaching Today — Illustration archive",
  url: "https://www.preachingtoday.com",
  body: md("Primary illustration research resource. Currently searching for Psalm 23 and 'green pastures' content for the Good Shepherd message."),
  createdAt: weeksAgo(3),
});

L.rightNowMedia = await insertItem({
  type: "link", title: "RightNow Media — Sermon on the Mount studies",
  url: "https://www.rightnowmedia.org",
  body: md("Evaluating for Kingdom Come small group curriculum. Several Sermon on the Mount options. Need to review with Tom before committing."),
  createdAt: weeksAgo(1),
});

L.campVendorQuote = await insertItem({
  type: "link", title: "Cedar Ridge Camp — 2026 Group Rate Quote",
  url: "https://www.cedarridgecamp.org/groups",
  body: md("Quote valid through June 30. $225/person for 5-day program (min 40 guests). Includes meals, lodging, and programming staff. Contact: groups@cedarridgecamp.org"),
  createdAt: weeksAgo(4),
});

L.adaStandards = await insertItem({
  type: "link", title: "ADA Standards for Accessible Design — Restrooms",
  url: "https://www.ada.gov/law-and-regs/design-standards/",
  body: md("Reference for the ADA restroom renovation. Specifically section 213 (toilet rooms and bathing rooms). Mike has a printed copy."),
  createdAt: weeksAgo(2),
});

// ============================================================
// RELATIONS
// ============================================================
console.log("Inserting relations...");

// Staff meetings — all direct reports as attendees
for (const meetingId of [M.staff1, M.staff2, M.staff3, M.staff4]) {
  for (const personId of [E.roger, E.sarah, E.mike, E.lisa, E.tom]) {
    await rel(meetingId, personId, "attendee");
  }
}

// Elder board meeting
await rel(M.elderQ2, E.tom, "attendee");
// Suggested: building reno was discussed (not manually tagged)
await rel(M.elderQ2, E.buildingReno, "tagged", "suggested");

// Building committee meetings
for (const m of [M.building1, M.building2]) {
  await rel(m, E.mike, "attendee");
  await rel(m, E.buildingReno, "tagged");
}

// 1:1 with Roger
await rel(M.roger1on1, E.roger, "attendee");
await rel(M.roger1on1, E.staffDev, "tagged");

// Interview
await rel(M.interview, E.emma, "attendee");
await rel(M.interview, E.tom, "attendee");

// Retreat planning
for (const personId of [E.roger, E.sarah, E.mike, E.lisa]) {
  await rel(M.retreat, personId, "attendee");
}
await rel(M.retreat, E.staffDev, "tagged");

// Tasks
await rel(T.sundayOutline, E.kingdomCome, "tagged");
await rel(T.facilitiesProposal, E.buildingReno, "tagged");
await rel(T.facilitiesProposal, E.mike, "tagged");
await rel(T.elderReport, E.tom, "tagged");
await rel(T.elderReport, E.buildingReno, "tagged", "suggested");
await rel(T.crossroadsFollowup, E.crossroads, "tagged");
await rel(T.annualReviews, E.staffDev, "tagged");
await rel(T.campReg, E.summerCamp, "tagged");
await rel(T.campReg, E.sarah, "tagged");
await rel(T.campEmail, E.summerCamp, "tagged");
await rel(T.campEmail, E.roger, "tagged");
await rel(T.kingdomComeReview, E.kingdomCome, "tagged");
await rel(T.kingdomComeReview, E.tom, "tagged");
await rel(T.contractorContact, E.buildingReno, "tagged");
await rel(T.mikeReview, E.mike, "tagged");
await rel(T.mikeReview, E.staffDev, "tagged");
await rel(T.elderAgenda, E.tom, "tagged");
// Task referencing an upcoming meeting
await rel(T.sundayOutline, M.staff4, "references");

// Notes
await rel(N.goodShepherd, E.kingdomCome, "tagged");
await rel(N.staffMtgJune, M.staff3, "references");
await rel(N.staffMtgJune, M.staff2, "references");
await rel(N.kingdomComeIdeas, E.kingdomCome, "tagged");
await rel(N.kingdomComeIdeas, E.roger, "tagged");
await rel(N.buildingReq, E.buildingReno, "tagged");
await rel(N.buildingReq, E.mike, "tagged");
await rel(N.teamCulture, E.staffDev, "tagged");
// Suggested: team culture note is about Lisa
await rel(N.teamCulture, E.lisa, "tagged", "suggested");

// Links
await rel(L.bibleGateway, E.kingdomCome, "tagged");
await rel(L.bibleGateway, N.goodShepherd, "references");
await rel(L.preachingToday, N.goodShepherd, "references");
await rel(L.rightNowMedia, E.kingdomCome, "tagged");
await rel(L.campVendorQuote, E.summerCamp, "tagged");
await rel(L.adaStandards, E.buildingReno, "tagged");

// Summary
const counts = await sql`
  SELECT type, count(*) FROM items WHERE owner_id = ${ownerId} AND deleted_at IS NULL
  GROUP BY type ORDER BY type
`;
const relCount = await sql`
  SELECT count(*) FROM relations r
  JOIN items i ON i.id = r.source_id WHERE i.owner_id = ${ownerId}
`;
console.log("\nTest data loaded:");
for (const row of counts) {
  console.log(`  ${row.type.padEnd(10)} ${row.count}`);
}
console.log(`  ${"relations".padEnd(10)} ${relCount[0].count}`);
console.log("\nDone.");
