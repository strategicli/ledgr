// The "N words" chrome label. A client island so it can follow the body editor's
// live text (src/lib/word-count.ts) instead of only the server-rendered count;
// `initial` is that server count, shown until the editor publishes.
"use client";

import { useWordCount } from "@/lib/word-count";

export default function WordCount({
  itemId,
  initial,
  live = true,
}: {
  itemId: string;
  initial: number;
  // false = show the server count as-is. Used by widget-home records, whose
  // count covers the COMPOSED project document (ADR-197): the Overview editor
  // publishes overview-only text, which must not overwrite the document count.
  live?: boolean;
}) {
  const liveCount = useWordCount(itemId, initial);
  const n = live ? liveCount : initial;
  return (
    <>
      {n.toLocaleString()} {n === 1 ? "word" : "words"}
    </>
  );
}
