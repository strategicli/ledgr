import { useEffect, useState } from "react";

// How many pixels the on-screen (software) keyboard overlaps the layout
// viewport from the bottom. 0 when no keyboard is shown or when the platform
// has no visualViewport (older/embedded webviews) — callers then fall back to
// docking at the bottom edge.
//
// This is the one genuinely new primitive for the mobile editor: a bottom-pinned
// formatting bar must sit on *top* of the keyboard, and a plain
// `position: fixed; bottom: 0` sits behind it. The layout viewport doesn't
// shrink when the keyboard opens, but the visual viewport does, so the overlap
// is innerHeight - (visualViewport height + its top offset).
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      // iOS Safari emits transient values mid-animation; clamp and round.
      setInset(Math.max(0, Math.round(overlap)));
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
