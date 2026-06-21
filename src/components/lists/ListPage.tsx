// Shared frame for the per-type list pages: title row (with the page's
// actions on the right), subtitle, and the cross-list tab strip.
import ListTabs, { type ListTabKey } from "@/components/lists/ListTabs";

export default function ListPage({
  tab,
  title,
  subtitle,
  actions,
  children,
}: {
  tab: ListTabKey;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
            {title}
          </h1>
          {actions}
        </div>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        <div className="mt-6">
          <ListTabs active={tab} />
        </div>
        {children}
      </div>
    </main>
  );
}
