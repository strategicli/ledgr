// The one-writer-per-item document store (ADR-146, hard-to-reverse decision #3).
// The Desk can show the same item in several panels, but only ONE may be an
// editor — two mounted ItemEditors on one item would both debounce PATCH and
// clobber each other. The Desk enforces this structurally: only the focused
// panel's active item mounts the (reused, untouched) ItemEditor; every other
// panel showing an item is a read-only MarkdownPreview.
//
// This store is the truth *between* saves. It:
//   - fetches each item once (GET /api/items/[id]) and caches it, so opening the
//     same item in a second panel or re-focusing a panel doesn't refetch;
//   - holds the live title/markdown the focused editor publishes on each
//     keystroke, so read-only twins update live and a re-focused editor
//     re-seeds from the latest text (no unsaved edits lost when the pen moves).
//
// The existing save path (ItemEditor's 1500ms debounce → PATCH → revisions) is
// untouched: this store never writes to the server.
"use client";

import { useSyncExternalStore } from "react";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";

export type DocState = {
  status: "loading" | "ready" | "error";
  id: string;
  title: string; // last title loaded/synced
  type: string; // the item's type key (ADR-147 D4: drives canvas-tabs enablement)
  body: unknown; // last body loaded ({ format, text }); preserves non-md formats
  // Live text the focused editor has published (reflects unsaved edits). Seeded
  // from the loaded item so a twin has something to show before the first edit.
  liveTitle: string;
  liveMarkdown: string;
  // True once the live markdown has diverged from the loaded body — then a
  // re-seeded editor uses the live markdown; until then it uses the original
  // body object (keeping any non-markdown format intact).
  dirty: boolean;
};

const docs = new Map<string, DocState>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(id: string, next: DocState) {
  docs.set(id, next);
  emit();
}

// Kick off the one fetch for an item if we haven't already. Idempotent.
export function ensureDoc(id: string): void {
  if (typeof window === "undefined") return;
  if (docs.has(id) || inFlight.has(id)) return;
  inFlight.add(id);
  set(id, {
    status: "loading",
    id,
    title: "",
    type: "",
    body: null,
    liveTitle: "",
    liveMarkdown: "",
    dirty: false,
  });
  fetch(`/api/items/${id}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      const item = data?.item ?? {};
      const title = typeof item.title === "string" ? item.title : "";
      const type = typeof item.type === "string" ? item.type : "";
      const md = bodyMarkdown(item.body);
      set(id, {
        status: "ready",
        id,
        title,
        type,
        body: item.body ?? null,
        liveTitle: title,
        liveMarkdown: md,
        dirty: false,
      });
    })
    .catch(() => {
      const prev = docs.get(id);
      set(id, {
        status: "error",
        id,
        title: prev?.title ?? "",
        type: prev?.type ?? "",
        body: prev?.body ?? null,
        liveTitle: prev?.liveTitle ?? "",
        liveMarkdown: prev?.liveMarkdown ?? "",
        dirty: prev?.dirty ?? false,
      });
    })
    .finally(() => inFlight.delete(id));
}

// The focused editor publishes here on every change so twins stay live and a
// re-seed after the pen moves carries unsaved text.
export function publishLive(
  id: string,
  next: { title?: string; markdown?: string }
): void {
  const prev = docs.get(id);
  if (!prev) return;
  const liveTitle = next.title ?? prev.liveTitle;
  const liveMarkdown = next.markdown ?? prev.liveMarkdown;
  if (liveTitle === prev.liveTitle && liveMarkdown === prev.liveMarkdown) return;
  const dirty = prev.dirty || liveMarkdown !== bodyMarkdown(prev.body);
  set(id, { ...prev, liveTitle, liveMarkdown, dirty });
}

export function getDoc(id: string): DocState | undefined {
  return docs.get(id);
}

// The { id, title, body } an ItemEditor should mount with: latest live title,
// and the live markdown once edited (else the original body object, so a
// non-markdown format survives an unedited open).
export function seedForEditor(id: string): {
  id: string;
  title: string;
  body: unknown;
} | null {
  const doc = docs.get(id);
  if (!doc || doc.status !== "ready") return null;
  return {
    id,
    title: doc.liveTitle,
    body: doc.dirty ? makeMarkdownBody(doc.liveMarkdown) : doc.body,
  };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Subscribe a component to one item's doc state, kicking off the fetch on first
// use. Returns undefined until the fetch is registered (next tick sets loading).
export function useDoc(id: string): DocState | undefined {
  ensureDoc(id);
  return useSyncExternalStore(
    subscribe,
    () => docs.get(id),
    () => undefined
  );
}

// --- Canvas-tabs enablement (ADR-147 D4) -----------------------------------
// Mirror MarkdownCanvas's rule (`item.type === "note" || typeDef.capability ===
// "tabs"`) on the client so a panel's writer renders TabbedBody. `note` is
// auto-on and known from the doc alone; any other type opts in via the `tabs`
// capability, which we learn from the type registry (fetched once, cached).
const tabsCapableTypes = new Set<string>();
let tabsTypesLoaded = false;
let tabsTypesInFlight = false;

function ensureTabsTypes(): void {
  if (typeof window === "undefined" || tabsTypesLoaded || tabsTypesInFlight) return;
  tabsTypesInFlight = true;
  fetch("/api/types")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => {
      for (const t of Array.isArray(d?.types) ? d.types : []) {
        if (t?.capability === "tabs" && typeof t.key === "string") {
          tabsCapableTypes.add(t.key);
        }
      }
      tabsTypesLoaded = true;
      emit(); // re-read: a tabs-capability type flips on once the registry lands
    })
    .catch(() => {})
    .finally(() => {
      tabsTypesInFlight = false;
    });
}

// True when an item of this type edits its body as canvas tabs. `note` resolves
// synchronously; a custom tabs-capability type resolves once the registry loads
// (a brief false → true flip on first ever open, then cached for the session).
export function useTabsEnabled(type: string | undefined): boolean {
  ensureTabsTypes();
  return useSyncExternalStore(
    subscribe,
    () => (type === "note" ? true : type ? tabsCapableTypes.has(type) : false),
    () => false
  );
}
