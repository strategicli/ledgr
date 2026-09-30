// Claude Runs (ADR-284). Scheduled Claude tasks file their report as a
// `claude_run` item and tick "Notify me" when the owner should hear about it;
// this module sends one phone ping for that and trashes runs after 60 days.
// Pure: the save hooks live in ./server.ts, the cleanup job is
// `claude-run-cleanup` in supervisor/jobs.json.
import { DEFAULT_CANVAS, type ModuleManifest } from "@/lib/modules";
import { MARKDOWN_FORMAT } from "@/lib/body";

// Appended to the MCP instructions while the module is on, so every Claude
// client knows the contract without being told in each task's prompt.
const RUN_INSTRUCTIONS = [
  "",
  "CLAUDE RUNS is on. When a scheduled or unattended task finishes and has",
  "something worth keeping, file ONE item of type \"claude_run\" at the END of",
  "the run (never at the start): a clear title, and the full report as the body",
  "with a one-line summary as its first line. Set properties.notifyMe = true",
  "(on create_item, or update_item propertyPatch if the run already exists)",
  "ONLY when the owner genuinely needs to know or act; that sends one phone",
  "notification showing the title and the summary line. Most runs should not",
  "notify. Runs move to Trash automatically after 60 days.",
].join("\n");

export const claudeRunsModule: ModuleManifest = {
  id: "claude-runs",
  label: "Claude Runs",
  description:
    "Scheduled Claude tasks file their results as Claude Run records, ping your phone only when they tick Notify me, and clear out after 60 days.",
  enabledByDefault: false,
  types: [
    { key: "claude_run", label: "Claude Run", icon: "robot", canonicalFormat: MARKDOWN_FORMAT, canvasId: DEFAULT_CANVAS },
  ],
  exporters: [],
  mcpTools: { names: [], instructions: RUN_INSTRUCTIONS },
  routes: ["src/app/api/machine/claude-run-cleanup/route.ts"],
};
