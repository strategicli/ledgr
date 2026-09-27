// One playback speed for everything that plays in Ledgr: the Listen bar's
// read-aloud, Claude's read-aloud replies, and audio players like a song's
// preview track. Remembered per device (localStorage), so changing it in one
// place changes it everywhere. The key predates this file (it was the Listen
// bar's own), which keeps a speed already saved there.
"use client";

export const SPEED_STORAGE_KEY = "ledgr.listen.rate";
// Up to 3x: speechSynthesis caps rate at 10, but voices vary in how gracefully
// they speed up, so past 3x most become unintelligible.
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

// The saved speed, snapped to the nearest option (an older 0.8 or 1.2 lands on
// its neighbour instead of being dropped).
export function readSpeed(): number {
  try {
    const saved = parseFloat(localStorage.getItem(SPEED_STORAGE_KEY) ?? "");
    if (!Number.isFinite(saved)) return 1;
    return SPEED_OPTIONS.reduce((a, b) => (Math.abs(b - saved) < Math.abs(a - saved) ? b : a));
  } catch {
    return 1; // localStorage can throw in a locked-down context.
  }
}

export function writeSpeed(n: number): void {
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(n));
  } catch {
    // Best-effort persistence only.
  }
}

export default function SpeedSelect({
  value,
  onChange,
  label = "Speed",
  className = "",
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-1.5 text-ink-subtle ${className}`} title="Playback speed, remembered on this device">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          writeSpeed(n);
          onChange(n);
        }}
        className="rounded-card border border-line-strong bg-surface-2 px-1.5 py-0.5 text-ink-muted"
      >
        {SPEED_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </label>
  );
}
