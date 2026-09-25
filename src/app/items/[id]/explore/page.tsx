// The Related Explorer route (Discover, ADR-127 Phase 2). The page itself
// belongs to the relatedness module (ADR-272 step 4): this core route file
// renders it through src/lib/module-panels.tsx, which 404s while the module is
// off. The tab title needs only the item's title, so it stays here.
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb } from "@/db";
import { items } from "@/db/schema";
import { ModuleItemPage } from "@/lib/module-panels";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

// Tab title reflects which item we're exploring (root layout appends " · Ledgr").
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const owner = await resolveOwner();
    if (!owner) return {};
    const rows = await getDb()
      .select({ title: items.title })
      .from(items)
      .where(and(eq(items.id, id), eq(items.ownerId, owner.id)));
    const title = rows[0]?.title?.trim();
    return { title: `Explore related: ${title || "Untitled"}` };
  } catch {
    return {};
  }
}

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trail?: string }>;
}) {
  const { id } = await params;
  return <ModuleItemPage id="explore" itemId={id} search={await searchParams} />;
}
