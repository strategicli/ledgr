// Generic focused list for one type (slice 33 follow-up, ADR-044): the
// destination for a custom type's tab in ListTabs. The five system types have
// their own bespoke pages (/tasks etc.); every other type renders here — a
// plain list of its live items with create/open/trash, framed by the same tab
// strip. notFound() for an unknown type key.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { ItemError, listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default async function TypeList({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { type } = await params;
  const typeDef = await getType(type).catch((err) => {
    if (err instanceof ItemError && err.code === "not_found") notFound();
    throw err;
  });

  const items = await listItems(owner.id, { type, limit: 200 });

  return (
    <ListPage
      tab={type}
      title={typeDef.label}
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type={type} />}
    >
      {items.length > 0 ? (
        <ul className="mt-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60"
            >
              <Link
                href={`/items/${item.id}`}
                className={`min-w-0 flex-1 truncate text-sm ${
                  item.title ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                {item.title || "Untitled"}
              </Link>
              <span className="shrink-0 text-xs text-neutral-600">
                {dateFmt.format(new Date(item.updatedAt))}
              </span>
              <RowAction id={item.id} action="trash" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">
          No {typeDef.label.toLowerCase()} items yet.
        </p>
      )}
    </ListPage>
  );
}
