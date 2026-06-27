// Client helpers for the bulk endpoints (/api/items/batch, ADR-118). Both chunk
// the selection into CHUNK-sized requests (the server caps each at 200) and run
// them sequentially, aggregating the per-id errors. Sequential, not parallel:
// these reuse updateItem/softDeleteItem one row at a time on the server, and a
// burst of parallel requests would just contend on the pooled connection (rule
// 8). A returned non-empty `errors` is surfaced by the caller.
"use client";

const CHUNK = 200;

export type BulkResult = { count: number; errors: { id: string; error: string }[] };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function send(
  method: "PATCH" | "DELETE",
  ids: string[],
  patch?: Record<string, unknown>
): Promise<BulkResult> {
  const result: BulkResult = { count: 0, errors: [] };
  for (const part of chunk(ids, CHUNK)) {
    const res = await fetch("/api/items/batch", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(method === "PATCH" ? { ids: part, patch } : { ids: part }),
    });
    const data = (await res.json().catch(() => null)) as BulkResult | { error?: string } | null;
    if (!res.ok && (!data || !("errors" in data))) {
      // A whole-request failure (bad patch, unauthorized): attribute it to the
      // chunk so the count/total still reconciles for the caller.
      const error = (data && "error" in data && data.error) || `HTTP ${res.status}`;
      result.errors.push(...part.map((id) => ({ id, error })));
      continue;
    }
    if (data && "errors" in data) {
      result.count += data.count ?? 0;
      result.errors.push(...(data.errors ?? []));
    }
  }
  return result;
}

export function bulkPatch(ids: string[], patch: Record<string, unknown>) {
  return send("PATCH", ids, patch);
}

export function bulkDelete(ids: string[]) {
  return send("DELETE", ids);
}
