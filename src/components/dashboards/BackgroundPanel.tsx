// The dashboard stage editor (ADR-111 DC2, edit mode). A "Background" button
// opens a popover: background kind (none / color / gradient / image URL), curated
// color + gradient swatches, an image URL field, scrim + blur sliders, and the
// title-visibility + density toggles. Emits the full DashboardAppearance on every
// change; "Clear" resets to a plain dashboard (null). No upload/video here yet —
// that's a guarded follow-up; the parser keeps the seam.
"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_DASHBOARD_APPEARANCE,
  STAGE_COLOR_TOKENS,
  STAGE_GRADIENT_TOKENS,
  type DashboardAppearance,
  type StageBackground,
  type StageBgKind,
  type StageDensity,
} from "@/lib/dashboard-widgets";
import { usePopoverAlign } from "./use-popover-align";

const KIND_OPTS: { value: StageBgKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "color", label: "Color" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image URL" },
];

const field = "text-xs text-neutral-400";

export default function BackgroundPanel({
  appearance,
  onChange,
}: {
  appearance: DashboardAppearance | null;
  onChange: (appearance: DashboardAppearance | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { triggerRef, alignLeft, measure } = usePopoverAlign(288);
  const ap = appearance ?? DEFAULT_DASHBOARD_APPEARANCE;
  const bg = ap.background;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const setBg = (patch: Partial<StageBackground>) =>
    onChange({ ...ap, background: { ...bg, ...patch } });

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => {
          if (!open) measure();
          setOpen((v) => !v);
        }}
        className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:border-neutral-600"
      >
        Background
      </button>
      {open && (
        <div
          className={`absolute ${alignLeft ? "left-0" : "right-0"} z-30 mt-2 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl`}
        >
          <div className="flex flex-col gap-2">
            <label className={field}>
              Background
              <select
                value={bg.kind}
                onChange={(e) => setBg({ kind: e.target.value as StageBgKind })}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
              >
                {KIND_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {bg.kind === "color" && (
              <SwatchRow
                tokens={Object.entries(STAGE_COLOR_TOKENS)}
                value={bg.value}
                onPick={(v) => setBg({ value: v })}
                render={(css) => ({ backgroundColor: css })}
              />
            )}
            {bg.kind === "gradient" && (
              <SwatchRow
                tokens={Object.entries(STAGE_GRADIENT_TOKENS)}
                value={bg.value}
                onPick={(v) => setBg({ value: v })}
                render={(css) => ({ backgroundImage: css })}
              />
            )}
            {bg.kind === "image" && (
              <label className={field}>
                Image URL
                <input
                  type="text"
                  value={bg.value}
                  placeholder="https://…"
                  onChange={(e) => setBg({ value: e.target.value })}
                  className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
                />
              </label>
            )}

            {bg.kind !== "none" && (
              <>
                <Slider
                  label="Scrim (darken)"
                  value={bg.scrim}
                  onChange={(scrim) => setBg({ scrim })}
                />
                <Slider label="Blur" value={bg.blur} onChange={(blur) => setBg({ blur })} />
              </>
            )}

            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={ap.showTitle}
                onChange={(e) => onChange({ ...ap, showTitle: e.target.checked })}
              />
              Show the dashboard title
            </label>
            <label className={field}>
              Density
              <select
                value={ap.density}
                onChange={(e) => onChange({ ...ap, density: e.target.value as StageDensity })}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>

            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-1 self-start text-xs text-neutral-500 hover:text-neutral-300"
            >
              Clear background
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SwatchRow({
  tokens,
  value,
  onPick,
  render,
}: {
  tokens: [string, string][];
  value: string;
  onPick: (token: string) => void;
  render: (css: string) => React.CSSProperties;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map(([token, css]) => (
        <button
          key={token}
          type="button"
          title={token}
          aria-label={token}
          onClick={() => onPick(token)}
          style={render(css)}
          className={`h-7 w-7 rounded ${
            value === token ? "ring-2 ring-offset-1 ring-offset-neutral-900 ring-neutral-300" : "ring-1 ring-neutral-700"
          }`}
        />
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className={field}>
      {label}
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-neutral-400"
      />
    </label>
  );
}
