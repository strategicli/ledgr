// Notification center (ADR-129): where every notification lives — read and
// unread — markable read/unread and archivable. One row per event (three tasks
// notifying at once = three rows). Persists what Web Push (ADR-034) used to
// deliver fire-and-forget. A Work-surface page (glanceable, mobile-friendly);
// the list + per-row + bulk actions are the client leaf.
import Link from "next/link";
import { redirect } from "next/navigation";
import NotificationList from "@/components/notifications/NotificationList";
import {
  listNotifications,
  notificationCounts,
  NOTIFICATION_CENTER_ENABLED,
  type ListFilter,
} from "@/lib/notifications";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

const TABS: { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "archived", label: "Archived" },
];

function parseFilter(raw: string | string[] | undefined): ListFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "unread" || v === "read" || v === "archived" || v === "all") return v;
  return "all";
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  // Notification center paused (ADR-130): keep the page in the tree but send a
  // stray pin or bookmark home rather than showing an orphaned, never-fed list.
  if (!NOTIFICATION_CENTER_ENABLED) redirect("/");

  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const filter = parseFilter((await searchParams).filter);
  const [items, counts] = await Promise.all([
    listNotifications(owner.id, filter),
    notificationCounts(owner.id),
  ]);

  const tabCount = (key: ListFilter) =>
    key === "unread" ? counts.unread : key === "archived" ? counts.archived : counts.all;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {counts.unread === 0
            ? "You're all caught up."
            : `${counts.unread} unread`}
        </p>

        {/* Filter strip. Plain links carry ?filter= so the server renders the
            chosen state (no client fetch for the tabs). */}
        <div className="mt-6 flex items-center gap-1 border-b border-neutral-800">
          {TABS.map((tab) => {
            const active = filter === tab.key || (tab.key === "all" && filter === "read");
            return (
              <Link
                key={tab.key}
                href={tab.key === "all" ? "/notifications" : `/notifications?filter=${tab.key}`}
                scroll={false}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-[var(--accent)] text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab.label}
                {tabCount(tab.key) > 0 && (
                  <span className="ml-1.5 text-xs text-neutral-600">
                    {tabCount(tab.key)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <NotificationList
          notifications={items.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            url: n.url,
            state: n.state,
            createdAt: n.createdAt.toISOString(),
          }))}
          filter={filter}
          unread={counts.unread}
        />
      </div>
    </main>
  );
}
