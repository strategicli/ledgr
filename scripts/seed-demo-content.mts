// One-off demo content for exploring the Songs + Papers modules. Creates a
// couple of song items (ChordPro bodies) and a paper item (markdown draft +
// outline + quote-bank scaffold in properties) owned by the v1 user, via the
// app's own createItem so they get body_text/FTS, a revision, and mention-sync
// like any real item. Idempotent-ish: skips a title that already exists for the
// owner (re-runnable without piling up duplicates).
//
//   npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/seed-demo-content.mts
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../src/db";
import { items } from "../src/db/schema";
import { createItem } from "../src/lib/items";
import { CHORDPRO_FORMAT } from "../src/lib/chordpro/types";
import type { QuoteEntry } from "../src/lib/papers/types";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example / runbook §1.");
  process.exit(1);
}
const hostname = new URL(url).hostname;
if (hostname.endsWith(".neon.tech") && !hostname.includes("-pooler")) {
  console.error("DATABASE_URL must be the Neon pooler connection string.");
  process.exit(1);
}

const OWNER_EMAIL =
  process.env.DEV_USER_EMAIL ||
  process.env.ONEDRIVE_EXPORT_UPN ||
  "brandoncollins@edgewoodcommunity.org";

const sql = neon(url);
const ownerRows = await sql`SELECT id FROM users WHERE email = ${OWNER_EMAIL}`;
if (ownerRows.length === 0) {
  console.error(`No users row for ${OWNER_EMAIL}. Run npm run db:seed first.`);
  process.exit(1);
}
const ownerId = ownerRows[0].id as string;

const db = getDb();
async function ensure(title: string, make: () => Promise<unknown>) {
  const existing = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.ownerId, ownerId),
        eq(items.title, title),
        isNull(items.deletedAt)
      )
    );
  if (existing.length > 0) {
    console.log(`skip (exists): ${title}`);
    return;
  }
  await make();
  console.log(`created: ${title}`);
}

// ── Songs ────────────────────────────────────────────────────────────────────
const THIS_IS_OUR_GOD = `{title: This Is Our God}
{artist: Phil Wickham}
{key: Bb}
{capo: 3}
{tempo: 80}
{time: 4/4}
{ccli: 7211413}

{section: Verse 1}
[G]Remember those walls
That we called sin and shame

{section: Chorus}
[G/B]This is our [C2]God, this is who He [G]is
He [G/D]loves [D]us

{section: Verse 2}
[G]Remember those giants
We called [Gsus]death and [G]grave

{repeat: Chorus}`;

const CORNERSTONE = `{title: Cornerstone}
{artist: Hillsong}
{key: C}
{tempo: 70}
{time: 4/4}

{section: Verse 1}
My [C]hope is built on nothing [F]less
Than [C]Jesus' blood and righteous[G]ness

{section: Chorus}
Christ a[F]lone, corner[C]stone
[F]Weak made strong in the [G]Saviour's love

{section: Verse 2}
When [C]darkness seems to hide His [F]face
I [C]rest on His unchanging [G]grace`;

await ensure("This Is Our God", () =>
  createItem(ownerId, {
    type: "song",
    title: "This Is Our God",
    body: { format: CHORDPRO_FORMAT, text: THIS_IS_OUR_GOD },
  })
);
await ensure("Cornerstone", () =>
  createItem(ownerId, {
    type: "song",
    title: "Cornerstone",
    body: { format: CHORDPRO_FORMAT, text: CORNERSTONE },
  })
);

// ── Paper ──────────────────────────────────────────────────────────────────
const quoteBank: QuoteEntry[] = [
  {
    id: "q1",
    source: {
      kind: "book",
      author: "Patrick Schreiner",
      authorLast: "Schreiner",
      title: "The Visual Word: Illustrated Outlines of the New Testament Books",
      shortTitle: "The Visual Word",
      city: "Chicago",
      publisher: "Moody",
      year: "2021",
    },
    page: "112",
    text: "The letters of the New Testament are occasional documents, written into specific situations rather than as timeless treatises.",
  },
  {
    id: "q2",
    source: {
      kind: "book",
      author:
        "Andreas J. Köstenberger, L. Scott Kellum, and Charles L. Quarles",
      authorLast: "Köstenberger, Kellum, and Quarles",
      title:
        "The Cradle, the Cross, and the Crown: An Introduction to the New Testament",
      shortTitle: "The Cradle, the Cross, and the Crown",
      city: "Nashville",
      publisher: "B&H Academic",
      year: "2016",
    },
    page: "742",
    text: "First Peter addresses believers scattered as exiles, framing their suffering within the larger story of Christ's own suffering and vindication.",
  },
];

const draft = `Peter writes to believers scattered across Asia Minor, and from the
opening greeting he frames their identity as exiles whose true citizenship is
secured in Christ.[^1] The letter's pastoral aim is to steady a suffering church
without explaining suffering away.

The structure moves from identity to conduct: because they are a chosen people,
they live as sojourners whose good works answer the watching world.[^2]

[^1]: Patrick Schreiner, *The Visual Word* (Chicago: Moody, 2021), 112.
[^2]: Andreas J. Köstenberger, L. Scott Kellum, and Charles L. Quarles, *The Cradle, the Cross, and the Crown* (Nashville: B&H Academic, 2016), 742.
`;

const outline = `# A Teaching Overview of First Peter

## Introduction
- Author, audience (exiles of the dispersion), occasion
- Thesis: suffering reframed by the gospel

## Body
### 1. Identity before conduct (1:1-2:10)
- Living hope, holy people
### 2. Conduct in a watching world (2:11-4:11)
- Submission, suffering, stewardship
### 3. Suffering and shepherding (4:12-5:14)
- The fiery trial; elders and humility

## Conclusion
- The God of all grace restores
`;

await ensure("A Teaching Overview of First Peter", () =>
  createItem(ownerId, {
    type: "paper",
    title: "A Teaching Overview of First Peter",
    body: { format: "markdown", text: draft },
    properties: {
      school: "Midwestern Baptist Theological Seminary",
      paper_type: "A Teaching Overview",
      course: "NT 5183 New Testament Survey II",
      author: "Brandon Collins",
      location: "Kansas City, Missouri",
      paper_date: "June 14, 2026",
      stage: "drafting",
      outline,
      quoteBank,
    },
  })
);

console.log("Demo content seed complete.");
