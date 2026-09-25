// Per-turn context for the agent (ADR-271): what Brandon is looking at, what
// he's pointing to, and his standing rules, assembled into the system prompt so
// "summarize this" works without pasting anything. Budgets are in characters
// (about 4 per token); anything over budget goes in as title + id with a note
// to fetch the rest, so a huge note can never crowd out the conversation.
import { callTool } from "@/lib/mcp/tools";
import { AGENT_MODELS, getSettings } from "@/lib/settings";
import { moduleOn } from "@/lib/modules/enabled";
import { getAppTimezone } from "@/lib/today";
import { buildItemTokenContext } from "@/lib/item-tokens-service";
import { resolveItemTokens } from "@/lib/item-tokens";
import { resolveVars } from "@/lib/template-vars";
import { getItem } from "@/lib/items";
import { bodyMarkdown } from "@/lib/body";
import { readAgentPrompt } from "./prompts";

export const BUDGET = {
  stumps: 6_000,
  item: 8_000,
  selection: 8_000,
  mentionEach: 16_000,
  mentions: 32_000,
};

export type TurnContext = {
  itemId?: string | null;
  selection?: string | null;
  mentionIds?: string[];
  commandPromptId?: string | null;
  answers?: Record<string, string>;
};

type ItemRead = {
  id: string;
  type: string;
  title: string;
  status?: string;
  dueDate?: string | null;
  scheduledDate?: string | null;
  meetingAt?: string | null;
  body?: string;
  related?: { id: string; type: string; title: string; roles?: string[] }[];
};

async function readItem(ownerId: string, id: string, bodyChars: number, relations: number): Promise<ItemRead | null> {
  const r = await callTool(ownerId, "get_item", { id, bodyLimit: Math.max(1, bodyChars) });
  if (r.isError) return null;
  try {
    const it = JSON.parse(r.content[0].text) as ItemRead;
    it.related = (it.related ?? []).slice(0, relations);
    return it;
  } catch {
    return null;
  }
}

function renderItem(it: ItemRead, bodyChars: number): string {
  const lines = [`- id: ${it.id}`, `- type: ${it.type}`, `- title: ${it.title}`];
  if (it.status) lines.push(`- status: ${it.status}`);
  for (const k of ["dueDate", "scheduledDate", "meetingAt"] as const) if (it[k]) lines.push(`- ${k}: ${it[k]}`);
  if (it.related?.length) {
    lines.push("- related:");
    for (const r of it.related) lines.push(`  - ${r.type}: ${r.title} (${r.id})`);
  }
  const body = it.body ?? "";
  if (body.length > bodyChars) {
    lines.push(`- body (first ${bodyChars} characters; call get_item for the rest):`, body.slice(0, bodyChars));
  } else if (body) lines.push("- body:", body);
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…trimmed; ${text.length - max} more characters]` : text;
}

// Today in the owner's timezone, e.g. "Thursday, September 24, 2026 (America/Chicago)".
export async function todayLine(ownerId: string, now = new Date()): Promise<{ line: string; ymd: string; tz: string }> {
  const tz = await getAppTimezone(ownerId);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(now);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  return {
    line: `${fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${fmt({ hour: "numeric", minute: "2-digit" })} (${tz})`,
    ymd,
    tz,
  };
}

// A prompt item's own Model property, when it names a model the agent offers.
// Overrides the Settings model for the turn that runs that prompt.
export async function promptModel(ownerId: string, promptId: string | null | undefined): Promise<string | null> {
  if (!promptId) return null;
  try {
    const m = ((await getItem(ownerId, promptId)).properties as Record<string, unknown> | null)?.model;
    return typeof m === "string" && (AGENT_MODELS as readonly string[]).includes(m) ? m : null;
  } catch {
    return null;
  }
}

// A prompt item's instructions, with its tokens filled against the open item.
export async function resolvePromptItem(
  ownerId: string,
  promptId: string,
  itemId: string | null | undefined,
  answers: Record<string, string> = {}
): Promise<{ title: string; text: string } | null> {
  let p;
  try {
    p = await getItem(ownerId, promptId);
  } catch {
    return null;
  }
  let text = bodyMarkdown(p.body);
  if (itemId) {
    const ctx = await buildItemTokenContext(ownerId, itemId);
    if (ctx) text = resolveItemTokens(text, ctx);
  }
  const { ymd, tz } = await todayLine(ownerId);
  text = resolveVars(text, { todayYmd: ymd, now: new Date(), timeZone: tz, answers });
  return { title: p.title, text };
}

// The full system prompt for one chat turn.
export async function buildSystemPrompt(ownerId: string, c: TurnContext): Promise<string> {
  const parts: string[] = [await readAgentPrompt(ownerId, "base")];
  const { line } = await todayLine(ownerId);
  parts.push(`## Now\n${line}`);

  const settings = await getSettings(ownerId);
  if (moduleOn(settings, "ai-memory")) {
    const r = await callTool(ownerId, "get_memory_stumps", {});
    if (!r.isError) parts.push(`## Brandon's pinned memories (standing rules)\n${clip(r.content[0].text, BUDGET.stumps)}`);
  }

  if (c.itemId) {
    const it = await readItem(ownerId, c.itemId, BUDGET.item, 30);
    if (it) parts.push(`## The item Brandon has open\n${renderItem(it, BUDGET.item)}`);
  }
  if (c.selection?.trim()) {
    parts.push(`## Brandon's current selection in that item\n${clip(c.selection, BUDGET.selection)}`);
  }

  const ids = (c.mentionIds ?? []).slice(0, 10);
  if (ids.length) {
    let left = BUDGET.mentions;
    const out: string[] = [];
    for (const id of ids) {
      const room = Math.min(BUDGET.mentionEach, left);
      const it = await readItem(ownerId, id, Math.max(room, 1), 20);
      if (!it) continue;
      if (room < 500) out.push(`- ${it.type}: ${it.title} (${it.id}), call get_item for the contents`);
      else {
        const block = renderItem(it, room);
        left -= block.length;
        out.push(block);
      }
    }
    if (out.length) parts.push(`## Items Brandon attached to this message\n${out.join("\n\n")}`);
  }

  if (c.commandPromptId) {
    const p = await resolvePromptItem(ownerId, c.commandPromptId, c.itemId, c.answers);
    if (p) parts.push(`## Task instructions from Brandon's prompt: ${p.title}\nFollow these for this turn.\n\n${p.text}`);
  }
  return parts.join("\n\n");
}
