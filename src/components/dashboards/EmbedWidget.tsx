// Item-embed widget body (ADR-111 DC3): renders an item's body through the same
// autosaving editor the canvas uses (ItemEditor slot="body"), so typing here
// saves straight to the real item (revisions snapshot as usual) and the content
// stays searchable/exportable. The item's TITLE is shown by the widget frame
// header (toggled by appearance.showHeader) — a header-off embed on a colored
// background is the "sticky note". The toolbar is collapsible and the body
// starts compact so it sits comfortably in a small tile.
"use client";

import ItemEditor from "@/components/markdown-editor/ItemEditor";

export default function EmbedWidget({
  item,
  showBody,
}: {
  item: { id: string; title: string; body: unknown } | null;
  showBody: boolean;
}) {
  if (!item) {
    return (
      <div className="p-3 text-sm text-neutral-600">
        Item unavailable — it may have been deleted.
      </div>
    );
  }
  if (!showBody) {
    return (
      <div className="truncate p-3 text-sm text-neutral-300">{item.title || "Untitled"}</div>
    );
  }
  // cancel-drag so selecting text / scrolling inside the editor never starts a
  // grid drag.
  return (
    <div className="cancel-drag h-full overflow-auto px-3 py-2">
      <ItemEditor item={item} slot="body" compactBody collapsibleToolbar />
    </div>
  );
}
