// The browser-side half of the module wiring (ADR-272 steps 4 and 5): the
// module pieces the markdown editor shows and the module shell panels the root
// layout mounts, so neither the editor nor the layout (fenced core,
// eslint.config.mjs) imports a module. A client file, apart from
// module-panels.tsx, because these are client components and module-panels
// holds async server components.
//
// Every module component here loads through next/dynamic (plan step 5), so its
// code downloads only when it actually renders: an owner with the agent off
// never fetches the Claude sidebar or the inline-edit popover. `loading` is null
// throughout because each piece is invisible until used, so there is nothing to
// flash. `scripts/verify-module-registry.mts` fails if one of these goes back to
// a static import. (Only a real client file splits this way: next/dynamic in a
// server file still bundles the client code into every page that imports it.)
"use client";

import dynamic from "next/dynamic";

// The in-app agent's inline edit (ADR-271): the flag says the root layout
// marked this page agent-on (module on AND the machine can run it), and the
// popover is what Mod-Shift-E opens. The flag is a few lines, so it stays a
// static import; the popover is the weight.
export { useAgentOn as useInlineEditOn } from "@/modules/agent/components/useAgentOn";
export const InlineEditPopover = dynamic(() => import("@/modules/agent/components/InlineEdit"), {
  ssr: false,
  loading: () => null,
});

// Shell panels, listed for the root layout by shellPanels() in
// module-shells.tsx. The Desk's "Send to Desk" popover (opened by inline
// mention/link right-clicks, ADR-146 S3b) and the Claude sidebar (ADR-271).
export const DeskSendShellPanel = dynamic(() => import("@/modules/desk/components/DeskSendMenu"), {
  loading: () => null,
});
export const AgentShellPanel = dynamic(() => import("@/modules/agent/components/AgentPanel"), {
  loading: () => null,
});
