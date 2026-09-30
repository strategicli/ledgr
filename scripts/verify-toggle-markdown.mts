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

console.log("Part C — Enter/Backspace commands (headless ProseMirror state)");
{
  const { getSchema } = await import("@tiptap/core");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const { Toggle, ToggleSummary, ToggleContent, toggleEnterToBody, toggleBackspaceUnwrap } =
    await import("../src/components/markdown-editor/toggle-extension");

  const schema = getSchema([StarterKit, Toggle, ToggleSummary, ToggleContent] as never);
  const makeDoc = () =>
    schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "Title" }] },
            {
              type: "toggleContent",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "body one" }] },
                { type: "paragraph", content: [{ type: "text", text: "body two" }] },
              ],
            },
          ],
        },
      ],
    });
  const summaryPosOf = (doc: import("@tiptap/pm/model").Node) => {
    let p = -1;
    doc.descendants((n, pos) => {
      if (p < 0 && n.type.name === "toggleSummary") p = pos;
      return p < 0;
    });
    return p;
  };

  // Enter from inside the summary → caret at the start of the body's first block.
  {
    const doc = makeDoc();
    const sPos = summaryPosOf(doc);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, sPos + 3))); // mid-"Title"
    const tr = toggleEnterToBody(state);
    truthy("Enter in summary returns a transaction", !!tr);
    if (tr) {
      state = state.apply(tr);
      const $f = state.selection.$from;
      truthy("Enter caret is in the body's first block", $f.parent.textContent === "body one", $f.parent.textContent);
      truthy("Enter caret at block start", $f.parentOffset === 0);
      let inContent = false;
      for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "toggleContent") inContent = true;
      truthy("Enter caret is inside toggleContent", inContent);
    }
  }

  // Enter elsewhere (the "before" paragraph) is a no-op → null (normal Enter runs).
  {
    const doc = makeDoc();
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3)));
    truthy("Enter outside a summary returns null", toggleEnterToBody(state) === null);
  }

  // Backspace at summary start → unwrap: toggle gone, summary+body become paragraphs.
  {
    const doc = makeDoc();
    const sPos = summaryPosOf(doc);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, sPos + 1))); // offset 0 of summary
    const tr = toggleBackspaceUnwrap(state);
    truthy("Backspace at summary start returns a transaction", !!tr);
    if (tr) {
      state = state.apply(tr);
      let hasToggle = false;
      const paras: string[] = [];
      state.doc.forEach((n) => {
        if (n.type.name === "toggle") hasToggle = true;
        if (n.type.name === "paragraph") paras.push(n.textContent);
      });
      truthy("Backspace removed the toggle node", !hasToggle);
      truthy("Backspace kept summary + body as paragraphs", JSON.stringify(paras) === JSON.stringify(["before", "Title", "body one", "body two"]), JSON.stringify(paras));
    }
  }

  // Backspace mid-summary (offset > 0) is a no-op → null (normal Backspace runs).
  {
    const doc = makeDoc();
    const sPos = summaryPosOf(doc);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, sPos + 3)));
    truthy("Backspace mid-summary returns null", toggleBackspaceUnwrap(state) === null);
  }
}

console.log("Part D — nested toggles, toggles in a bullet / quote (double round-trip)");
{
  const { MarkdownManager } = await import("@tiptap/markdown");
  const { getSchema } = await import("@tiptap/core");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { Toggle, ToggleSummary, ToggleContent } = await import(
    "../src/components/markdown-editor/toggle-extension"
  );
  const { markdownToHtml } = await import("../src/lib/markdown-render");
  const exts = [StarterKit, Toggle, ToggleSummary, ToggleContent] as never;
  const mgr = new MarkdownManager({ extensions: exts });
  const schema = getSchema(exts);
  const inner = toggleToMarkdown("Inner", "inner body", false);
  const cases: Record<string, string> = {
    nested: toggleToMarkdown("Outer", `${inner}\n\nafter inner`, true),
    deep: toggleToMarkdown("A", toggleToMarkdown("B", toggleToMarkdown("C", "deepest", true), true), true),
    inBullet:
      "- parent bullet\n\n  <details open>\n  <summary>Inner</summary>\n\n  line one\n\n  line two\n\n  </details>\n- next",
    inQuote: "> <details open>\n> <summary>Q</summary>\n>\n> body\n>\n> </details>",
  };
  const count = (json: unknown, type: string): number => {
    const n = json as { type?: string; content?: unknown[] };
    return (n.type === type ? 1 : 0) + (n.content ?? []).reduce<number>((a, c) => a + count(c, type), 0);
  };
  const expected: Record<string, number> = { nested: 2, deep: 3, inBullet: 1, inQuote: 1 };
  for (const [name, md] of Object.entries(cases)) {
    const j1 = mgr.parse(md);
    let valid = true;
    try {
      schema.nodeFromJSON(j1).check();
    } catch {
      valid = false;
    }
    truthy(`${name}: parses to a schema-valid doc`, valid, JSON.stringify(j1));
    truthy(`${name}: ${expected[name]} toggle node(s)`, count(j1, "toggle") === expected[name], count(j1, "toggle"));
    const out1 = mgr.serialize(j1 as never);
    truthy(`${name}: no escaped tags`, !out1.includes("&lt;details"), JSON.stringify(out1));
    const out2 = mgr.serialize(mgr.parse(out1) as never);
    truthy(`${name}: stable on second round-trip`, out2 === out1, JSON.stringify({ out1, out2 }));
    const html = markdownToHtml(out1);
    truthy(
      `${name}: server render has ${expected[name]} <details>`,
      (html.match(/<details/g) ?? []).length === expected[name],
      html
    );
  }
  // Inner toggle's closed state survives inside an open outer toggle.
  const j = mgr.parse(cases.nested) as { content: { attrs: { open: boolean }; content: { content: { type: string; attrs?: { open: boolean } }[] }[] }[] };
  const innerNode = j.content[0].content[1].content[0];
  truthy("nested: outer open, inner closed", j.content[0].attrs.open === true && innerNode.attrs?.open === false, JSON.stringify(innerNode));
}

console.log("Part E — wrap-in-toggle wraps at the innermost allowed level");
{
  const { getSchema } = await import("@tiptap/core");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const { Toggle, ToggleSummary, ToggleContent, wrapInToggleTr } = await import(
    "../src/components/markdown-editor/toggle-extension"
  );
  const schema = getSchema([StarterKit, Toggle, ToggleSummary, ToggleContent] as never);
  const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  const at = (doc: import("@tiptap/pm/model").Node, text: string) => {
    let pos = -1;
    doc.descendants((n, q) => {
      if (pos < 0 && n.isText && n.text === text) pos = q + 1;
      return pos < 0;
    });
    return pos;
  };
  // Inside a toggle's body: the paragraph becomes a nested toggle.
  {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "Outer" }] },
            { type: "toggleContent", content: [p("wrap me"), p("stay")] },
          ],
        },
      ],
    });
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at(doc, "wrap me")) });
    const tr = wrapInToggleTr(state);
    const outer = tr?.doc.child(0);
    const body = outer?.child(1);
    truthy("wrap inside a toggle nests (no bail)", !!tr && body?.child(0).type.name === "toggle", tr?.doc.toString());
    truthy("nested wrap keeps the sibling paragraph", body?.child(1)?.textContent === "stay");
  }
  // Inside a nested bullet: the sub-list under the parent bullet is wrapped.
  {
    const li = (t: string, extra: unknown[] = []) => ({ type: "listItem", content: [p(t), ...extra] });
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "bulletList", content: [li("parent", [{ type: "bulletList", content: [li("child")] }])] },
      ],
    });
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at(doc, "child")) });
    const tr = wrapInToggleTr(state);
    const parentItem = tr?.doc.child(0).child(0);
    truthy(
      "wrap in a nested bullet wraps the sub-list inside the parent bullet",
      parentItem?.child(1)?.type.name === "toggle" && parentItem.child(0).textContent === "parent",
      tr?.doc.toString()
    );
  }
  // Top level: unchanged behavior.
  {
    const doc = schema.nodeFromJSON({ type: "doc", content: [p("top")] });
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2) });
    const tr = wrapInToggleTr(state);
    truthy("top-level paragraph wraps", tr?.doc.child(0).type.name === "toggle" && tr.doc.child(0).child(0).textContent === "top");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
