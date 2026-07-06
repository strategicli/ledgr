// An item shown in a Desk panel (ADR-146). The `writer` panel (the focused one)
// mounts the real, untouched ItemEditor — the one and only editor for that item.
// Every other panel renders a live, read-only MarkdownPreview fed by the doc
// store, so a twin of the same item updates as you type. When focus moves, the
// editor unmounts (flushing any pending save via its own keepalive path) and
// this drops to preview without losing unsaved text, because the store holds it.
"use client";

import { useEffect, useState } from "react";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import MarkdownPreview from "@/components/markdown-editor/MarkdownPreview";
import { sectionAt } from "@/lib/editor/canvas-tabs";
import { publishLive, seedForEditor, useDoc, useTabsEnabled } from "./desk-doc-store";

// Debounce feeding live text to the preview so a fast typist in the focused
// panel doesn't fire a render fetch per keystroke into every twin.
const PREVIEW_DEBOUNCE_MS = 300;

export default function DeskItemPanel({
  itemId,
  writer,
  section,
}: {
  itemId: string;
  writer: boolean;
  // The active canvas-section for this tab in this panel (ADR-147 D5). The writer
  // controls TabbedBody with it; a twin renders just that section, read-only.
  section: number;
}) {
  const doc = useDoc(itemId);
  // Canvas-tabs enablement (ADR-147 D4): drives whether the writer edits the body
  // as tabs. Hook is called unconditionally, before the early returns below.
  const tabsEnabled = useTabsEnabled(doc?.type);

  if (!doc || doc.status === "loading") return <PanelMessage>Loading…</PanelMessage>;
  if (doc.status === "error")
    return <PanelMessage>Couldn’t load this item.</PanelMessage>;

  if (writer) {
    const seed = seedForEditor(itemId);
    if (!seed) return <PanelMessage>Loading…</PanelMessage>;
    return (
      <div className="h-full overflow-auto">
        <ItemEditor
          // Keyed by item so switching the panel's active item remounts fresh;
          // toggling writer↔preview already remounts (different subtree).
          key={itemId}
          item={seed}
          tabsEnabled={tabsEnabled}
          // Only tabbed types get a controlled section; other types edit the flat
          // body (controlledSection is ignored when TabbedBody isn't mounted).
          controlledSection={tabsEnabled ? section : undefined}
          onLiveChange={(next) => publishLive(itemId, next)}
        />
      </div>
    );
  }

  return (
    <ItemPreview
      itemId={itemId}
      title={doc.liveTitle}
      markdown={doc.liveMarkdown}
      section={section}
    />
  );
}

function ItemPreview({
  itemId,
  title,
  markdown,
  section,
}: {
  itemId: string;
  title: string;
  markdown: string;
  section: number;
}) {
  const [debounced, setDebounced] = useState(markdown);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(markdown), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [markdown]);

  // A tabbed body shows just the active section (ADR-147 D5); an untabbed body
  // renders whole. sectionAt clamps the index and returns null when untabbed.
  const sec = sectionAt(debounced, section);
  const text = sec ? sec.body : debounced;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-2 pt-4 sm:px-8 md:px-12">
        <h1 className="text-3xl font-bold leading-tight text-ink">
          {title.trim() || "Untitled"}
        </h1>
        <div className="pt-2">
          <MarkdownPreview text={text} itemId={itemId} />
        </div>
      </div>
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
