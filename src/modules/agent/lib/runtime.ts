// The only place that calls the Claude Agent SDK (ADR-271). Every call goes
// through lockedOptions(): no Claude Code built-in tools but ToolSearch, no user or project
// settings (so the hub's CLI skills, hooks, and CLAUDE.md never load), an empty
// sandbox folder as cwd, Ledgr's own tools in-process, and a scrubbed
// environment so DATABASE_URL, R2 keys, and Ledgr tokens never reach the child.
//
// Auth: the child runs Claude Code as this machine's user, signed in with that
// user's own Claude login. Ledgr never reads, copies, or forwards those
// credentials. LEDGR_AGENT_AUTH=apikey switches to ANTHROPIC_API_KEY billing if
// Anthropic's subscription rules change; nothing else moves.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { query, type CanUseTool, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const ENV_ALLOW = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "USER",
  "USERNAME",
  "LANG",
  "CLAUDE_CONFIG_DIR",
];

export function authMode(): "subscription" | "apikey" {
  return process.env.LEDGR_AGENT_AUTH === "apikey" ? "apikey" : "subscription";
}

export function scrubbedEnv(): Record<string, string> {
  // The claude.ai login would otherwise auto-connect the account's cloud
  // connectors (Outlook, Notion, ...) mid-turn: tools the agent must not have.
  // Blocked here, in settings, and by strictMcpConfig.
  //
  // ENABLE_TOOL_SEARCH keeps all but the core tools in reserve (tools.ts), and
  // the one-hour cache keeps a chat cheap when the owner comes back after a
  // pause (the default five minutes rarely survives a real conversation).
  const env: Record<string, string> = {
    CLAUDE_AGENT_SDK_CLIENT_APP: "ledgr-agent/1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    ENABLE_TOOL_SEARCH: "true",
    ENABLE_PROMPT_CACHING_1H: "1",
  };
  for (const k of ENV_ALLOW) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  if (authMode() === "apikey" && process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  return env;
}

let sandbox: string | null = null;
function sandboxDir(): string {
  if (sandbox) return sandbox;
  const base = process.env.LEDGR_SUPERVISOR_DIR || tmpdir();
  sandbox = join(base, "agent-sandbox");
  mkdirSync(sandbox, { recursive: true });
  return sandbox;
}

export type LockedInput = {
  model: string;
  systemPrompt: string;
  maxTurns: number;
  abort: AbortController;
  mcpServers?: Options["mcpServers"];
  allowedTools?: string[];
  canUseTool?: CanUseTool;
  resume?: string;
  forkSession?: boolean;
};

export function lockedOptions(i: LockedInput): Options {
  return {
    cwd: sandboxDir(),
    env: scrubbedEnv(),
    settingSources: [],
    settings: { disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false },
    strictMcpConfig: true,
    // The one built-in: ToolSearch, which only looks up Ledgr's reserve tools.
    tools: ["ToolSearch"],
    systemPrompt: i.systemPrompt,
    mcpServers: i.mcpServers ?? {},
    allowedTools: i.allowedTools ? [...i.allowedTools, "ToolSearch"] : [],
    canUseTool: i.canUseTool ?? (async () => ({ behavior: "deny", message: "not allowed here" })),
    permissionMode: "default",
    model: i.model,
    maxTurns: i.maxTurns,
    includePartialMessages: true,
    abortController: i.abort,
    resume: i.resume,
    forkSession: i.forkSession,
  };
}

// Health for Settings → Agent: in-process only (it resets on a restart, which
// is itself worth knowing).
export const health = {
  lastOkAt: null as string | null,
  lastError: null as { at: string; message: string } | null,
  version: null as string | null,
};

export function noteOk() {
  health.lastOkAt = new Date().toISOString();
}
export function noteError(message: string) {
  health.lastError = { at: new Date().toISOString(), message };
}

export function run(prompt: string, options: Options): AsyncIterable<SDKMessage> {
  return query({ prompt, options });
}

// The error text on a failed result message.
export function resultError(m: Extract<SDKMessage, { type: "result" }>): string {
  if (m.subtype === "success") return m.result || "Claude returned an error";
  return ("errors" in m && Array.isArray(m.errors) && m.errors.join("; ")) || m.subtype;
}

// A plain-language reading of the runtime's own error text.
export function explainError(message: string): string {
  if (/not logged in|\/login|invalid.*(oauth|token)|authentication/i.test(message)) {
    return "Claude isn't signed in on this computer. On BC-EDGEWOOD, run the Claude Code login once (Settings → Claude in Ledgr shows how).";
  }
  if (/usage limit|rate limit|quota|limit reached/i.test(message)) {
    return `Claude usage limit reached: ${message}`;
  }
  return message;
}
