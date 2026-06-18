// A section heading for the item-canvas panels (Meeting prep, Transcripts,
// Related, …): an optional nav glyph + the standard muted uppercase label.
// Presentational and server-safe (composes NavGlyph). The icon vocabulary is
// the shared NAV_ICONS library (ADR-056), so panel glyphs stay consistent with
// the nav and an unknown key degrades to the generic glyph rather than crashing.
import NavGlyph from "@/components/nav/NavGlyph";

export default function SectionHeading({
  icon,
  children,
}: {
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">
      {icon && <NavGlyph icon={icon} size={14} className="shrink-0" />}
      {children}
    </h3>
  );
}
