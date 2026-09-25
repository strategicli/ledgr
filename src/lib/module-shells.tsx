// The shell-panel list for the root layout (ADR-272 steps 4 and 5): a module's
// app-wide surface (the Desk's Send-to-Desk popover, the Claude sidebar),
// mounted once by the fenced root layout without importing the module. The
// layout renders each entry only while its module is on for the owner (and, for
// a module with `available`, only on a machine that can run it).
//
// The components come from module-editor.tsx, where next/dynamic loads them, so
// a panel whose module is off never downloads. This file is kept apart from
// module-panels.tsx on purpose: the root layout imports it on every page, and
// anything it imports statically lands in every page's bundle.
import type { ComponentType } from "react";
import { AgentShellPanel, DeskSendShellPanel } from "@/lib/module-editor";

type ShellPanel = { moduleId: string; Component: ComponentType };

export function shellPanels(): ShellPanel[] {
  return [
    { moduleId: "desk", Component: DeskSendShellPanel },
    { moduleId: "agent", Component: AgentShellPanel },
  ];
}
