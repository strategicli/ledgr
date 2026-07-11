// The standardized item-canvas panel (the canvas redesign). Every section on an
// item view — People, Open tasks, Properties, Linked here, Transcripts, a
// module's own panel — renders through this, so they share one header shape
// (icon + label + count + a right-aligned action) and one visual weight.
//
// The weight is NOT decided here: it's driven by `data-section-style` on <body>
// (a per-owner setting, see settings.ts), and the CSS in globals.css styles
// `.canvas-section` per skin — heavy (bordered card), light (a divider rule),
// unified (flat). A panel built later inherits the chosen weight for free.
//
// Two render modes: the default wraps the card in the centered reading column
// (the classic stacked canvas); `bare` drops the column AND the card chrome, for
// when the per-type grid (ADR-069) already provides a card around it.
import type { ReactNode } from "react";
import NavGlyph from "@/components/nav/NavGlyph";

export default function CanvasSection({
  icon,
  title,
  count,
  action,
  children,
  bare = false,
  className = "",
  // When set (a boolean), the section is collapsible: it renders as a native
  // <details> with the header as its <summary>, open iff `defaultOpen`. Left
  // undefined, the section is always open (the classic behavior). Used for the
  // event canvas's rarely-opened Transcripts/Notes (Brandon, 2026-07-10).
  defaultOpen,
}: {
  icon?: string;
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  className?: string;
  defaultOpen?: boolean;
}) {
  const titleEl = (
    <h3 className="canvas-section-title">
      {defaultOpen !== undefined && (
        <svg
          className="cs-caret shrink-0 text-ink-subtle"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
      {icon && <NavGlyph icon={icon} size={14} className="canvas-section-icon shrink-0" />}
      <span>{title}</span>
      {count != null && <span className="canvas-section-count">{count}</span>}
    </h3>
  );
  const actionEl = action ? <div className="canvas-section-action">{action}</div> : null;

  const sectionClass = `canvas-section ${bare ? "canvas-section-bare " : ""}${className}`;

  // Collapsible: a native <details>; the header becomes a clickable <summary>.
  if (defaultOpen !== undefined) {
    const details = (
      <details className={sectionClass} open={defaultOpen}>
        <summary className="canvas-section-head canvas-section-summary">
          {titleEl}
          {actionEl}
        </summary>
        {children}
      </details>
    );
    return bare ? (
      details
    ) : (
      <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
        {details}
      </div>
    );
  }

  const head = (
    <div className="canvas-section-head">
      {titleEl}
      {actionEl}
    </div>
  );

  if (bare) {
    return (
      <section className={`canvas-section canvas-section-bare ${className}`}>
        {head}
        {children}
      </section>
    );
  }

  return (
    <div className="canvas-section-wrap mx-auto w-full max-w-3xl px-2 sm:px-8 md:px-12">
      <section className={`canvas-section ${className}`}>
        {head}
        {children}
      </section>
    </div>
  );
}
