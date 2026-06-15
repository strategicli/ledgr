// A single nav icon rendered from the shared NAV_ICONS library (key -> SVG
// paths). Presentational and hook-free, so it renders on the server (the
// Build-surface preview) or the client (the picker/editor) alike. An unknown
// key falls back to a generic glyph via navIconPaths.
import { navIconPaths } from "@/lib/nav-icons";

export default function NavGlyph({
  icon,
  size = 20,
  className,
}: {
  icon: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      dangerouslySetInnerHTML={{ __html: navIconPaths(icon) }}
    />
  );
}
