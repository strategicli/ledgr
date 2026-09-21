// Verification for create_item's `surface` argument and the export_item tool
// (2026-09-21, ADR-183 carve-out, the ADR-260/261 tail). Drives the real
// dispatcher (callTool) against live Neon under a throwaway owner; cleans up in
// finally. DB-backed, so it is not in verify:ci.
// Run: npx tsx scripts/verify-mcp-export.mts
/* eslint-disable @typescript-eslint/no-explicit-any -- dev-only harness over the
   untyped MCP wire; never ships in the app bundle. */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { callTool, listToolDefs } = await import("../src/lib/mcp/tools");
const { getItem } = await import("../src/lib/items");
const { CHORDPRO_FORMAT } = await import("../src/lib/chordpro/types");
const { eq: dEq, inArray } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${String(detail)}` : ""}`);
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? "" : `got ${a}, want ${e}`);
}

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-mcp-export-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-mcp-export-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

async function call(ownerId: string, name: string, args: Record<string, unknown>) {
  const res = await callTool(ownerId, name, args);
  if (res.isError) throw new Error(`${name}: ${res.content[0]?.text}`);
  return JSON.parse(res.content[0].text) as Record<string, any>;
}
async function callErr(ownerId: string, name: string, args: Record<string, unknown>) {
  const res = await callTool(ownerId, name, args);
  if (!res.isError) throw new Error(`${name}: expected an error, got ${res.content[0]?.text}`);
  return res.content[0].text;
}

const CHART = "{title: Verify Song}\n[G]Amazing [C]grace how [G]sweet the [D]sound";

try {
  console.log("\n# Registration");
  {
    const names = (await listToolDefs(owner.id)).map((d) => d.name);
    check("tools/list advertises export_item", names.includes("export_item"));
    const create = (await listToolDefs(owner.id)).find((d) => d.name === "create_item")!;
    const props = (create.inputSchema as any).properties;
    check("create_item takes surface + content", "surface" in props && "content" in props);
  }

  console.log("\n# list_types advertises exports");
  {
    const typesOut = await call(owner.id, "list_types", {});
    const list: any[] = Array.isArray(typesOut) ? typesOut : (typesOut.types as any[]);
    const song = list.find((t) => t.key === "song");
    const paper = list.find((t) => t.key === "paper");
    const task = list.find((t) => t.key === "task");
    eq("song offers the Planning Center ChordPro export", song?.exports?.map((e: any) => e.id), ["song-chordpro-pco"]);
    eq("paper offers the .docx export", paper?.exports?.map((e: any) => e.id), ["docx"]);
    check("a plain type advertises no exports key", task && !("exports" in task));
  }

  console.log("\n# create_item with a surface");
  {
    const song = await call(owner.id, "create_item", { type: "song", title: `Verify song ${stamp}`, surface: "chart", content: CHART });
    const row = await getItem(owner.id, song.id);
    eq("a song created via surface=chart stores the chart as its body", (row.body as any).text, CHART);
    eq("…stamped with the type's canonical format", (row.body as any).format, CHORDPRO_FORMAT);

    const paper = await call(owner.id, "create_item", {
      type: "paper",
      title: `Verify paper ${stamp}`,
      bodyMarkdown: "Draft opening line.[^1]\n\n[^1]: A. Author, *Book* (City: Press, 2020), 4.",
      surface: "notes",
      content: "Thinking goes here.",
    });
    const prow = await getItem(owner.id, paper.id);
    eq("a paper created via surface=notes lands the text in properties.notes", (prow.properties as any)?.notes, "Thinking goes here.");
    check("…and the body stays the draft passed as bodyMarkdown", (prow.body as any).text.startsWith("Draft opening line."));

    const half = await callErr(owner.id, "create_item", { type: "paper", title: "x", surface: "notes" });
    check("surface without content is refused", /go together/.test(half), half);
    const unknown = await callErr(owner.id, "create_item", { type: "paper", title: "x", surface: "bogus", content: "y" });
    check("an unknown surface is refused with the real list", /unknown surface 'bogus'.*notes/.test(unknown), unknown);
    const ro = await callErr(owner.id, "create_item", { type: "paper", title: "x", surface: "quotes", content: "y" });
    check("a read-only surface is refused with the writable list", /read-only/.test(ro), ro);
    const both = await callErr(owner.id, "create_item", { type: "song", title: "x", surface: "chart", content: CHART, bodyMarkdown: "also" });
    check("bodyMarkdown plus a body surface is refused", /not both/.test(both), both);

    console.log("\n# export_item");
    const pco = await call(owner.id, "export_item", { id: song.id });
    eq("a song exports without format (it offers exactly one)", pco.format, "song-chordpro-pco");
    check("…as text carrying the chords", typeof pco.text === "string" && /\[G\]|G/.test(pco.text) && /grace/.test(pco.text), pco.text?.slice(0, 80));
    eq("…with a .cho filename", pco.filename?.endsWith(".cho"), true);

    const docx = await call(owner.id, "export_item", { id: paper.id, format: "docx" });
    eq("a paper exports a .docx", docx.fileExtension, "docx");
    eq("…base64-encoded", docx.encoding, "base64");
    const bytes = Buffer.from(docx.data, "base64");
    check("…that decodes to a zip (PK header)", bytes[0] === 0x50 && bytes[1] === 0x4b, bytes.subarray(0, 4).toString("hex"));
    eq("…whose byte count matches", docx.bytes, bytes.byteLength);
    eq("…and counts the one footnote", docx.footnoteCount, 1);
    check("…named after the paper", /^verify-paper-\d+\.docx$/.test(docx.filename), docx.filename);
    const docxDefault = await call(owner.id, "export_item", { id: paper.id });
    eq("a paper's only export is chosen when format is omitted", docxDefault.format, "docx");

    const bad = await callErr(owner.id, "export_item", { id: song.id, format: "docx" });
    check("an export the type lacks is refused with the real list", /unknown export 'docx'.*song-chordpro-pco/.test(bad), bad);
    const task = await call(owner.id, "create_item", { type: "task", title: "no exports" });
    const none = await callErr(owner.id, "export_item", { id: task.id });
    check("a type with no exporters says so", /has no exporters/.test(none), none);
    const foreign = await callErr(other.id, "export_item", { id: song.id });
    check("another owner cannot export the item", /not found/i.test(foreign), foreign);
  }
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
