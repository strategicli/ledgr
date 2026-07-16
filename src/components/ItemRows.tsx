// A minimal shared list of item summaries (title + optional done/date), used by
// the desktop Work screens (Tasks, Notes, …). Presentational, data-as-props.
// Optional onToggle/onDelete make rows interactive (a client caller passes them;
// a server caller omits them for a read-only list). Styled with the app's
// Tailwind neutral palette to match the dark theme.
export type ItemRow = {
  id: string;
  title: string | null;
  type?: string;
  statusCategory?: string | null;
  dueDate?: string | null;
  scheduledDate?: string | null;
};

export default function ItemRows({
  items,
  empty = "Nothing here yet.",
  onOpen,
  onToggle,
  onDelete,
}: {
  items: ItemRow[];
  empty?: string;
  onOpen?: (id: string) => void;
  onToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  if (!items.length) {
    return <p className="py-2 text-sm text-neutral-500">{empty}</p>;
  }
  return (
    <ul className="mt-3 flex list-none flex-col p-0">
      {items.map((it) => {
        const done = it.statusCategory === "done";
        return (
          <li
            key={it.id}
            className="group flex items-center gap-3 border-b border-neutral-800 px-1 py-2"
          >
            {it.statusCategory ? (
              onToggle ? (
                <button
                  onClick={() => onToggle(it.id)}
                  aria-label={done ? "Mark not done" : "Mark done"}
                  className="text-neutral-400 hover:text-neutral-100"
                >
                  {done ? "☑" : "☐"}
                </button>
              ) : (
                <span aria-hidden className="text-neutral-400">
                  {done ? "☑" : "☐"}
                </span>
              )
            ) : null}
            {onOpen ? (
              <button
                onClick={() => onOpen(it.id)}
                className={`min-w-0 flex-1 truncate text-left hover:underline ${
                  done ? "text-neutral-500 line-through" : "text-neutral-200"
                }`}
              >
                {it.title || "(untitled)"}
              </button>
            ) : (
              <span
                className={`min-w-0 flex-1 truncate ${
                  done ? "text-neutral-500 line-through" : "text-neutral-200"
                }`}
              >
                {it.title || "(untitled)"}
              </span>
            )}
            {it.dueDate ? (
              <span className="text-xs text-neutral-500">
                {String(it.dueDate).slice(0, 10)}
              </span>
            ) : null}
            {onDelete ? (
              <button
                onClick={() => onDelete(it.id)}
                aria-label="Delete"
                className="text-neutral-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
              >
                ×
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
