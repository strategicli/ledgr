// Fast triage mode (Brandon 2026-07-21): the Inbox as a one-card-at-a-time deck
// you swipe through (right = Triaged, left = Trash), built for the phone but
// usable anywhere. Same source query as the Inbox list; the client TriageDeck
// owns the card + swipe + inline editing. Entry is the "Triage" button on /inbox.
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import TriageDeck, { type TriageItem } from "@/components/inbox/TriageDeck";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getAppTimezone } from "@/lib/today";
import { appTodayYmd } from "@/lib/recurrence-service";
import { compareTypeKeys } from "@/lib/type-order";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [typeRows, inboxItems, tz] = await Promise.all([
    getDb().select({ key: types.key, label: types.label }).from(types),
    listItems(owner.id, { inbox: true, statusCategory: "active", limit: 200 }),
    getAppTimezone(owner.id),
  ]);
  const today = appTodayYmd(new Date(), tz);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));
  // Oldest first — the same queue order as the Inbox list.
  inboxItems.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const cards: TriageItem[] = inboxItems.map((it) => ({
    id: it.id,
    title: it.title,
    type: it.type,
    createdAt: it.createdAt,
    scheduledDate: it.scheduledDate,
    urgency: it.urgency,
  }));

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
        <h1 className="ui-title mb-6 text-ink">Triage</h1>
        <TriageDeck items={cards} today={today} typeOptions={typeRows} />
      </div>
    </main>
  );
}
