import { NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { requireAgentOwner } from "@/lib/agent/gate";
import { AGENT_PROMPT_MARKERS, ensureAgentPrompts, revertAgentPrompt } from "@/lib/agent/prompts";
import { getItem } from "@/lib/items";
import { bodyMarkdown } from "@/lib/body";
import { scanAskLabels } from "@/lib/template-vars";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// GET /api/agent/prompts — the "/" picker's "Your prompts": every prompt item
// except the two seeded agent prompts, with a one-line preview, ranked by the
// owner's recent use (settings.agent.promptUse), then recent edits.
// GET ?id=<promptId> — the {{ask:Label}} fields that prompt needs filled first.
export async function GET(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    try {
      const p = await getItem(owner.id, id);
      return NextResponse.json({ askLabels: scanAskLabels([bodyMarkdown(p.body)]) });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      properties: items.properties,
      updatedAt: items.updatedAt,
      // A preview, not the body: list queries never select body (rule 8).
      preview: sql<string>`left(coalesce(${items.bodyText}, ''), 160)`,
    })
    .from(items)
    .where(and(eq(items.ownerId, owner.id), eq(items.type, "prompt"), isNull(items.deletedAt), eq(items.isTemplate, false)))
    .orderBy(desc(items.updatedAt))
    .limit(300);
  const use = (await getSettings(owner.id)).agent.promptUse;
  const prompts = rows
    .map((r) => {
      const p = (r.properties ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        title: r.title,
        slug: typeof p.slug === "string" ? p.slug : null,
        scope: p.scope === "chat" || p.scope === "inline" ? p.scope : "both",
        // The flattened body usually opens with the title as a heading; skip it.
        description: (r.preview.split("\n").find((l) => l.trim())?.trim() ?? "").replace(r.title, "").replace(/^[\s#:.-]+/, ""),
        system: typeof p.system === "string" && AGENT_PROMPT_MARKERS.includes(p.system),
        usedAt: use[r.id] ?? null,
        updatedAt: r.updatedAt,
      };
    })
    .filter((p) => !p.system)
    .sort((a, b) => (b.usedAt ?? "").localeCompare(a.usedAt ?? "") || +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return NextResponse.json({ prompts });
}

// POST {use: id} — record a use for ranking. POST {revert: base|inline} —
// reset a seeded agent prompt to its default. POST {ensure: true} — seed both.
export async function POST(request: Request) {
  const owner = await requireAgentOwner(request);
  if (owner instanceof NextResponse) return owner;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.revert === "base" || b.revert === "inline") {
    return NextResponse.json({ id: await revertAgentPrompt(owner.id, b.revert) });
  }
  if (b.ensure === true) {
    await ensureAgentPrompts(owner.id);
    return NextResponse.json({ agent: (await getSettings(owner.id)).agent });
  }
  if (typeof b.use === "string") {
    const agent = (await getSettings(owner.id)).agent;
    const promptUse = Object.fromEntries(
      Object.entries({ ...agent.promptUse, [b.use]: new Date().toISOString() })
        .sort((x, y) => y[1].localeCompare(x[1]))
        .slice(0, 50)
    );
    await updateSettings(owner.id, { agent: { ...agent, promptUse } });
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ error: "nothing to do" }, { status: 400 });
}
