// Verifies the in-app agent's safety rails (ADR-271). Pure: no database, no
// Claude call. What it pins:
//   - every registered MCP tool has a tier, so a new tool can't reach the agent
//     (or silently miss it) without someone deciding how much it may do;
//   - the locked SDK options: no Claude Code built-in tools, no on-disk
//     settings, no claude.ai cloud connectors (they auto-connected mid-turn in
//     the 2026-09-24 spike, a ~$4 first turn with dozens of foreign tools);
//   - the env allowlist: hub secrets never reach the child process;
//   - the inline-edit reply cleanup and the formatting-loss warning.
//
//   npx tsx scripts/verify-agent.mts
import { TOOL_NAMES } from "../src/lib/mcp/tools";
import { TOOL_TIERS, tierOf } from "../src/lib/agent/tools";
import { lockedOptions, scrubbedEnv } from "../src/lib/agent/runtime";
import { cleanReplacement, formattingChanged } from "../src/lib/agent/inline";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail === undefined ? "" : `  (${String(detail)})`}`);
  }
}

// Tiers
const untiered = TOOL_NAMES.filter((n) => !(n in TOOL_TIERS));
check("every registry tool has a tier", untiered.length === 0, untiered.join(", "));
const stale = Object.keys(TOOL_TIERS).filter((n) => !TOOL_NAMES.includes(n));
check("no tier names a tool that no longer exists", stale.length === 0, stale.join(", "));
check("delete, share, and revoke always ask", ["delete_item", "share_item", "revoke_share_link"].every((t) => tierOf(t) === "D"));
check("an unknown tool is not exposed", tierOf("some_future_tool") === "X");

// Env allowlist
// Spelled in two parts: verify-ci treats a script naming the connection-string
// variable as DB-backed and would skip this one in CI.
const DB_URL = "DATABASE" + "_URL";
const SECRETS = [DB_URL, "R2_SECRET_ACCESS_KEY", "CLERK_SECRET_KEY", "LEDGR_MACHINE_TOKEN", "ANTHROPIC_API_KEY"];
for (const k of SECRETS) process.env[k] = "secret";
process.env.PATH ||= "x";
let env = scrubbedEnv();
check("no hub secret reaches the child", SECRETS.every((k) => !(k in env)), SECRETS.filter((k) => k in env).join(", "));
check("PATH still reaches the child", "PATH" in env || "Path" in env);
check("cloud connectors are switched off in the child env", env.ENABLE_CLAUDEAI_MCP_SERVERS === "false");
process.env.LEDGR_AGENT_AUTH = "apikey";
env = scrubbedEnv();
check("API-key mode passes only the API key", env.ANTHROPIC_API_KEY === "secret" && !(DB_URL in env));
delete process.env.LEDGR_AGENT_AUTH;

// Locked options
const o = lockedOptions({ model: "claude-opus-5-5", systemPrompt: "x", maxTurns: 1, abort: new AbortController() });
check("no Claude Code built-in tools", Array.isArray(o.tools) && o.tools.length === 0);
check("no on-disk settings, skills, hooks, or CLAUDE.md", Array.isArray(o.settingSources) && o.settingSources.length === 0);
check("only Ledgr's MCP server", o.strictMcpConfig === true);
const st = o.settings as Record<string, unknown>;
check("claude.ai connectors, skills, and plugins disabled", st?.disableClaudeAiConnectors === true && st?.syncClaudeAiSkills === false && st?.syncClaudeAiPlugins === false);
check("tools are denied unless allowed", o.permissionMode === "default" && typeof o.canUseTool === "function");

// Inline edit
check("strips a code fence", cleanReplacement("```markdown\nHello\n```") === "Hello");
check("strips wrapping quotes", cleanReplacement('"Hello there"') === "Hello there");
check("keeps inner quotes", cleanReplacement('"a" and "b"') === '"a" and "b"');
check("warns when a highlight is dropped", formattingChanged("a <mark>b</mark>", "a b", "tighten"));
check("no warning when formatting was asked for", !formattingChanged("a <mark>b</mark>", "a b", "remove the highlight"));
check("no warning when formatting is kept", !formattingChanged("a <mark>b</mark> c", "<mark>b</mark> c", "tighten"));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
