import { useEffect, useState } from "react";

// True at the `sm` breakpoint (≥640px) and up — the desktop editing posture.
// Below it the mobile toolbar rules apply: the formatting bar floats above the
// on-screen keyboard and must ALWAYS show its buttons (never a collapse toggle,
// which is a desktop-only affordance). Lazily initialized from matchMedia so the
// very first render is already correct — the editor is client-only (ssr:false),
// so `window` is always present here and there's no hydration mismatch to guard.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 640px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
