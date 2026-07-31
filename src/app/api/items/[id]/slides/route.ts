import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { boothExport, slidesMarkdown } from "@/lib/editor/booth-export";
import { createItem, updateItem } from "@/lib/item-mutations";
import { getItem, ItemError, listItems } from "@/lib/items";
import { resolveItemBodyTokens } from "@/lib/item-tokens-service";

// POST /api/items/[id]/slides — gather every highlighted span in an item's body
// into its slides document: the second half of the booth export (the first is
// /items/[id]/print?booth=1, which renders the stripped manuscript with matching
// **[SLIDE N]** cues). Both read the same boothExport pass, so the numbering in
// the two documents always agrees.
//
// The slides document is ONE child note per item, REWRITTEN on each run (Brandon,
// 2026-07-31): a sermon accumulates edits right up to Sunday, and a fresh note per
// push would pile up near-duplicates. Nothing is lost — updateItem snapshots the
// previous body to `revisions` like any other edit.
export const dynamic = "force-dynamic";

const SLIDES_SUFFIX = " — Slides";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const item = await getItem(owner.id, id);
    if (item.deletedAt) throw new ItemError("not_found", "item not found");

    // Live {{item.*}} tokens resolve first (LT1), same as the print route, so a
    // highlighted token lands on the slide as its real value rather than as
    // literal braces.
    const resolved = await resolveItemBodyTokens(owner.id, {
      id: item.id,
      title: item.title,
      body: item.body,
    });
    const { slides } = boothExport(bodyMarkdown(resolved.body));

    // No highlights means nothing was marked for the screen. Say so and write
    // nothing — an empty slides note on every item that ever saw this button is
    // clutter, and a silent no-op would look like a failure.
    if (slides.length === 0) {
      return NextResponse.json({ slides: 0, slidesItemId: null });
    }

    const title = `${resolved.title || "Untitled"}${SLIDES_SUFFIX}`;
    const body = makeMarkdownBody(slidesMarkdown(slides));

    // Find this item's existing slides note by parent + title. Cheap and
    // owner-scoped; no new column or relation to carry the pointer.
    const children = await listItems(owner.id, { parentId: id, type: "note" });
    const existing = children.find((c) => c.title.endsWith(SLIDES_SUFFIX));

    const target = existing
      ? await updateItem(owner.id, existing.id, { title, body })
      : await createItem(owner.id, {
          type: "note",
          title,
          body,
          parentId: id,
        });

    return NextResponse.json({
      slides: slides.length,
      slidesItemId: target.id,
      created: !existing,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
