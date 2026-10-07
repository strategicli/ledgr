// The browser tab shows the unread count (ADR-292): "(2) Ledgr" in the title
// and a red dot on the tab icon, so a notification is visible from another tab
// even when the system banner was filed away quietly. Next.js rewrites the
// title on every navigation (sometimes swapping the element), so an observer
// on <head> re-applies the prefix.
"use client";

import { useEffect } from "react";

const PREFIX = /^\(\d+\+?\) /;

function applyTitle(n: number) {
  const base = document.title.replace(PREFIX, "");
  const next = n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
  if (document.title !== next) document.title = next;
}

// Draw the current icon with a red dot, once per change; restore the original
// at zero. Any failure (icon not loaded, canvas blocked) leaves the icon alone.
function applyIcon(n: number, original: { href: string } | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link || !original) return;
  if (n <= 0) {
    link.href = original.href;
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.arc(50, 14, 13, 0, Math.PI * 2);
      ctx.fill();
      link.href = c.toDataURL("image/png");
    } catch {
      // leave the icon as it is
    }
  };
  img.src = original.href;
}

export default function TabUnread({ count }: { count: number }) {
  useEffect(() => {
    applyTitle(count);
    // Watch the whole <head>: a navigation can replace the <title> element
    // itself, not just its text.
    const obs = new MutationObserver(() => applyTitle(count));
    obs.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [count]);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    const original = { href: link.dataset.ledgrOriginal ?? link.href };
    link.dataset.ledgrOriginal = original.href;
    applyIcon(count, original);
  }, [count]);

  return null;
}
