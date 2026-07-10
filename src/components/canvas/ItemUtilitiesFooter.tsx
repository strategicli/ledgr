// Shared item utility footer (item-view UI refresh). One home for the item's
// export/share/history controls so every canvas gets the same footer — build
// once, applies to each type. It folds Save Offline + Share link (previously two
// always-open button rows on every item) into a single collapsed "Export &
// sharing" section, matching the existing collapsed "Fields" pattern, then keeps
// Version History as its own collapsed section beside it (it already carries its
// own diff/restore chrome, so it stays first-class rather than nested).
//
// A server component — the three controls are client islands, the wrappers are
// plain markup. MarkdownCanvas's arrange grid places Save Offline / Share /
// History as individually arrangeable cards, so it renders those directly and
// does NOT use this footer; every non-arranged canvas does.
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import HistoryPanel from "@/components/canvas/HistoryPanel";

export default function ItemUtilitiesFooter({
  itemId,
  currentText,
}: {
  itemId: string;
  // The live body markdown, for the Version History "vs. current" diff.
  currentText: string;
}) {
  return (
    <>
      <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
        <details className="canvas-section">
          <summary className="canvas-section-title cursor-pointer hover:text-ink">
            Export &amp; sharing
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <SaveOffline itemId={itemId} bare />
            <ShareLink itemId={itemId} bare />
          </div>
        </details>
      </div>
      <HistoryPanel itemId={itemId} currentText={currentText} />
    </>
  );
}
