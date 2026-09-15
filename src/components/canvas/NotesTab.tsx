// The Notes tab shared by the paper and song canvases (Tyler, 2026-09-14).
//
// Both of those types spend their body on a finished artifact — a paper's
// canonical draft, a song's ChordPro chart — which left nowhere to do the
// thinking that comes before one. This is that place: the ordinary markdown
// writing surface every other type gets by default, mounted over
// items.properties.notes instead of over the body.
//
// It is deliberately just BodyEditor. The rich/source/preview switch, the
// slash menu, @-mentions, attachments, and the large-body gate are all
// behaviors of that component, so a note written here behaves like a note
// written anywhere else. Persistence is the HOST's job (this component only
// reports markdown up), because the two hosts have different write contracts:
// PaperCanvasClient is the single writer of its item's properties and must fold
// notes into its own object, while ChordCanvasClient shares properties with the
// generic panel and writes a per-key propertyPatch. Search comes from
// extractBodyText folding properties.notes into body_text (lib/body-text.ts).
"use client";

import { useCallback } from "react";
import BodyEditor from "@/components/markdown-editor/BodyEditor";
import { uploadAttachment } from "@/components/attachments/upload";

type Props = {
  itemId: string;
  initialNotes: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
};

export default function NotesTab({ itemId, initialNotes, onChange, placeholder }: Props) {
  // Same presigned-upload handshake ItemEditor uses, resolved to the stable
  // /files/<id> address the markdown stores (fileUrl, not publicUrl, ADR-228).
  const uploadFile = useCallback(
    async (file: File) => (await uploadAttachment(itemId, file)).fileUrl,
    [itemId]
  );

  return (
    <div className="flex flex-col gap-2">
      {placeholder && <p className="text-sm text-ink-subtle">{placeholder}</p>}
      <BodyEditor
        itemId={itemId}
        initialMarkdown={initialNotes}
        onChange={onChange}
        uploadFile={uploadFile}
      />
    </div>
  );
}
