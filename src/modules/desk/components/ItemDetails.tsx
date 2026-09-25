// The Desk's opt-in "Show details" panel (ADR-147 D6): the item's properties,
// typed relations, and confirmed "Linked here" connections, below the body in a
// panel. The full canvas assembles these from a mix of client + server-fetched
// components; here one read-only endpoint (GET /api/items/[id]/details) feeds one
// client component, which reuses the SAME editors the canvas uses so edits keep
// their own field-level PATCH paths (never touching the body — one-writer-per-
// body still holds). Editing is allowed only in the focused (writer) panel; a
// twin renders the same data read-only.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CustomProperties from "@/components/build/CustomProperties";
import RelationField from "@/components/relations/RelationField";
import type { PropertyDef, RelationCardinality } from "@/lib/types";

type RelationInfo = {
  key: string;
  label: string;
  targetType: string | null;
  targetTypeLabel: string | null;
  cardinality: RelationCardinality;
  links: { id: string; title: string }[];
};
type LinkedItem = { id: string; title: string; type: string; typeLabel: string };
type Details = {
  type: string;
  properties: { schema: PropertyDef[]; values: Record<string, unknown> };
  relations: RelationInfo[];
  linkedHere: LinkedItem[];
};

const SECTION_LABEL = "ui-section-label mb-2 text-ink-muted";

export default function ItemDetails({
  itemId,
  writer,
}: {
  itemId: string;
  // Only the focused panel may edit; a twin shows the same data read-only.
  writer: boolean;
}) {
  const [data, setData] = useState<Details | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Keyed by itemId at the mount site, so a fresh mount starts in "loading" and
  // this effect only fetches — no synchronous setState in the effect body (the
  // codebase's no-setState-in-effect rule). All setState happens in the async
  // then/catch callbacks below.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/items/${itemId}/details`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Details) => {
        if (!cancelled) {
          setData(d);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const hasProps = (data?.properties.schema.length ?? 0) > 0;
  const hasRelations = (data?.relations.length ?? 0) > 0;
  const hasLinked = (data?.linkedHere.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-3xl border-t border-line px-2 pb-10 pt-4 sm:px-8 md:px-12">
      {status === "loading" && (
        <p className="ui-meta text-ink-faint">Loading details…</p>
      )}
      {status === "error" && (
        <p className="ui-meta text-ink-faint">Couldn’t load details.</p>
      )}
      {status === "ready" && data && (
        <>
          {!hasProps && !hasRelations && !hasLinked && (
            <p className="ui-meta text-ink-faint">
              No properties, relations, or links yet.
            </p>
          )}

          {hasProps && (
            <section className="mb-5">
              <h2 className={SECTION_LABEL}>Properties</h2>
              <CustomProperties
                itemId={itemId}
                typeKey={data.type}
                schema={data.properties.schema}
                initial={data.properties.values}
                // A twin is read-only; only the focused panel edits (D6).
                locked={!writer}
                hideHeading
                bare
              />
            </section>
          )}

          {hasRelations && (
            <section className="mb-5">
              <h2 className={SECTION_LABEL}>Relations</h2>
              <dl className="flex flex-col gap-2">
                {data.relations.map((rel) => (
                  <div key={rel.key} className="flex items-start gap-3 text-sm">
                    <dt className="w-32 shrink-0 pt-1 text-ink-subtle">{rel.label}</dt>
                    <dd className="min-w-0 flex-1">
                      {writer ? (
                        <RelationField
                          itemId={itemId}
                          role={rel.key}
                          targetType={rel.targetType}
                          targetTypeLabel={rel.targetTypeLabel}
                          cardinality={rel.cardinality}
                          initial={rel.links}
                        />
                      ) : rel.links.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {rel.links.map((l) => (
                            <Link
                              key={l.id}
                              href={`/items/${l.id}`}
                              className="rounded border border-line bg-surface-1 px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
                            >
                              {l.title.trim() || "Untitled"}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <span className="ui-meta text-ink-faint">—</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {hasLinked && (
            <section>
              <h2 className={SECTION_LABEL}>Linked here</h2>
              <ul className="flex flex-col gap-1">
                {data.linkedHere.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/items/${l.id}`}
                      className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
                    >
                      <span className="truncate">{l.title.trim() || "Untitled"}</span>
                      <span className="ui-meta shrink-0 text-ink-faint">{l.typeLabel}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
