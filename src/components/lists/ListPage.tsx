// Shared frame for the per-type list pages: title row (with the page's
// actions on the right), subtitle, and the cross-list tab strip.
import { type ListTabKey } from "@/components/lists/ListTabs";

// Three width modes (ui-refresh S2):
//  - "read"  — the narrow reading column prose-ish surfaces want (max-w-3xl).
//  - "list"  — lists/tables use the width instead of stranding two-thirds of a
//              1440px screen empty; capped so an ultrawide monitor doesn't get
//              absurdly long rows, but a laptop fills edge to edge.
//  - "wide"  — the Planner calendar, which wants the full monitor.
const WIDTH_CLASS = {
  read: "max-w-3xl",
  list: "max-w-[100rem]",
  wide: "max-w-[110rem]",
} as const;

export default function ListPage({
  title,
  subtitle,
  actions,
  children,
  width,
  wide = false,
}: {
  tab?: ListTabKey; // accepted but no longer rendered (cross-type strip removed)
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  // Preferred: an explicit width mode. `wide` is kept as a back-compat alias
  // (wide=true ⇒ "wide") so existing callers don't churn.
  width?: keyof typeof WIDTH_CLASS;
  wide?: boolean;
}) {
  const maxw = WIDTH_CLASS[width ?? (wide ? "wide" : "read")];
  return (
    <main className="min-h-screen">
      <div className={`mx-auto w-full px-6 py-10 sm:px-12 ${maxw}`}>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="ui-title">{title}</h1>
          {actions}
        </div>
        {subtitle && <p className="ui-meta mt-1">{subtitle}</p>}
        <div className="mt-6" />
        {children}
      </div>
    </main>
  );
}
