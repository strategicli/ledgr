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
}: {
  icon?: string;
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  className?: string;
}) {
  const head = (
    <div className="canvas-section-head">
      <h3 className="canvas-section-title">
        {icon && <NavGlyph icon={icon} size={14} className="canvas-section-icon shrink-0" />}
        <span>{title}</span>
        {count != null && <span className="canvas-section-count">{count}</span>}
      </h3>
      {action && <div className="canvas-section-action">{action}</div>}
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
