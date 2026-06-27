// ADR-126 verification: large-body handling on the MCP get_item read path.
// Two layers: (1) the pure windowBody/BODY_WINDOW_CHARS helpers in src/lib/body.ts
// (no DB), and (2) get_item end-to-end against live Neon — a normal body comes
// back whole and byte-identical (no bodyInfo), while a >threshold body is paged
// (truncation marker + bodyInfo), and walking nextOffset reassembles the exact
// original text. Owner scoping is re-checked. Creates one temp owner, cleans up.
// Run:  npx tsx scripts/verify-mcp-large-body.mts
// Safe to delete once the slice is closed.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { eq } = await import("drizzle-orm");
const { callTool } = await import("../src/lib/mcp/tools");
const { windowBody, BODY_WINDOW_CHARS, LARGE_BODY_THRESHOLD, isLargeBody } = await import(
  "../src/lib/body"
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

type Json = Record<string, unknown>;
async function callJson(o: string, name: string, args: Json): Promise<Json> {
  const r = await callTool(o, name, args);
  if (r.isError) throw new Error(`tool ${name} unexpectedly errored: ${r.content[0]?.text}`);
  return JSON.parse(r.content[0].text) as Json;
}

// --- pure helper: windowBody / BODY_WINDOW_CHARS (no DB) -------------------
check("BODY_WINDOW_CHARS lines up with the large-body threshold", BODY_WINDOW_CHARS === LARGE_BODY_THRESHOLD);

// A short body fits in one window from offset 0: slice === source, not truncated.
const shortText = "Discuss the Zentaur **budget**.";
const wShort = windowBody(shortText);
check("windowBody returns a short body whole", wShort.text === shortText && !wShort.truncated && wShort.nextOffset === null && wShort.offset === 0 && wShort.returnedChars === shortText.length && wShort.totalChars === shortText.length);

// A body past the window truncates and points at the next offset.
const big = "x".repeat(BODY_WINDOW_CHARS * 2 + 123);
const w0 = windowBody(big);
check("windowBody truncates a large body at the window size", w0.returnedChars === BODY_WINDOW_CHARS && w0.truncated && w0.nextOffset === BODY_WINDOW_CHARS && w0.totalChars === big.length);
const w1 = windowBody(big, { offset: w0.nextOffset! });
check("windowBody second window starts at nextOffset", w1.offset === BODY_WINDOW_CHARS && w1.truncated && w1.nextOffset === BODY_WINDOW_CHARS * 2);
const w2 = windowBody(big, { offset: w1.nextOffset! });
check("windowBody final window is the remainder, not truncated", w2.returnedChars === 123 && !w2.truncated && w2.nextOffset === null);
check("windowBody windows reassemble to the full body", w0.text + w1.text + w2.text === big);

// limit is clamped to [1, BODY_WINDOW_CHARS]; offset is clamped to [0, total].
check("windowBody honors a smaller bodyLimit", windowBody(big, { limit: 10 }).returnedChars === 10);
check("windowBody clamps an over-large bodyLimit to the window", windowBody(big, { limit: BODY_WINDOW_CHARS * 5 }).returnedChars === BODY_WINDOW_CHARS);
check("windowBody clamps a negative offset to 0", windowBody(big, { offset: -50 }).offset === 0);
const wOver = windowBody(big, { offset: big.length + 1000 });
check("windowBody clamps an over-large offset to the end (empty, not truncated)", wOver.offset === big.length && wOver.returnedChars === 0 && !wOver.truncated && wOver.nextOffset === null);

// --- get_item end-to-end against live Neon --------------------------------
const db = getDb();
const stamp = Date.now();
const [owner] = await db.insert(users).values({ email: `verify-lgbody-${stamp}@example.invalid` }).returning({ id: users.id });
const [owner2] = await db.insert(users).values({ email: `verify-lgbody2-${stamp}@example.invalid` }).returning({ id: users.id });
const ownerId = owner.id;
const owner2Id = owner2.id;

try {
  // A normal-size note: get_item returns it whole, byte-identical, no bodyInfo.
  const smallBody = "Discuss the Zentaur **budget**.";
  const small = await callJson(ownerId, "create_item", { type: "note", title: `Small ${stamp}`, bodyMarkdown: smallBody });
  check("small body is below the large-body threshold (sanity)", !isLargeBody(smallBody));
  const smallGot = await callJson(ownerId, "get_item", { id: small.id as string });
  check("get_item returns a normal body verbatim (unchanged contract)", smallGot.body === smallBody);
  check("get_item omits bodyInfo for a normal body", !("bodyInfo" in smallGot));

  // A large note (> threshold): unique per-window content so we can prove the
  // exact text is preserved across paging. ~2.5 windows.
  const para = (n: number) => `# Section ${n}\n\nParagraph ${n} body text. `.padEnd(1000, `${n}`);
  let bigBody = "";
  for (let i = 0; bigBody.length < BODY_WINDOW_CHARS * 2 + 5000; i++) bigBody += para(i);
  check("large body is at/above the threshold (sanity)", isLargeBody(bigBody));
  const big = await callJson(ownerId, "create_item", { type: "note", title: `Big ${stamp}`, bodyMarkdown: bigBody });

  // First read: no offset → windowed automatically because the body is large.
  const p0 = await callJson(ownerId, "get_item", { id: big.id as string });
  const info0 = p0.bodyInfo as Json;
  check("get_item windows a large body without any offset arg", !!info0 && info0.offset === 0 && info0.truncated === true);
  check("get_item reports the true total length", info0.totalChars === bigBody.length);
  check("get_item returns at most one window of source", (info0.returnedChars as number) === BODY_WINDOW_CHARS);
  check("get_item appends a truncation marker pointing at nextOffset", typeof p0.body === "string" && (p0.body as string).includes("truncated") && (p0.body as string).includes(`bodyOffset=${info0.nextOffset}`));
  // The bare source slice is the first returnedChars of body (marker is appended).
  check("get_item body slice matches the source head", (p0.body as string).slice(0, info0.returnedChars as number) === bigBody.slice(0, info0.returnedChars as number));

  // Walk nextOffset to the end and reassemble the exact original text.
  let assembled = "";
  let offset: number | null = 0;
  let pages = 0;
  while (offset !== null) {
    const page: Json = await callJson(ownerId, "get_item", { id: big.id as string, bodyOffset: offset });
    const info = page.bodyInfo as Json;
    assembled += (page.body as string).slice(0, info.returnedChars as number);
    offset = info.nextOffset as number | null;
    pages += 1;
    if (pages > 50) throw new Error("paging did not terminate");
  }
  check("paging through nextOffset reassembles the exact body", assembled === bigBody, `${assembled.length} vs ${bigBody.length}`);
  check("a >2-window body took at least 3 reads", pages >= 3, `pages=${pages}`);

  // bodyLimit pages a large body in smaller, lighter reads.
  const limited = await callJson(ownerId, "get_item", { id: big.id as string, bodyLimit: 5000 });
  const limInfo = limited.bodyInfo as Json;
  check("get_item honors a smaller bodyLimit", limInfo.returnedChars === 5000 && limInfo.nextOffset === 5000 && limInfo.truncated === true);

  // The final window (offset near the end) is not truncated and ends paging.
  const tailOffset = bigBody.length - 100;
  const tail = await callJson(ownerId, "get_item", { id: big.id as string, bodyOffset: tailOffset });
  const tailInfo = tail.bodyInfo as Json;
  check("get_item final window is not truncated and has null nextOffset", tailInfo.truncated === false && tailInfo.nextOffset === null && tailInfo.returnedChars === 100);

  // Explicit paging on a SMALL body still works (and is honored even though the
  // body would otherwise return whole): a tiny limit truncates it.
  const smallPaged = await callJson(ownerId, "get_item", { id: small.id as string, bodyLimit: 5 });
  const smallPagedInfo = smallPaged.bodyInfo as Json;
  check("get_item pages a small body when the caller asks (bodyLimit)", smallPagedInfo.returnedChars === 5 && smallPagedInfo.truncated === true && (smallPaged.body as string).startsWith(smallBody.slice(0, 5)));

  // Owner scoping holds on the windowed path.
  await (async () => {
    const r = await callTool(owner2Id, "get_item", { id: big.id as string });
    check("owner2 cannot get_item owner1's large item", r.isError === true, r.isError ? r.content[0].text : "did not error");
  })();
} finally {
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, owner2Id));
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(users).where(eq(users.id, owner2Id));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
