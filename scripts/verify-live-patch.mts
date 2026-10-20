// Verifies the live in-place patch (live-patch.ts) lands an outside edit
// without corrupting the document's structure. The regression: an edit that
// changed text inside a table cell AND added a section after the table nested
// the rest of the table and the new section inside that cell, because the raw
// diff range started deep in the cell and ended at the top level.
// Run: npx tsx scripts/verify-live-patch.mts
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { getExtensionField, getSchema, createDocument, type AnyExtension } from "@tiptap/core";
import { Transform } from "@tiptap/pm/transform";

const ext = await import("../src/components/markdown-editor/extensions");
const { blockDiffRange } = await import("../src/components/markdown-editor/live-patch");

const exts: AnyExtension[] = [StarterKit.configure({ code: false }), ext.LedgrTable, ext.TableRow, ext.TableHeader, ext.TableCell];
const flat = exts.flatMap((e) => {
  const add = getExtensionField<() => AnyExtension[]>(e, "addExtensions", {
    name: e.name,
    options: e.options,
    storage: {},
  } as never);
  return [e, ...(add ? add() : [])];
});
const schema = getSchema(flat);
const mgr = new MarkdownManager({ extensions: flat });
const doc = (md: string) => createDocument(mgr.parse(md) as never, schema, {}, { errorOnInvalidContent: false });

let failures = 0;
function patches(name: string, before: string, after: string) {
  const cur = doc(before);
  const next = doc(after);
  const r = blockDiffRange(cur, next)!;
  const out = new Transform(cur).replace(r.start, r.endA, next.slice(r.start, r.endB)).doc;
  const ok = out.eq(next);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

const table = (cell: string) => `| A | B |\n| --- | --- |\n| ${cell} | two |\n| three | four |`;

patches(
  "edit inside a table cell plus a new section after the table",
  `Intro.\n\n${table("one")}\n\nEnd.`,
  `Intro.\n\n${table("one (see below)")}\n\n#### New section\n\nNew text.\n\nEnd.`
);
patches("edit inside a table cell only", `${table("one")}\n\nEnd.`, `${table("one, edited")}\n\nEnd.`);
patches("text edit in a paragraph", "Alpha beta.\n\nGamma.", "Alpha BETA beta.\n\nGamma.");
patches("new block appended at the end", "Alpha.", "Alpha.\n\n- a list\n- of two");
patches("edit in a list item and a later paragraph", "- one\n- two\n\nTail.", "- one!\n- two\n\nNew.\n\nTail!");
console.log(blockDiffRange(doc("Same."), doc("Same.")) === null ? "PASS  no change returns null" : (failures++, "FAIL  no change returns null"));

if (failures) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall pass");
