// The "N words" chrome label. A client island so it can follow the body editor's
// live text (src/lib/word-count.ts) instead of only the server-rendered count;
// `initial` is that server count, shown until the editor publishes.
"use client";

import { useWordCount } from "@/lib/word-count";

export default function WordCount({
  itemId,
  initial,
}: {
  itemId: string;
  initial: number;
}) {
  const n = useWordCount(itemId, initial);
  return (
    <>
      {n.toLocaleString()} {n === 1 ? "word" : "words"}
    </>
  );
}
