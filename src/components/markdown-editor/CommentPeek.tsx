// Hover a comment's speech-bubble icon to read its note without clicking (the
// "Icons" comment display, and a narrow desktop window). One listener for the
// whole app, mounted once in the root layout, so the editor and the read view
// both get it with no per-comment wiring. Clicking still opens CommentPopover.
//
// "Is this card an icon right now?" is answered by the CSS itself: the collapsed
// bubble has font-size 0 (markdown-editor.css), a full margin card never does.
// Touch has no hover, so on a phone this simply never fires; tap opens the note.
"use client";

import { useEffect, useState } from "react";

type Peek = { html: string; top: number; left: number; below: boolean };

export default function CommentPeek() {
  const [peek, setPeek] = useState<Peek | null>(null);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const note = (e.target as Element).closest?.<HTMLElement>(".cmt-note");
      if (!note || getComputedStyle(note).fontSize !== "0px") return setPeek(null);
      const r = note.getBoundingClientRect();
      const below = r.top < 160;
      setPeek({
        html: note.innerHTML,
        top: below ? r.bottom + 6 : r.top - 6,
        left: Math.min(Math.max(8, r.left - 16), window.innerWidth - 296),
        below,
      });
    };
    const hide = () => setPeek(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("mousedown", hide);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("mousedown", hide);
    };
  }, []);

  if (!peek) return null;
  return (
    <div
      role="tooltip"
      style={{
        top: peek.top,
        left: peek.left,
        transform: peek.below ? undefined : "translateY(-100%)",
      }}
      className="pointer-events-none fixed z-[70] max-w-[18rem] rounded-card border border-line-strong bg-surface-2 px-2.5 py-2 shadow-xl shadow-black/40"
    >
      {/* Same trust basis as MarkdownPreview: the owner's own note, already
          rendered (or, from the editor, plain text). Same inner shape as the
          read-only CommentPopover, so chips and bold look identical. */}
      <div
        className="ledgr-prose ledgr-prose-compact !text-[13px] !leading-snug [&>*]:my-0"
        dangerouslySetInnerHTML={{ __html: peek.html }}
      />
    </div>
  );
}
