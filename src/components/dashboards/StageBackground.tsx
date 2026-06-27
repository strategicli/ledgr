// The dashboard "stage" (ADR-111 DC2): a full-bleed background behind the grid,
// with an adjustable dark scrim + blur so widgets stay legible over a photo.
// Pure chrome — the export/print/share paths never see it (Principle 4). Color
// and gradient resolve to CSS; image/video resolve to their own tags. Video is
// guarded (muted/looped/playsInline + a poster, paused via the browser when the
// tab is hidden) and disabled under prefers-reduced-motion via CSS; the edit UI
// doesn't offer it yet, so this is mainly the seam.
"use client";

import { stageBackgroundCss, type DashboardAppearance } from "@/lib/dashboard-widgets";

export default function StageBackground({
  appearance,
}: {
  appearance: DashboardAppearance | null;
}) {
  if (!appearance || appearance.background.kind === "none") return null;
  const bg = appearance.background;
  const css = stageBackgroundCss(bg);
  const blurPx = Math.round(bg.blur * 16);
  const layerStyle: React.CSSProperties = {
    ...(css?.color ? { backgroundColor: css.color } : {}),
    ...(css?.image ? { backgroundImage: css.image, backgroundSize: "cover", backgroundPosition: "center" } : {}),
    ...(blurPx ? { filter: `blur(${blurPx}px)`, transform: "scale(1.05)" } : {}),
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {(bg.kind === "color" || bg.kind === "gradient") && (
        <div className="absolute inset-0" style={layerStyle} />
      )}
      {bg.kind === "image" && bg.value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bg.value}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={blurPx ? { filter: `blur(${blurPx}px)`, transform: "scale(1.05)" } : undefined}
        />
      )}
      {bg.kind === "video" && bg.value && (
        <video
          className="dash-stage-video absolute inset-0 h-full w-full object-cover"
          style={blurPx ? { filter: `blur(${blurPx}px)`, transform: "scale(1.05)" } : undefined}
          autoPlay
          muted
          loop
          playsInline
        >
          <source src={bg.value} />
        </video>
      )}
      {/* Scrim: a dark overlay so widgets read over any background. */}
      <div className="absolute inset-0 bg-black" style={{ opacity: bg.scrim }} />
    </div>
  );
}
