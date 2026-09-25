// The editor half of the module wiring (ADR-272 step 4): the module pieces the
// markdown editor shows, so the editor (fenced core, eslint.config.mjs) never
// imports a module. A client file, apart from module-panels.tsx, because the
// editor is client-only and module-panels holds async server components.
// Each export is inert while its module is off.
"use client";

// The in-app agent's inline edit (ADR-271): the flag says the root layout
// marked this page agent-on (module on AND the machine can run it), and the
// popover is what Mod-Shift-E opens.
export { useAgentOn as useInlineEditOn } from "@/modules/agent/components/useAgentOn";
export { default as InlineEditPopover } from "@/modules/agent/components/InlineEdit";
