// Collapsible headings + list items (collapsible-headings.ts), headless: fold a
// bullet and a heading, prove the hidden ranges, the caret auto-expand guard,
// per-device remembering (fingerprints in localStorage), restore after a
// whole-document swap, and Expand all. No DB, no browser (localStorage stubbed).
// Run: npx tsx scripts/verify-collapsible-folds.mts
let pass = 0;
let fail = 0;
function truthy(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  ${JSON.stringify(extra ?? "")}`}`);
}

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { getSchema } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const { TaskList, TaskItem } = await import("@tiptap/extension-list");
const { EditorState, TextSelection } = await import("@tiptap/pm/state");
const { foldPlugin, foldKey, hiddenRange, fingerprintsOf } = await import(
  "../src/components/markdown-editor/collapsible-headings"
);

const schema = getSchema([StarterKit, TaskList, TaskItem.configure({ nested: true })] as never);
const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const li = (t: string, kids: unknown[] = []) => ({ type: "listItem", content: [p(t), ...kids] });
const docJSON = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
    {
      type: "bulletList",
      content: [
        li("parent", [{ type: "bulletList", content: [li("child one"), li("child two")] }]),
        li("leaf"),
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("task"), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [p("subtask")] }] }],
        },
      ],
    },
  ],
};
const posOf = (doc: import("@tiptap/pm/model").Node, type: string, text: string) => {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found < 0 && n.type.name === type && (n.child(0)?.textContent ?? n.textContent) === text) found = pos;
    return found < 0;
  });
  return found;
};
const KEY = "ledgr:folds:item-1";
const fresh = () => {
  const doc = schema.nodeFromJSON(docJSON);
  let state = EditorState.create({ schema, doc, plugins: [foldPlugin()], selection: TextSelection.create(doc, 2) });
  state = state.apply(state.tr.setMeta(foldKey, { headings: true, lists: true, storageKey: KEY, restore: true }));
  return state;
};
// Mimic the plugin view's save (the view doesn't run headless).
const save = (state: InstanceType<typeof EditorState>) => {
  const s = foldKey.getState(state)!;
  if (s.touched) {
    const fps = fingerprintsOf(state.doc, s);
    if (fps.length) store.set(KEY, JSON.stringify(fps));
    else store.delete(KEY);
  }
};

// Hidden ranges.
{
  const state = fresh();
  const parent = posOf(state.doc, "listItem", "parent");
  const r = hiddenRange(state.doc, parent);
  const hidden = r ? state.doc.textBetween(r.from, r.to, "|") : "";
  truthy("bullet hides its nested items", hidden === "child one|child two", hidden);
  truthy("a bullet with nothing under it is not foldable", hiddenRange(state.doc, posOf(state.doc, "listItem", "leaf")) === null);
  const task = posOf(state.doc, "taskItem", "task");
  truthy("checklist item folds its subtasks", !!hiddenRange(state.doc, task));
}

// Fold, remember, restore.
{
  store.clear();
  let state = fresh();
  const parent = posOf(state.doc, "listItem", "parent");
  state = state.apply(state.tr.setMeta(foldKey, { toggle: parent }));
  save(state);
  truthy("folding a bullet marks it collapsed", foldKey.getState(state)!.collapsed.includes(parent));
  truthy("the fold is remembered as a text fingerprint", store.get(KEY) === JSON.stringify(["li:0:parent"]), store.get(KEY));

  const reopened = fresh();
  truthy("reopening the note restores the fold", foldKey.getState(reopened)!.collapsed.includes(parent));

  // A whole-document swap (server refresh) re-resolves rather than forgetting.
  const swapped = reopened.apply(
    reopened.tr.replaceWith(0, reopened.doc.content.size, schema.nodeFromJSON(docJSON).content)
  );
  save(swapped);
  truthy("a whole-document swap keeps the fold", foldKey.getState(swapped)!.collapsed.length === 1);
  truthy("...and doesn't overwrite what's remembered", store.get(KEY) === JSON.stringify(["li:0:parent"]));
}

// Caret entering hidden content auto-expands (and that is remembered).
{
  let state = fresh();
  const childPos = posOf(state.doc, "listItem", "child one");
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, childPos + 2)));
  save(state);
  truthy("caret inside a folded bullet opens it", foldKey.getState(state)!.collapsed.length === 0);
  truthy("...and the remembered fold is cleared", !store.has(KEY));
}

// Expand all clears headings and bullets.
{
  let state = fresh();
  state = state.apply(state.tr.setMeta(foldKey, { toggle: posOf(state.doc, "listItem", "parent") }));
  state = state.apply(state.tr.setMeta(foldKey, { toggle: 0 }));
  save(state);
  truthy("heading + bullet both folded", foldKey.getState(state)!.collapsed.length === 2);
  truthy("both remembered", JSON.parse(store.get(KEY) ?? "[]").length === 2, store.get(KEY));
  state = state.apply(state.tr.setMeta(foldKey, { expandAll: true }));
  save(state);
  truthy("Expand all opens everything", foldKey.getState(state)!.collapsed.length === 0);
  truthy("Expand all forgets this note's folds", !store.has(KEY));
}

// A fingerprint that no longer matches just shows open.
{
  store.set(KEY, JSON.stringify(["li:0:renamed elsewhere"]));
  truthy("a stale fingerprint folds nothing", foldKey.getState(fresh())!.collapsed.length === 0);
}

// Lists switched off: bullets don't fold, headings still do.
{
  store.set(KEY, JSON.stringify(["li:0:parent", "h2:0:Section"]));
  const doc = schema.nodeFromJSON(docJSON);
  let state = EditorState.create({ schema, doc, plugins: [foldPlugin()], selection: TextSelection.create(doc, 2) });
  state = state.apply(state.tr.setMeta(foldKey, { headings: true, lists: false, storageKey: KEY, restore: true }));
  truthy("with bullets off only the heading restores", JSON.stringify(foldKey.getState(state)!.collapsed) === "[0]", foldKey.getState(state)!.collapsed);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
