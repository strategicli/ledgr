import { NextResponse } from "next/server";
import { asUuid, errorResponse, requireOwner } from "@/lib/api";
import { bodyMarkdown } from "@/lib/body";
import { getItem, ItemError } from "@/lib/items";
import { resolveItemBodyTokens } from "@/lib/item-tokens-service";
import { renderMsmDocx } from "@/lib/papers/msm-docx";
import type { PaperMeta } from "@/lib/papers/types";

// GET /api/items/[id]/render-docx — render a `paper` item's canonical markdown
// body into an MSM-compliant .docx and stream it back as a download (Papers
// module, P2). Owner-scoped like every item read; the docx is a disposable
// render of the markdown source, never stored. Binary output is why this is a
// dedicated route rather than a module ExporterDef (whose render returns a
// string) — keeps the core module contract untouched.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "A Teaching Overview of First Peter" -> "a-teaching-overview-of-first-peter"
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "paper"
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const id = asUuid((await context.params).id, "id");
    const item = await getItem(owner.id, id);
    if (item.deletedAt) throw new ItemError("not_found", "item not found");
    if (item.type !== "paper") {
      return NextResponse.json(
        { error: "render-docx is only available for paper items" },
        { status: 400 }
      );
    }

    // Resolve live {{item.*}} tokens against the paper's current state (LT3) so
    // the .docx carries the real title/due date/etc from the body — the whole
    // point of "put the due date in the doc once, from the property."
    const resolved = await resolveItemBodyTokens(owner.id, {
      id: item.id,
      title: item.title,
      body: item.body,
    });

    const props = (item.properties as PaperMeta | null) ?? {};
    const meta: PaperMeta & { title?: string } = {
      title: resolved.title,
      school: props.school,
      paper_type: props.paper_type,
      course: props.course,
      author: props.author,
      location: props.location,
      paper_date: props.paper_date,
    };

    const { buffer } = await renderMsmDocx(bodyMarkdown(resolved.body), meta);
    const filename = `${slugify(resolved.title || "paper")}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
