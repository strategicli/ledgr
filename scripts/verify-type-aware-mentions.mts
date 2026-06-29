// Type-aware @-mentions verification: the pure render + glyph logic (no DB, no
// browser).
//  - mention-glyph.ts: task open/done checkbox vs. the type's nav icon.
//  - markdown-render.ts: markdownToHtml threads a resolved-mentions map →
//    type-aware <a class="mention mention--<type>"> with a leading glyph; an
//    unresolved id under a present map → muted, non-navigating span; NO map →
//    today's plain mention link unchanged.
//   npx tsx scripts/verify-type-aware-mentions.mts
import { markdownToHtml } from "../src/lib/markdown-render";
import { mentionGlyphPaths, isTaskMention } from "../src/lib/mention-glyph";
import type { ResolvedMention } from "../src/lib/mentions";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- glyph selection --------------------------------------------------------
check("task is a task mention", isTaskMention("task"));
check("note is not a task mention", !isTaskMention("note"));
const openBox = mentionGlyphPaths({ type: "task", icon: "tasks", statusCategory: "not_started" });
const doneBox = mentionGlyphPaths({ type: "task", icon: "tasks", statusCategory: "done" });
check("open task glyph has no check", !openBox.includes("m8.5 12.5"));
check("done task glyph has the check", doneBox.includes("m8.5 12.5"));
const personGlyph = mentionGlyphPaths({ type: "person", icon: "person", statusCategory: "" });
check("person uses its type icon (circle head)", personGlyph.includes("circle cx=\"12\" cy=\"8\""));

// --- markdownToHtml: a body with one mention --------------------------------
const ID = "abc-123";
const body = `Follow up with [@Roger Smith](ledgr://item/${ID}) today.`;

// 1) No map → plain mention link, unchanged from before the feature.
const plain = markdownToHtml(body);
check("no-map: tappable /items link", plain.includes(`href="/items/${ID}"`));
check("no-map: class mention", plain.includes('class="mention"'));
check("no-map: no glyph injected", !plain.includes("mention-icon"));

// 2) Map with the id resolved as a person → type class + leading glyph.
const personMap = new Map<string, ResolvedMention>([
  [ID, { id: ID, title: "Roger Smith", type: "person", icon: "person", statusCategory: "" }],
]);
const person = markdownToHtml(body, personMap);
check("person: type class", person.includes('class="mention mention--person"'));
check("person: data-type", person.includes('data-type="person"'));
check("person: glyph injected before label", /class="mention-icon"[\s\S]*@Roger Smith/.test(person));
check("person: still links to the item", person.includes(`href="/items/${ID}"`));

// 3) Map with the id resolved as a DONE task → checkbox-with-check glyph.
const taskMap = new Map<string, ResolvedMention>([
  [ID, { id: ID, title: "Roger Smith", type: "task", icon: "tasks", statusCategory: "done" }],
]);
const task = markdownToHtml(body, taskMap);
check("task: type class", task.includes('class="mention mention--task"'));
check("task: done checkbox glyph", task.includes("m8.5 12.5"));

// 4) Map present but id NOT resolved (trashed / not owner's) → muted span, no link.
const emptyMap = new Map<string, ResolvedMention>();
const missing = markdownToHtml(body, emptyMap);
check("missing: muted class", missing.includes('class="mention mention--missing"'));
check("missing: NOT a link", !missing.includes(`href="/items/${ID}"`));
check("missing: no glyph", !missing.includes("mention-icon"));

// 5) Malformed mention (empty id) still flattens to a plain mention span.
const malformed = markdownToHtml("see [@x](ledgr://item/) here", personMap);
check("malformed: plain mention span, no broken anchor", malformed.includes('class="mention"') && !malformed.includes("ledgr://"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
