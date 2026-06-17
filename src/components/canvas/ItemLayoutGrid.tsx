// Dynamic ssr:false wrapper around the item-canvas grid (ADR-069), mirroring
// DashboardGridLayout → RglInner. RGL measures window width on mount, so it can't
// server-render; keeping it behind the dynamic boundary also keeps RGL's JS/CSS
// off item pages that render the classic canvas (the null-layout common case).
// The card contents are server components passed straight through as the `nodes`
// prop — the server renders them; this client grid only positions them.
"use client";

import dynamic from "next/dynamic";
import type { ItemRglInnerProps } from "./ItemRglInner";

const ItemLayoutGrid = dynamic<ItemRglInnerProps>(() => import("./ItemRglInner"), {
  ssr: false,
  loading: () => (
    <div className="py-16 text-center text-sm text-neutral-500">Loading layout…</div>
  ),
});

export default ItemLayoutGrid;
