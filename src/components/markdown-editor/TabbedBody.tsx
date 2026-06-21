// Canvas tabs (ADR-094): a thin client wrapper around the markdown editor that
// splits one item's body into named tabs (a strip + "+ Add tab" across the top,
// an inline title for the active tab). Tabs are sections of the SAME body
// (src/lib/editor/canvas-tabs.ts); this component only manages which section is
// shown and reassembles the whole body on save. The editor is unchanged — it's
// remounted per tab (via `key`) on a switch so it reloads that tab's content,
// and on each keystroke it's re-fed its own emitted markdown (a no-op guard in
// MarkdownEditor: getMarkdown() === initialMarkdown → no reset), so the cursor
// is never disturbed.
"use client";

import { useState } from "react";
import LazyMarkdownEditor from "./LazyMarkdownEditor";
import ConfirmButton from "@/components/ui/ConfirmButton";
import type { PromotedRefs } from "./block-anchor-extension";
import {
  parseTabs,
  serializeTabs,
  sanitizeTabTitle,
  type CanvasTab,
} from "@/lib/editor/canvas-tabs";

export type TabbedBodyProps = {
  itemId: string;
  initialMarkdown: string;
  uploadImage: (file: File) => Promise<string>;
  // Receives the full reassembled body markdown (all tabs) to save.
  onChange: (markdown: string) => void;
  onRequestSave?: () => Promise<void>;
  promoteToMeetingId?: string;
  promotedRefs?: PromotedRefs;
};

export default function TabbedBody({
  itemId,
  initialMarkdown,
  uploadImage,
  onChange,
  onRequestSave,
  promoteToMeetingId,
  promotedRefs,
}: TabbedBodyProps) {
  const parsed = parseTabs(initialMarkdown);
  const [tabs, setTabs] = useState<CanvasTab[] | null>(parsed);
  const [untabbed, setUntabbed] = useState<string>(parsed ? "" : initialMarkdown);
  const [active, setActive] = useState(0);

  const activeIdx = tabs ? Math.min(active, tabs.length - 1) : 0;

  function commitTabs(next: CanvasTab[]) {
    setTabs(next);
    onChange(serializeTabs(next));
  }

  function onEditorChange(md: string) {
    if (tabs) {
      commitTabs(tabs.map((t, i) => (i === activeIdx ? { ...t, body: md } : t)));
    } else {
      setUntabbed(md);
      onChange(md);
    }
  }

  function addTab() {
    if (!tabs) {
      setActive(1);
      commitTabs([
        { title: "Tab 1", body: untabbed.trim() },
        { title: "Tab 2", body: "" },
      ]);
    } else {
      setActive(tabs.length);
      commitTabs([...tabs, { title: `Tab ${tabs.length + 1}`, body: "" }]);
    }
  }

  function renameActive(title: string) {
    if (!tabs) return;
    commitTabs(tabs.map((t, i) => (i === activeIdx ? { ...t, title } : t)));
  }

  function deleteTab(i: number) {
    if (!tabs) return;
    if (tabs.length <= 1) {
      // Removing the last tab reverts to a plain untabbed body (content kept).
      const kept = tabs[0]?.body ?? "";
      setActive(0);
      setUntabbed(kept);
      setTabs(null);
      onChange(kept);
    } else {
      const next = tabs.filter((_, idx) => idx !== i);
      setActive(Math.min(activeIdx, next.length - 1));
      commitTabs(next);
    }
  }

  const editorInitial = tabs ? (tabs[activeIdx]?.body ?? "") : untabbed;

  return (
    <div>
      {tabs ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-neutral-800 pb-2">
          {tabs.map((t, i) => {
            const isActive = i === activeIdx;
            return (
              <span
                key={i}
                className={`group inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm ${
                  isActive
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className="max-w-[14rem] truncate"
                >
                  {t.title.trim() || "Untitled"}
                </button>
                <ConfirmButton
                  onConfirm={() => deleteTab(i)}
                  title="Delete this tab?"
                  description={
                    tabs.length <= 1
                      ? "This removes the tabs; the content stays as a plain note."
                      : `"${t.title.trim() || "Untitled"}" and its content are removed.`
                  }
                  confirmLabel="Delete"
                  align="right"
                  trigger="×"
                  triggerLabel="Delete tab"
                  triggerClassName="leading-none text-neutral-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                />
              </span>
            );
          })}
          <button
            type="button"
            onClick={addTab}
            className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
          >
            + Add tab
          </button>
        </div>
      ) : (
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={addTab}
            className="rounded-md px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-900 hover:text-neutral-400"
          >
            + Add tab
          </button>
        </div>
      )}

      {/* Active tab title (inline-editable) */}
      {tabs && (
        <input
          type="text"
          value={tabs[activeIdx]?.title ?? ""}
          onChange={(e) => renameActive(sanitizeTabTitle(e.target.value))}
          placeholder="Tab title"
          className="mb-2 w-full bg-transparent text-base font-semibold text-neutral-200 outline-none placeholder:text-neutral-600"
        />
      )}

      <LazyMarkdownEditor
        // Remount on tab switch / structural change so the editor reloads the
        // active tab's content; stable key when untabbed.
        key={tabs ? `tab-${activeIdx}-${tabs.length}` : "untabbed"}
        itemId={itemId}
        initialMarkdown={editorInitial}
        uploadImage={uploadImage}
        onChange={onEditorChange}
        promoteToMeetingId={promoteToMeetingId}
        promotedRefs={promotedRefs}
        onRequestSave={onRequestSave}
      />
    </div>
  );
}
