// Pure boundary validator for the live-follow player state (step 6). Kept
// DB-free so it has its own verify script; live.ts (DB) imports it.
export type LiveState = {
  i: number;
  step: number;
  blank: "" | "black" | "title";
  countdownEnd: number | null;
  build: boolean;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Returns a clamped/typed copy, or null if the shape is not a state at all.
export function parseLiveState(value: unknown): LiveState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isFiniteNumber(v.i) || !isFiniteNumber(v.step)) return null;
  if (v.blank !== "" && v.blank !== "black" && v.blank !== "title") return null;
  if (v.countdownEnd !== null && !isFiniteNumber(v.countdownEnd)) return null;
  return {
    i: Math.max(0, Math.floor(v.i)),
    step: Math.max(0, Math.floor(v.step)),
    blank: v.blank,
    countdownEnd: v.countdownEnd === null ? null : Math.floor(v.countdownEnd),
    build: v.build === true,
  };
}
