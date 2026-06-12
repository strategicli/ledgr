// Generic filter bar for list pages: every select writes its URL search
// param and the server page re-renders with the new filter, so the URL *is*
// the filter state (shareable, back-button-friendly, and the same shape a
// stored View Definition will serialize). Choosing a select's default value
// removes the param to keep URLs clean.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterSelect = {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  // The value an absent param means (e.g. the tasks list shows open tasks
  // until told otherwise). Defaults to "".
  defaultValue?: string;
};

export default function FilterBar({ selects }: { selects: FilterSelect[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(select: FilterSelect, value: string) {
    const next = new URLSearchParams(params);
    if (value === (select.defaultValue ?? "")) next.delete(select.param);
    else next.set(select.param, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {selects.map((select) => (
        <label
          key={select.param}
          className="flex items-center gap-1.5 text-xs text-neutral-500"
        >
          {select.label}
          <select
            value={params.get(select.param) ?? select.defaultValue ?? ""}
            onChange={(e) => setParam(select, e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600"
          >
            {select.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
