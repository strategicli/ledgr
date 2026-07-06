// Toggle block (<details>) markdown-contract verification (ADR-145). Part A:
// the PURE helpers (toggle-markdown.ts) — the emitted shape and the matcher,
// for open/closed, empty body, multi-block body, and offset behavior. Part B:
// a full MarkdownManager parse → serialize round-trip with the real Toggle
// nodes + StarterKit, proving the block tokenizer rebuilds the subtree and the
// serializer re-emits the canonical shape (incl. multi-paragraph bodies, which
// need the blank-line block separator). No DB, no browser.
// Run: npx tsx scripts/verify-toggle-markdown.mts
let pass = 0;
let fail = 0;
function truthy(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  ${extra ?? ""}`}`);
}

const { toggleToMarkdown, matchToggleBlock } = await import(
  "../src/lib/editor/toggle-markdown"
);

console.log("Part A — pure round-trip");
{
  const md = toggleToMarkdown("My **summary**", "Hidden body text.", true);
  const m = matchToggleBlock(md);
  truthy("emits <details open>", md.startsWith("<details open>"), md);
  truthy("open flag round-trips", m?.open === true);
  truthy("summary preserved", m?.summary === "My **summary**", m?.summary);
  truthy("body preserved", m?.body === "Hidden body text.", m?.body);
}
{
  const m = matchToggleBlock(toggleToMarkdown("T", "B", false));
  truthy("closed emits bare <details>", !!m && m.open === false);
}
{
  const body = "First para.\n\n- one\n- two";
  const m = matchToggleBlock(toggleToMarkdown("S", body, true));
  truthy("multi-block body survives blank line", m?.body === body, m?.body);
}
{
  const m = matchToggleBlock(toggleToMarkdown("Just a title", "", true));
  truthy("empty body matches", !!m && m.body === "");
}
{
  const md = "Intro.\n\n" + toggleToMarkdown("S", "B", true);
  truthy("does NOT match mid-document", matchToggleBlock(md) === null);
  const m2 = matchToggleBlock(md.slice(md.indexOf("<details")));
  truthy("matches at the <details offset", m2?.summary === "S");
}

console.log("Part B — MarkdownManager parse → serialize");
{
  const { MarkdownManager } = await import("@tiptap/markdown");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { Toggle, ToggleSummary, ToggleContent } = await import(
    "../src/components/markdown-editor/toggle-extension"
  );
  const mgr = new MarkdownManager({
    // deno-lint / ts: the manager takes flattened extension configs
    extensions: [StarterKit, Toggle, ToggleSummary, ToggleContent] as never,
  });
  const source = toggleToMarkdown(
    "Round **trip**",
    "Para one.\n\nPara two.",
    true
  );
  const json = mgr.parse(source);
  const out = mgr.serialize(json as never);
  const toggleNode = (json as { content?: { type: string }[] }).content?.[0];
  truthy("parses into a toggle node", toggleNode?.type === "toggle", toggleNode?.type);
  truthy("serialize re-emits <details open>", out.includes("<details open>"));
  truthy("summary markdown preserved", out.includes("<summary>Round **trip**</summary>"));
  truthy(
    "both paragraphs kept, separated by a blank line",
    out.includes("Para one.\n\nPara two."),
    JSON.stringify(out)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
