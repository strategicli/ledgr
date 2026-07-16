// A minimal shared list of item summaries (title + optional done/date), used by
// the desktop Work screens (Tasks, Notes, …). Presentational, data-as-props, so
// it renders in both a server component (cloud) and the desktop client pages.
// Inline styles because the desktop Next export doesn't yet ship the Tailwind
// stylesheet (a later styling pass); on cloud it can be restyled/replaced by the
// richer ViewRenderer surfaces.
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
    return <p style={{ color: "#777", padding: "0.5rem 0" }}>{empty}</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
      {items.map((it) => (
        <li
          key={it.id}
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "center",
            padding: "0.45rem 0.2rem",
            borderBottom: "1px solid #eee",
          }}
        >
          {it.statusCategory ? (
            <span aria-hidden>{it.statusCategory === "done" ? "☑" : "☐"}</span>
          ) : null}
          <span style={{ flex: 1, minWidth: 0 }}>{it.title || "(untitled)"}</span>
          {it.dueDate ? (
            <span style={{ fontSize: "12px", color: "#999" }}>
              {String(it.dueDate).slice(0, 10)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
