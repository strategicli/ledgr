"use client";

// Desktop Build index: entry points for the authoring surfaces (new type / new
// view) + the type list, and the Maintain actions (markdown vault export).
// ADR-139.
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

type TypeRow = { key: string; label: string };
type ExportResult = { exported: number; archived: number; errors: number; remaining: number };
const btn =
  "rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 no-underline hover:bg-neutral-800";

export default function BuildPage() {
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [vaultDir, setVaultDir] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ types?: TypeRow[] }>("/api/types")
      .then((d) => setTypes(d.types ?? []))
      .catch(() => {});
    apiRequest<{ vaultDir?: string | null }>("/api/export")
      .then((d) => setVaultDir(d.vaultDir ?? null))
      .catch(() => {});
  }, []);

  async function runExport() {
    setExporting(true);
    setExportMsg(null);
    try {
      const d = await apiRequest<{ vaultDir?: string; result?: ExportResult }>("/api/export", {
        method: "POST",
      });
      const r = d.result;
      setExportMsg(
        r
          ? `Exported ${r.exported}, archived ${r.archived}, ${r.remaining} remaining${
              r.errors ? `, ${r.errors} errors` : ""
            }.`
          : "Export finished.",
      );
      if (d.vaultDir) setVaultDir(d.vaultDir);
    } catch {
      setExportMsg("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="p-6">
      <h1 className="text-xl font-bold tracking-tight text-neutral-100">Build</h1>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Data
      </h2>
      <div className="mt-2 flex gap-2">
        <Link href="/type/new" className={btn}>
          New type
        </Link>
        <Link href="/view/new" className={btn}>
          New view
        </Link>
      </div>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Types
      </h2>
      <ul className="mt-2 flex list-none flex-col p-0">
        {types.map((t) => (
          <li key={t.key} className="border-b border-neutral-800 py-2">
            <Link
              href={`/list?type=${t.key}`}
              className="text-neutral-200 no-underline hover:underline"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Maintain
      </h2>
      <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-200">Export markdown vault</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Write every item as a markdown file (with frontmatter) into a folder
              you can open in Obsidian or read with Claude. Incremental: only
              changed items are rewritten.
            </p>
            {vaultDir ? (
              <p className="mt-1 truncate font-mono text-xs text-neutral-600">{vaultDir}</p>
            ) : null}
          </div>
          <button onClick={runExport} disabled={exporting} className={`${btn} shrink-0`}>
            {exporting ? "Exporting…" : "Export now"}
          </button>
        </div>
        {exportMsg ? <p className="mt-3 text-sm text-neutral-400">{exportMsg}</p> : null}
      </div>
      <div className="mt-2">
        <Link href="/trash" className={btn}>
          Open Trash
        </Link>
      </div>
    </section>
  );
}
