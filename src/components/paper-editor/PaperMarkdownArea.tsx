// A plain raw-markdown textarea for the Papers module (P3). Papers are
// footnote-heavy academic prose, and footnotes ([^id] markers + definitions)
// are a raw-markdown feature the shared Tiptap WYSIWYG editor neither renders
// nor exposes an insertion handle for. A monospace textarea is the honest v1
// surface (the scoped plan's "textarea → CodeMirror later"): it makes [^id]
// first-class and lets the parent insert a citation at the caret. Used for both
// the Draft (canonical body) and the Outline (scaffold) tabs.
//
// forwardRef exposes the underlying <textarea> so PaperCanvasClient can read the
// selection and splice a footnote in. Controlled: value + onChange are the
// parent's, kept canonical so autosave sees every keystroke.
"use client";

import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

const PaperMarkdownArea = forwardRef<HTMLTextAreaElement, Props>(
  function PaperMarkdownArea({ value, onChange, placeholder, ariaLabel }, ref) {
    return (
      <textarea
        ref={ref}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck
        className="min-h-[60vh] w-full resize-y rounded border border-neutral-800 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-200 outline-none focus:border-neutral-600"
      />
    );
  }
);

export default PaperMarkdownArea;
