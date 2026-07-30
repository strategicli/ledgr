import { useEffect, useState } from "react";

// Live match for a media query. Lazily initialized from matchMedia so the very
// first render is already correct — the callers are client-only (ssr:false), so
// `window` is always present and there's no hydration mismatch to guard.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

// True at the `sm` breakpoint (≥640px) and up — the desktop editing posture.
// Below it the mobile toolbar rules apply: the formatting bar floats above the
// on-screen keyboard and must ALWAYS show its buttons (never a collapse toggle,
// which is a desktop-only affordance).
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 640px)");
}
