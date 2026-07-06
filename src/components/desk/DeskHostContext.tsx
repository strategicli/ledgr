// The Desk "host" seam (ADR-147 D1). A list/view/dashboard page wraps its
// interactive row region in <DeskHostProvider host={…}> so the shared row menu's
// "Open beside" knows which surface to anchor as the left column ("Open beside
// THIS view"), instead of guessing from the Desk's last-focused item (an
// invisible, unrememberable anchor). Rows live far below the page in
// ViewRenderer's layouts, so a context beats prop-drilling a host through every
// layout + row wrapper. The provider is a thin client boundary that a server
// page can render with a plain serializable `host` prop; any nested client
// consumer (RowMenu → DeskSendItems) reads it via useDeskHost.
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DeskHost } from "@/lib/desk/send";

const DeskHostContext = createContext<DeskHost | null>(null);

export function DeskHostProvider({
  host,
  children,
}: {
  host: DeskHost | null;
  children: ReactNode;
}) {
  return <DeskHostContext.Provider value={host}>{children}</DeskHostContext.Provider>;
}

// The host surface the current rows belong to, or null (no provider / no
// reusable anchor). DeskSendItems uses it for "Open beside".
export function useDeskHost(): DeskHost | null {
  return useContext(DeskHostContext);
}
