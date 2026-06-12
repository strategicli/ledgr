// The BlockNote editor proper. Never import this module directly from a
// page: it pulls the whole editor bundle, so it must only ever load through
// LazyEditor (code-split, client-only; CLAUDE.md rule 8 / PRD §6.4).
"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { filterSuggestionItems } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { schema, type LedgrEditor } from "./schema";

export type EditorProps = {
  // The item whose body this is; uploads attach to it and the @-menu
  // excludes it from results.
  itemId: string;
  initialBody?: unknown;
  // Fired with the full document on every edit; the host debounces saves.
  onBodyChange: (document: unknown) => void;
};

// Presigned-upload flow (PRD §3.4): metadata row + URL from our API, bytes
// straight to R2, public CDN URL back into the document.
async function uploadFile(itemId: string, file: File): Promise<string> {
  const res = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId,
      filename: file.name || "pasted-image.png",
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `upload rejected (${res.status})`);
  }
  const { uploadUrl, publicUrl } = await res.json();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
  return publicUrl;
}

async function getMentionItems(
  editor: LedgrEditor,
  itemId: string,
  query: string
): Promise<DefaultReactSuggestionItem[]> {
  const params = new URLSearchParams({ limit: "10" });
  if (query) params.set("q", query);
  const res = await fetch(`/api/items?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items: { id: string; title: string; type: string }[];
  };
  return data.items
    .filter((it) => it.id !== itemId)
    .map((it) => ({
      title: it.title || "Untitled",
      subtext: it.type,
      onItemClick: () => {
        editor.insertInlineContent([
          {
            type: "mention",
            props: { itemId: it.id, title: it.title || "Untitled" },
          },
          " ",
        ]);
      },
    }));
}

export default function Editor({
  itemId,
  initialBody,
  onBodyChange,
}: EditorProps) {
  const editor = useCreateBlockNote({
    schema,
    initialContent:
      Array.isArray(initialBody) && initialBody.length > 0
        ? (initialBody as never)
        : undefined,
    uploadFile: (file) => uploadFile(itemId, file),
  });

  return (
    <BlockNoteView
      editor={editor}
      theme="light"
      onChange={() => onBodyChange(editor.document)}
    >
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={async (query) =>
          // The server does the matching (title ILIKE); the client-side
          // filter only trims while a request is in flight.
          filterSuggestionItems(
            await getMentionItems(editor, itemId, query),
            query
          )
        }
      />
    </BlockNoteView>
  );
}
