"use client";

// Desktop item detail: open an item to view/edit it. Query-param route
// (/item?id=…) to stay a static export route. Reuses the REAL cloud editor +
// canvas widgets — ItemEditor (title/body, Tiptap), FieldStrip (status/dates),
// CustomProperties (the type's custom fields), SaveStatusIndicator — whose raw
// fetch("/api/…") saves travel over the IPC seam via the fetch shim. ADR-139.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { topStripFields } from "@/lib/canvas-fields";
import { resolveStatusSchema } from "@/lib/status";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import FieldStrip, { type StripValues } from "@/components/canvas/FieldStrip";
import CustomProperties from "@/components/build/CustomProperties";
import SaveStatusIndicator from "@/components/canvas/SaveStatusIndicator";

type LoadedItem = {
  id: string;
  type: string;
  title: string;
  body: unknown;
  status?: string | null;
  dueDate?: unknown;
  scheduledDate?: unknown;
  urgency?: number | null;
  meetingAt?: unknown;
  noteDate?: unknown;
  url?: string | null;
  properties?: Record<string, unknown> | null;
  updatedAt?: unknown;
};
type TypeDef = { statusSchema?: unknown; propertySchema?: unknown[] | null } | null;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ItemDetail() {
  const id = useSearchParams().get("id") ?? "";
  const [item, setItem] = useState<LoadedItem | null>(null);
  const [typeDef, setTypeDef] = useState<TypeDef>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("no item id");
      return;
    }
    apiRequest<{ item?: LoadedItem }>(`/api/items/${id}`)
      .then(async (d) => {
        const it = d.item ?? null;
        setItem(it);
        if (it?.type) {
          try {
            const t = await apiRequest<{ type?: TypeDef }>(`/api/types/${it.type}`);
            setTypeDef(t.type ?? null);
          } catch {
            /* type def optional; strip/props degrade gracefully */
          }
        }
        console.log("[page] item: " + (it?.title ?? "(none)"));
      })
      .catch((e) => {
        setError(e?.message ?? String(e));
        console.log("[page] item error: " + (e?.message ?? String(e)));
      });
  }, [id]);

  if (error) return <section className="p-6 text-red-400">Error: {error}</section>;
  if (!item) return <section className="p-6 text-neutral-500">loading…</section>;

  const strip: StripValues = {
    status: item.status ?? "",
    dueDate: iso(item.dueDate),
    scheduledDate: iso(item.scheduledDate),
    urgency: item.urgency ?? null,
    meetingAt: iso(item.meetingAt),
    noteDate: iso(item.noteDate),
    url: item.url ?? null,
  };
  const fields = topStripFields(item.type);
  const statuses = resolveStatusSchema((typeDef?.statusSchema as never) ?? null);
  const propertySchema = (typeDef?.propertySchema ?? []) as unknown[];
  const loadedAt = item.updatedAt
    ? new Date(item.updatedAt as string).toISOString()
    : new Date().toISOString();

  return (
    <section className="mx-auto max-w-3xl p-6">
      <ItemEditor
        item={{ id: item.id, title: item.title, body: item.body }}
        fields={
          fields.length ? (
            <FieldStrip
              itemId={item.id}
              fields={fields}
              initial={strip}
              today={todayYmd()}
              statuses={statuses}
            />
          ) : undefined
        }
      />
      {propertySchema.length ? (
        <div className="mt-4">
          <CustomProperties
            itemId={item.id}
            typeKey={item.type}
            schema={propertySchema as never}
            initial={item.properties ?? {}}
          />
        </div>
      ) : null}
      <SaveStatusIndicator itemId={item.id} loadedAt={loadedAt} />
    </section>
  );
}

export default function ItemPage() {
  return (
    <Suspense fallback={<section className="p-6 text-neutral-500">loading…</section>}>
      <ItemDetail />
    </Suspense>
  );
}
