// The Outline preview (Papers module; v5 feedback round 3). The read-only viewer
// the writer drafts from — paragraph notes + their filed quotes, with click-to-
// copy footnotes (Full/Short/Ibid), exactly the file that downloads as the
// outline's output. Rendered in a sandboxed iframe via srcDoc so its (Georgia,
// light) styling + copy script are isolated from the app shell, and so the
// in-app preview is byte-identical to the exported page.
"use client";

import { buildOutlineHtml } from "@/lib/papers/outline-html";
import type { OutlineSection, QuoteEntry } from "@/lib/papers/types";

export default function OutlinePreview({
  title,
  subtitle,
  sections,
  quotes,
}: {
  title: string;
  subtitle?: string;
  sections: OutlineSection[];
  quotes: QuoteEntry[];
}) {
  const html = buildOutlineHtml({ title, subtitle, sections, quotes });
  return (
    <iframe
      title="Outline preview"
      srcDoc={html}
      // allow-same-origin so the copy script can reach the clipboard; no
      // allow-scripts→same-origin escape risk since the content is ours.
      sandbox="allow-scripts allow-same-origin"
      className="h-[70vh] w-full rounded-lg border border-neutral-800 bg-white"
    />
  );
}
