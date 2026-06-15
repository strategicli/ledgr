// Links list (PRD §4.2): recency-ordered, with the destination host shown
// and clickable straight to the outside URL; the title opens the item
// canvas as everywhere else.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { resolveOwner } from "@/lib/owner";
import { APP_TIMEZONE } from "@/lib/today";
import { queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIMEZONE,
});

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function Links() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const links = await queryViewItems(owner.id, { type: "link" });

  return (
    <ListPage
      tab="links"
      title="Links"
      subtitle={`${links.length} link${links.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type="link" />}
    >
      {links.length > 0 ? (
        <ul className="mt-4">
          {links.map((link) => (
            <li
              key={link.id}
              className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
            >
              <Link
                href={`/items/${link.id}`}
                className={`min-w-0 flex-1 truncate text-sm ${
                  link.title ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                {link.title || "Untitled"}
              </Link>
              {link.url && (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-40 shrink-0 truncate rounded bg-neutral-800 px-1.5 text-xs text-[var(--accent)] hover:brightness-110"
                  title={link.url}
                >
                  {hostOf(link.url)} ↗
                </a>
              )}
              <span className="shrink-0 text-xs text-neutral-600">
                {dateFmt.format(link.updatedAt)}
              </span>
              <RowAction id={link.id} action="trash" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">No links yet.</p>
      )}
    </ListPage>
  );
}
