// The per-type tab strip ("list lenses"): the /tasks tab pattern generalized to
// every type's list. Server-rendered and URL-driven (no client JS, Principle 5)
// — each tab is a Link that sets ?lens=<id>; the active SORT tab carries a small
// arrow that toggles ?rev to invert the order ("Most linked" ⇄ "Least linked").
// A view lens carries its own sort, so it shows no arrow. A subtle gear links to
// the type's Build editor, where the strip is customized (CSS-hover tooltip, the
// CLAUDE.md standard). Existing filter params (prop_*) are preserved across tab
// switches.
import Link from "next/link";
import TabStrip from "@/components/nav/TabStrip";
import type { Lens } from "@/lib/list-lenses";

type SearchParams = Record<string, string | string[] | undefined>;

// Rebuild the query string for a tab link: keep every current param except the
// lens/rev controls, then apply the overrides. An omitted rev drops the param
// (back to the lens's natural direction).
function buildHref(
  basePath: string,
  params: SearchParams,
  overrides: { lens?: string; rev?: boolean }
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "lens" || k === "rev") continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== "") qs.set(k, val);
  }
  if (overrides.lens) qs.set("lens", overrides.lens);
  if (overrides.rev) qs.set("rev", "1");
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export default function ListLenses({
  lenses,
  activeId,
  reversed,
  basePath,
  params,
  editHref,
}: {
  lenses: Lens[];
  activeId: string;
  reversed: boolean;
  basePath: string;
  params: SearchParams;
  editHref: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-1 border-b border-neutral-800">
      <TabStrip className="flex-1">
        {lenses.map((lens) => {
          if (lens.id !== activeId) {
            return (
              <Link
                key={lens.id}
                href={buildHref(basePath, params, { lens: lens.id })}
                className="whitespace-nowrap rounded-t px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
              >
                {lens.label}
              </Link>
            );
          }
          return (
            <span
              key={lens.id}
              data-tab-active=""
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-t border-b-2 border-[var(--accent)] px-3 py-1.5 text-sm font-medium text-neutral-100"
            >
              {lens.label}
              {lens.kind === "sort" ? (
                <Link
                  href={buildHref(basePath, params, { lens: lens.id, rev: !reversed })}
                  title={reversed ? "Restore default order" : "Reverse order"}
                  aria-label={reversed ? "Restore default order" : "Reverse order"}
                  className="leading-none text-neutral-400 hover:text-neutral-100"
                >
                  {(reversed ? lens.dir !== "asc" : lens.dir === "asc") ? "↑" : "↓"}
                </Link>
              ) : null}
            </span>
          );
        })}
      </TabStrip>
      <div className="group relative shrink-0">
        <Link
          href={editHref}
          aria-label="Customize tabs"
          className="block cursor-help rounded px-2 py-1 text-sm text-neutral-600 hover:text-neutral-300"
        >
          ⚙
        </Link>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-52 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs normal-case text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          Customize these tabs in Build → Types
        </span>
      </div>
    </div>
  );
}
