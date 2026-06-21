// User Settings form (v5). Display name, highlight accent (solid colors or a
// gradient), Trash retention, and the nav layout controls (position + spacing) —
// the same controls offered in the nav "More" menu, mirrored here. Each change
// saves to /api/settings; the accent updates the live `--accent` /
// `--accent-gradient` CSS variables immediately, and nav-layout changes
// router.refresh() so the live nav re-renders without a manual reload.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_GRADIENTS,
  NAV_POSITIONS,
  TEXT_SIZES,
  TEXT_SIZE_PX,
  type RailAnchor,
  type TextSize,
  type UserSettings,
} from "@/lib/settings";

const POSITION_LABELS: Record<UserSettings["navPosition"], string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

export default function SettingsForm({ initial }: { initial: UserSettings }) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const isRail = settings.navPosition === "left" || settings.navPosition === "right";

  // Push the chosen accent to the live CSS vars: `--accent` is always a solid
  // (so text/borders/glows stay valid); `--accent-gradient` is the gradient when
  // one is picked, else the same solid.
  const applyAccent = (color: string, gradient: string | null) => {
    document.body.style.setProperty("--accent", color);
    document.body.style.setProperty("--accent-gradient", gradient ?? color);
  };

  const applyTextSize = (size: TextSize) => {
    document.body.style.setProperty("--prose-font-size", TEXT_SIZE_PX[size]);
  };

  const save = async (patch: Partial<UserSettings>, refresh = false) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      // Nav layout is rendered server-side (Nav → NavShell); refresh so a
      // position/spacing change shows up live, matching the More-menu behavior.
      if (refresh) router.refresh();
    } catch {
      /* offline; the next change retries */
    }
  };

  // The segmented-button look from the nav "More" menu.
  const segBtn = (active: boolean) =>
    `rounded px-2 py-1.5 text-xs ${
      active
        ? "bg-neutral-700 text-neutral-100"
        : "text-neutral-300 hover:bg-neutral-800"
    }`;

  const setSpacing = (density: "spread" | "compact", anchor?: RailAnchor) =>
    void save(
      { navDensity: density, ...(anchor ? { railAnchor: anchor } : {}) },
      true
    );
  const spacingActive = (density: "spread" | "compact", anchor?: RailAnchor) =>
    settings.navDensity === density && (!anchor || settings.railAnchor === anchor);

  return (
    <div className="mt-6 flex max-w-xl flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Display name</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Shown wherever your name appears in the app. Leave blank to use your
          email name.
        </p>
        <input
          type="text"
          maxLength={60}
          placeholder="Your name"
          value={settings.displayName}
          onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
          onBlur={() => void save({ displayName: settings.displayName })}
          className="mt-2 w-48 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Highlight color</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          The accent used for primary buttons and highlights.
        </p>
        <div className="mt-2 flex max-w-md flex-wrap gap-2">
          {HIGHLIGHT_COLORS.map((c) => {
            const selected = !settings.highlightGradient && settings.highlightColor === c.value;
            return (
              <button
                key={c.value}
                onClick={() => {
                  applyAccent(c.value, null);
                  void save({ highlightColor: c.value, highlightGradient: null });
                }}
                aria-label={c.name}
                aria-pressed={selected}
                title={c.name}
                className={`h-7 w-7 rounded-full border-2 ${selected ? "border-neutral-100" : "border-transparent"}`}
                style={{ background: c.value }}
              />
            );
          })}
        </div>

        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-600">
          Gradients
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          Applied to accent fills (checkboxes, count badges); text and borders use
          a matching solid tone.
        </p>
        <div className="mt-2 flex max-w-md flex-wrap gap-2">
          {HIGHLIGHT_GRADIENTS.map((g) => {
            const selected = settings.highlightGradient === g.value;
            return (
              <button
                key={g.value}
                onClick={() => {
                  applyAccent(g.accent, g.value);
                  void save({ highlightColor: g.accent, highlightGradient: g.value });
                }}
                aria-label={g.name}
                aria-pressed={selected}
                title={g.name}
                className={`h-7 w-7 rounded-full border-2 ${selected ? "border-neutral-100" : "border-transparent"}`}
                style={{ background: g.value }}
              />
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Trash retention</h2>
        <p className="mt-0.5 text-sm text-neutral-500">Days a trashed item is kept before it is purged.</p>
        <input
          type="number"
          min={1}
          max={365}
          value={settings.trashRetentionDays}
          onChange={(e) => void save({ trashRetentionDays: Number(e.target.value) || 30 })}
          className="mt-2 w-24 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Text size</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Font size for the reading and editing canvas.
        </p>
        <div className="mt-2 flex gap-1">
          {TEXT_SIZES.map((size) => {
            const labels: Record<TextSize, string> = { sm: "S", base: "M", lg: "L", xl: "XL" };
            return (
              <button
                key={size}
                onClick={() => {
                  applyTextSize(size);
                  void save({ textSize: size });
                }}
                className={segBtn(settings.textSize === size)}
              >
                {labels[size]}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-200">Navigation position</h2>
        <p className="mt-0.5 text-sm text-neutral-500">Where the nav bar sits.</p>
        <div className="mt-2 grid w-48 grid-cols-2 gap-1">
          {NAV_POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => void save({ navPosition: p }, true)}
              className={segBtn(settings.navPosition === p)}
            >
              {POSITION_LABELS[p]}
            </button>
          ))}
        </div>
      </section>

      {/* Spacing mirrors the More menu: how the slots pack into the bar/rail.
          The bottom bar is always compact, so it offers no spacing choice. */}
      {settings.navPosition !== "bottom" && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-200">Spacing</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Spread the slots across the bar, or group them and anchor the cluster.
          </p>
          <div className="mt-2 grid w-48 grid-cols-1 gap-1">
            <button onClick={() => setSpacing("spread")} className={segBtn(spacingActive("spread"))}>
              Spread
            </button>
            <button
              onClick={() => setSpacing("compact", "top")}
              className={segBtn(spacingActive("compact", "top"))}
            >
              {isRail ? "Compact (top)" : "Compact (left)"}
            </button>
            <button
              onClick={() => setSpacing("compact", "center")}
              className={segBtn(spacingActive("compact", "center"))}
            >
              Compact (center)
            </button>
            <button
              onClick={() => setSpacing("compact", "bottom")}
              className={segBtn(spacingActive("compact", "bottom"))}
            >
              {isRail ? "Compact (bottom)" : "Compact (right)"}
            </button>
          </div>
        </section>
      )}

      {saved && <p className="text-xs text-neutral-500">Saved</p>}
    </div>
  );
}
