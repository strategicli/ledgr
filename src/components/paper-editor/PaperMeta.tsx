// The title-page meta form (Papers module, P3). These fields drive the MSM
// title page the docx renderer builds (school / paper type / course / author /
// location / date) plus the workflow stage. They live in items.properties and
// are written by PaperCanvasClient (the single properties writer for a paper, so
// nothing races the generic CustomProperties panel). Shown collapsed under the
// Draft tab — meta is set once, not while writing.
"use client";

import { PAPER_STAGES, type PaperMeta as Meta } from "@/lib/papers/types";

const input =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600";

const FIELDS: { key: keyof Meta; label: string }[] = [
  { key: "school", label: "School" },
  { key: "paper_type", label: "Paper type" },
  { key: "course", label: "Course" },
  { key: "author", label: "Author" },
  { key: "location", label: "Location" },
  { key: "paper_date", label: "Date" },
];

export default function PaperMeta({
  meta,
  onChange,
}: {
  meta: Meta;
  onChange: (patch: Partial<Meta>) => void;
}) {
  return (
    <details className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300">
        Title page &amp; stage
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-neutral-500">{f.label}</span>
            <input
              value={meta[f.key] ?? ""}
              onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}
              className={`${input} w-full`}
            />
          </label>
        ))}
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Stage</span>
          <select
            value={meta.stage ?? ""}
            onChange={(e) => onChange({ stage: e.target.value || undefined })}
            className={`${input} w-full`}
          >
            <option value="">—</option>
            {PAPER_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
