// Footer for a plain (sort-lens) list that the view engine caps at one page
// (ADR-116). Shows "Showing X of Y" and a Load-more link that grows the window
// by one page via a ?show= param the page reads back with parseListWindow. The
// link is server-rendered (no client JS, Principle 5) and uses scroll={false}
// so the list grows in place instead of jumping to the top. Renders nothing
// once everything is shown; at the VIEW_MAX ceiling it explains the cap instead
// of offering a dead button.
import Link from "next/link";
import { VIEW_LIMIT, VIEW_MAX } from "@/lib/views";

export default function LoadMore({
  shown,
  total,
  basePath,
  params,
}: {
  shown: number; // rows currently rendered (the fetched window, ≤ total)
  total: number; // true match count, independent of the display cap
  basePath: string; // e.g. "/notes" — the list's own route
  params: Record<string, string | string[] | undefined>; // current searchParams
}) {
  if (shown >= total) return null;

  const remaining = total - shown;

  // Preserve every active param (lens, rev, prop_* filters) and bump ?show=.
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "show") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) qs.set(key, v);
  }

  // At the ceiling there's no honest "load more" — point to filter/search.
  if (shown >= VIEW_MAX) {
    return (
      <p className="mt-4 border-t border-neutral-800/60 pt-4 text-center text-xs text-neutral-600">
        Showing the first {shown.toLocaleString()} of {total.toLocaleString()}.
        Narrow with a filter or search to reach the rest.
      </p>
    );
  }

  const next = Math.min(shown + VIEW_LIMIT, VIEW_MAX);
  const step = Math.min(VIEW_LIMIT, remaining);
  qs.set("show", String(next));

  return (
    <div className="mt-4 flex flex-col items-center gap-1.5 border-t border-neutral-800/60 pt-4">
      <Link
        href={`${basePath}?${qs.toString()}`}
        scroll={false}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-600 hover:bg-neutral-800/60 hover:text-neutral-100"
      >
        Load {step.toLocaleString()} more
      </Link>
      <p className="text-xs text-neutral-600">
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
      </p>
    </div>
  );
}
