// Shared item utility footer (item-view UI refresh). One home for the item's
// export/share/history controls so every canvas gets the same footer — build
// once, applies to each type. It folds Save Offline + Share link (previously two
// always-open button rows on every item) into a single collapsed "Export &
// sharing" section, matching the existing collapsed "Fields" pattern, then keeps
// Version History as its own collapsed section beside it (it already carries its
// own diff/restore chrome, so it stays first-class rather than nested).
//
// The FILES section (ADR-233, Tyler 2026-08-29) sits above Export & sharing and
// only renders when the item actually has files — so deleting an inline link
// out of the body never strands a file invisibly: it's listed here with a
// "not linked" chip, a Copy link to put it back, and Delete to remove it for
// real. The file canvas passes filesSection={false} (its panel already leads
// the page).
//
// A server component — the controls are client islands, the wrappers are
// plain markup. MarkdownCanvas's arrange grid places Save Offline / Share /
// History as individually arrangeable cards, so it renders those directly and
// does NOT use this footer; every non-arranged canvas does.
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import PresentationExport from "@/components/canvas/PresentationExport";
import HistoryPanel from "@/components/canvas/HistoryPanel";
import FilePanel from "@/components/attachments/FilePanel";
import { listItemFilesWithRefs } from "@/lib/attachments";
import { resolveOwner } from "@/lib/owner";

export default async function ItemUtilitiesFooter({
  itemId,
  currentText,
  filesSection = true,
}: {
  itemId: string;
  // The live body markdown, for the Version History "vs. current" diff.
  currentText: string;
  // The file canvas renders its own panel up top, so it opts out here.
  filesSection?: boolean;
}) {
  const owner = filesSection ? await resolveOwner() : null;
  const files = owner
    ? await listItemFilesWithRefs(owner.id, itemId).catch(() => [])
    : [];
  return (
    <>
      {files.length > 0 && (
        <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
          <section className="canvas-section">
            <h3 className="canvas-section-title">Files</h3>
            <div className="mt-2">
              <FilePanel itemId={itemId} initial={files} />
            </div>
          </section>
        </div>
      )}
      <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
        <details className="canvas-section">
          <summary className="canvas-section-title cursor-pointer hover:text-ink">
            Export &amp; sharing
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <SaveOffline itemId={itemId} bare />
            <ShareLink itemId={itemId} bare />
            <PresentationExport itemId={itemId} bare />
          </div>
        </details>
      </div>
      <HistoryPanel itemId={itemId} currentText={currentText} />
    </>
  );
}
