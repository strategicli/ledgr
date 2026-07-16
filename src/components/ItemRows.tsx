// A minimal shared list of item summaries (title + optional done/date), used by
// the desktop Work screens (Tasks, Notes, …). Presentational, data-as-props, so
// it renders in both a server component (cloud) and the desktop client pages.
// Styled with the app's Tailwind neutral palette so it matches the dark theme.
export type ItemRow = {
  id: string;
  title: string | null;
  type?: string;
  statusCategory?: string | null;
  dueDate?: string | null;
};

export default function ItemRows({
  items,
  empty = "Nothing here yet.",
}: {
  items: ItemRow[];
  empty?: string;
}) {
  if (!items.length) {
    return <p className="py-2 text-sm text-neutral-500">{empty}</p>;
  }
  return (
    <ul className="mt-3 flex list-none flex-col p-0">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex items-center gap-3 border-b border-neutral-800 px-1 py-2"
        >
          {it.statusCategory ? (
            <span aria-hidden className="text-neutral-400">
              {it.statusCategory === "done" ? "☑" : "☐"}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-neutral-200">
            {it.title || "(untitled)"}
          </span>
          {it.dueDate ? (
            <span className="text-xs text-neutral-500">
              {String(it.dueDate).slice(0, 10)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
