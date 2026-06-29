// Shared frame for the per-type list pages: title row (with the page's
// actions on the right), subtitle, and the cross-list tab strip.
import { type ListTabKey } from "@/components/lists/ListTabs";

export default function ListPage({
  title,
  subtitle,
  actions,
  children,
  wide = false,
}: {
  tab?: ListTabKey; // accepted but no longer rendered (cross-type strip removed)
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  // Wide surfaces (the Planner calendar) need the full monitor, not the narrow
  // reading column lists use. Defaults to the narrow max-w-3xl.
  wide?: boolean;
}) {
  return (
    <main className="min-h-screen">
      <div className={`mx-auto w-full px-6 py-10 sm:px-12 ${wide ? "max-w-[110rem]" : "max-w-3xl"}`}>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            {title}
          </h1>
          {actions}
        </div>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        <div className="mt-6" />
        {children}
      </div>
    </main>
  );
}
