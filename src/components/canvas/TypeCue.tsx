// A quiet, non-interactive type-identity cue: the type's own nav icon + label
// (ADR-132). It rides chrome that's already on screen — the modal header next to
// "Trash", and the full-page breadcrumb row — so it costs no extra vertical
// space. Reuses NavGlyph (the same icon source the nav, type builder, and
// @-mentions read), so a re-iconed or custom type carries through for free.
//
// Presentational and hook-free, so it renders on the server (ItemCanvas) and the
// client (Modal) alike. An unknown/unset icon key falls back to a generic glyph
// via NavGlyph.
import NavGlyph from "@/components/nav/NavGlyph";

export default function TypeCue({
  icon,
  label,
  className,
}: {
  icon: string | null;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center gap-1 text-neutral-500 ${className ?? ""}`}
      title={label}
    >
      <NavGlyph icon={icon ?? ""} size={14} />
      <span className="text-xs">{label}</span>
    </span>
  );
}
