// Chat turns for the sidebar and side chats (ADR-271, Features 1 and 5).
//
// A turn runs server-side, detached from the request that started it: its
// events are buffered on a LiveTurn, and any number of streams (the first POST,
// or a reconnect after the phone slept) replay the buffer and follow it live.
// Everything durable lands in agent_sessions / agent_messages as it finishes,
// so a reload shows the transcript even if no stream was listening.
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentApprovals, agentMessages, agentSessions } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { captureError } from "@/lib/log";
import { resolveMentions } from "@/lib/mentions";
import { buildSystemPrompt, promptModel, type TurnContext } from "./context";
import { bareName, buildToolServer, describeCall, tierOf } from "./tools";
import { authMode, explainError, lockedOptions, noteError, noteOk, resultError, run } from "./runtime";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; input: unknown; result?: string; isError?: boolean };

export type TurnEvent = { seq: number; event: string; data: unknown };

type Decision = { decision: "allow_once" | "deny" | "timeout"; note?: string };

const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const SIDE_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAX_TURNS = { main: 25, side: 15 } as const;

export class LiveTurn {
  events: TurnEvent[] = [];
  subs = new Set<(e: TurnEvent) => void>();
  done = false;
  abort = new AbortController();
  approvals = new Map<string, (d: Decision) => void>();
  constructor(
    public id: string,
    public sessionId: string,
    public ownerId: string
  ) {}
  push(event: string, data: unknown) {
    const e = { seq: this.events.length, event, data };
    this.events.push(e);
    for (const s of this.subs) s(e);
  }
}

// Survives Next's dev hot reloads; one process on the hub (process model A).
const g = globalThis as { __ledgrAgentTurns?: Map<string, LiveTurn> };
export const turns: Map<string, LiveTurn> = (g.__ledgrAgentTurns ??= new Map());

export function liveTurnFor(sessionId: string): LiveTurn | undefined {
  for (const t of turns.values()) if (t.sessionId === sessionId && !t.done) return t;
}

// ── sessions ────────────────────────────────────────────────────────────────

export async function listSessions(ownerId: string, q?: string) {
  const db = getDb();
  return db
    .select({
      id: agentSessions.id,
      title: agentSessions.title,
      kind: agentSessions.kind,
      updatedAt: agentSessions.updatedAt,
      turnCount: agentSessions.turnCount,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.ownerId, ownerId),
        eq(agentSessions.kind, "main"),
        isNull(agentSessions.archivedAt),
        q ? sql`${agentSessions.title} ilike ${"%" + q + "%"}` : undefined
      )
    )
    .orderBy(desc(agentSessions.updatedAt))
    .limit(50);
}

export async function getSession(ownerId: string, id: string) {
  const db = getDb();
  const [s] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, id), eq(agentSessions.ownerId, ownerId)));
  if (!s) return null;
  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, id))
    .orderBy(asc(agentMessages.createdAt));
  const approvals = await db
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.sessionId, id), eq(agentApprovals.decision, "pending")));
  const side = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(and(eq(agentSessions.parentSessionId, id), eq(agentSessions.kind, "side")));
  const live = liveTurnFor(id);
  return { session: s, messages, pendingApprovals: approvals, sideSessionId: side[0]?.id ?? null, liveTurnId: live?.id ?? null };
}

export async function createSession(
  ownerId: string,
  opts: { kind?: "main" | "side"; parentSessionId?: string; contextItemId?: string | null }
) {
  const settings = await getSettings(ownerId);
  const [s] = await getDb()
    .insert(agentSessions)
    .values({
      ownerId,
      kind: opts.kind ?? "main",
      parentSessionId: opts.parentSessionId ?? null,
      contextItemId: opts.contextItemId ?? null,
      model: settings.agent.chatModel,
      authMode: authMode(),
      title: opts.kind === "side" ? "Side chat" : "New chat",
      expiresAt: opts.kind === "side" ? new Date(Date.now() + SIDE_TTL_MS) : null,
    })
    .returning();
  return s;
}

export async function updateSession(
  ownerId: string,
  id: string,
  patch: { title?: string; archived?: boolean; keep?: boolean }
) {
  const set: Partial<typeof agentSessions.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 120) || "Untitled chat";
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  if (patch.keep) {
    set.kind = "main";
    set.parentSessionId = null;
    set.expiresAt = null;
  }
  await getDb()
    .update(agentSessions)
    .set(set)
    .where(and(eq(agentSessions.id, id), eq(agentSessions.ownerId, ownerId)));
}

export async function deleteSession(ownerId: string, id: string) {
  liveTurnFor(id)?.abort.abort();
  await getDb().delete(agentSessions).where(and(eq(agentSessions.id, id), eq(agentSessions.ownerId, ownerId)));
}

// Nightly: side chats nobody kept, and 90-day-old approvals and proposals.
export async function purgeAgentData(): Promise<{ sides: number }> {
  const db = getDb();
  const sides = await db
    .delete(agentSessions)
    .where(and(eq(agentSessions.kind, "side"), lt(agentSessions.expiresAt, new Date())))
    .returning({ id: agentSessions.id });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  await db.delete(agentApprovals).where(lt(agentApprovals.createdAt, cutoff));
  await db.execute(sql`delete from agent_edit_proposals where created_at < ${cutoff}`);
  return { sides: sides.length };
}

// ── approvals ───────────────────────────────────────────────────────────────

export async function decideApproval(ownerId: string, approvalId: string, decision: "allow_once" | "deny", note?: string) {
  const db = getDb();
  const [a] = await db
    .select({ id: agentApprovals.id, sessionId: agentApprovals.sessionId, decision: agentApprovals.decision })
    .from(agentApprovals)
    .innerJoin(agentSessions, eq(agentSessions.id, agentApprovals.sessionId))
    .where(and(eq(agentApprovals.id, approvalId), eq(agentSessions.ownerId, ownerId)));
  if (!a || a.decision !== "pending") return false;
  await db
    .update(agentApprovals)
    .set({ decision, note: note ?? null, decidedAt: new Date() })
    .where(eq(agentApprovals.id, approvalId));
  const live = liveTurnFor(a.sessionId);
  live?.approvals.get(approvalId)?.({ decision, note });
  return true;
}

// ── turns ───────────────────────────────────────────────────────────────────

export type StartTurn = TurnContext & {
  sessionId: string;
  text: string;
  // Retry: re-run the last user message instead of storing a new one.
  retry?: boolean;
};

function textOf(content: unknown): string {
  return Array.isArray(content)
    ? (content as Block[]).map((b) => (b.type === "text" ? b.text : "")).join("")
    : "";
}

// Stored transcript as plain text, for a fresh SDK session whose transcript was
// lost, and for the side-chat "Bring back" summary.
function transcript(msgs: { role: string; content: unknown }[], max = 12_000): string {
  const lines = msgs
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system_note")
    .map((m) => `${m.role === "assistant" ? "Claude" : "Brandon"}: ${textOf(m.content)}`);
  let out = lines.join("\n\n");
  if (out.length > max) out = `…${out.slice(-max)}`;
  return out;
}

export async function startTurn(ownerId: string, input: StartTurn): Promise<LiveTurn> {
  const db = getDb();
  const [s] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, input.sessionId), eq(agentSessions.ownerId, ownerId)));
  if (!s) throw new Error("chat not found");
  if (liveTurnFor(s.id)) throw new Error("Claude is still answering in this chat");

  const turnId = crypto.randomUUID();
  const turn = new LiveTurn(turnId, s.id, ownerId);
  turns.set(turnId, turn);

  // The user message (a retry re-uses the last one and its context).
  let text = input.text;
  let ctx: TurnContext = input;
  if (input.retry) {
    const [last] = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.sessionId, s.id), eq(agentMessages.role, "user")))
      .orderBy(desc(agentMessages.createdAt))
      .limit(1);
    if (!last) throw new Error("nothing to retry");
    text = textOf(last.content);
    ctx = { ...input, mentionIds: (last.mentions as string[] | null) ?? [], commandPromptId: last.commandPromptId };
  } else {
    await db.insert(agentMessages).values({
      sessionId: s.id,
      turnId,
      role: "user",
      content: [{ type: "text", text }],
      mentions: input.mentionIds?.length ? input.mentionIds : null,
      commandPromptId: input.commandPromptId ?? null,
    });
    if (s.turnCount === 0 && s.kind === "main") {
      await db
        .update(agentSessions)
        .set({ title: text.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat", contextItemId: input.itemId ?? s.contextItemId })
        .where(eq(agentSessions.id, s.id));
    }
  }

  // Side-chat summaries brought back since Claude last spoke ride on this turn.
  const notes = await db
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.sessionId, s.id), eq(agentMessages.role, "system_note"), eq(agentMessages.status, "pending")));
  if (notes.length) {
    text = `${notes.map((n) => `(Note from my side chat)\n${textOf(n.content)}`).join("\n\n")}\n\n${text}`;
    await db
      .update(agentMessages)
      .set({ status: "complete" })
      .where(and(eq(agentMessages.sessionId, s.id), eq(agentMessages.role, "system_note")));
  }

  // A side chat's first turn forks from its main chat's SDK session.
  let resume = s.sdkSessionId ?? undefined;
  let forkSession = false;
  if (!resume && s.kind === "side" && s.parentSessionId) {
    const [parent] = await db
      .select({ sdk: agentSessions.sdkSessionId })
      .from(agentSessions)
      .where(eq(agentSessions.id, s.parentSessionId));
    if (parent?.sdk) {
      resume = parent.sdk;
      forkSession = true;
    }
  }

  void runTurn(turn, s, text, ctx, resume, forkSession).catch((err) =>
    captureError("agent", err, { detail: { sessionId: s.id } })
  );
  return turn;
}

async function runTurn(
  turn: LiveTurn,
  s: typeof agentSessions.$inferSelect,
  text: string,
  ctx: TurnContext,
  resume: string | undefined,
  forkSession: boolean
) {
  const db = getDb();
  const ownerId = turn.ownerId;
  const blocks: Block[] = [];
  let status: "complete" | "interrupted" | "error" = "complete";
  // Assigned inside attempt(); the cast keeps TS from narrowing it to null.
  let usage = null as Record<string, number> | null;
  let sdkSessionId: string | null = s.sdkSessionId;
  let sawOutput = false;

  const canUseTool: CanUseTool = async (toolName, args) => {
    const tool = bareName(toolName);
    if (tierOf(tool) !== "D") return { behavior: "deny", message: `${tool} is not available here` };
    // Name what the card is about: "Move an item to Trash" alone makes the
    // owner open Exact details to learn which item.
    const ids = [args.id, ...(Array.isArray(args.ids) ? args.ids : [])].filter((x): x is string => typeof x === "string");
    const names = [...(await resolveMentions(ownerId, ids)).values()].map((m) => `"${m.title || "Untitled"}"`);
    const preview = describeCall(tool, args) + (names.length ? `: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}` : "");
    const [a] = await db
      .insert(agentApprovals)
      .values({ sessionId: s.id, turnId: turn.id, tool, args, preview })
      .returning({ id: agentApprovals.id });
    turn.push("approval_request", { id: a.id, tool, args, preview });
    const d = await new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => resolve({ decision: "timeout" }), APPROVAL_TIMEOUT_MS);
      turn.approvals.set(a.id, (x) => {
        clearTimeout(timer);
        resolve(x);
      });
      turn.abort.signal.addEventListener("abort", () => resolve({ decision: "deny" }));
    });
    turn.approvals.delete(a.id);
    if (d.decision === "timeout") {
      await db.update(agentApprovals).set({ decision: "timeout", decidedAt: new Date() }).where(eq(agentApprovals.id, a.id));
    }
    turn.push("approval_resolved", { id: a.id, decision: d.decision });
    if (d.decision === "allow_once") return { behavior: "allow", updatedInput: args };
    return { behavior: "deny", message: d.note ? `Brandon declined: ${d.note}` : "Brandon declined this." };
  };

  const attempt = async (prompt: string, resumeId: string | undefined, fork: boolean) => {
    const settings = await getSettings(ownerId);
    const tools = await buildToolServer(ownerId);
    const systemPrompt = await buildSystemPrompt(ownerId, ctx);
    const options = lockedOptions({
      model: (await promptModel(ownerId, ctx.commandPromptId)) ?? settings.agent.chatModel,
      systemPrompt,
      maxTurns: s.kind === "side" ? MAX_TURNS.side : MAX_TURNS.main,
      abort: turn.abort,
      mcpServers: { ledgr: tools.config },
      allowedTools: tools.allowed,
      canUseTool,
      resume: resumeId,
      forkSession: fork,
    });
    let textBlock: { type: "text"; text: string } | null = null;
    for await (const m of run(prompt, options)) {
      if (m.type === "system" && m.subtype === "init") {
        sdkSessionId = m.session_id;
      } else if (m.type === "stream_event") {
        const ev = m.event as { type: string; delta?: { type: string; text?: string } };
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          sawOutput = true;
          turn.push("text_delta", { text: ev.delta.text });
        }
      } else if (m.type === "assistant") {
        for (const b of m.message.content) {
          if (b.type === "text") {
            if (!textBlock) blocks.push((textBlock = { type: "text", text: "" }));
            textBlock.text += b.text;
          } else if (b.type === "tool_use") {
            textBlock = null;
            sawOutput = true;
            const name = bareName(b.name);
            const block: Block = { type: "tool", id: b.id, name, summary: describeCall(name, b.input as Record<string, unknown>), input: b.input };
            blocks.push(block);
            turn.push("tool_start", { id: b.id, name, summary: block.summary, input: b.input });
          }
        }
      } else if (m.type === "user") {
        const content = (m.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const c of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
            if (c.type !== "tool_result") continue;
            const raw = Array.isArray(c.content)
              ? (c.content as { type: string; text?: string }[]).map((x) => x.text ?? "").join("")
              : String(c.content ?? "");
            const result = raw.slice(0, 600);
            const block = blocks.find((b) => b.type === "tool" && b.id === c.tool_use_id) as Extract<Block, { type: "tool" }> | undefined;
            if (block) {
              block.result = result;
              block.isError = !!c.is_error;
            }
            turn.push("tool_result", { id: c.tool_use_id, isError: !!c.is_error, result });
          }
        }
      } else if (m.type === "result") {
        usage = {
          inputTokens: m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0),
          // The part of inputTokens re-read from the prompt cache, which costs
          // about a tenth of a fresh token. Kept apart so the counter is honest.
          cachedTokens: m.usage.cache_read_input_tokens ?? 0,
          outputTokens: m.usage.output_tokens,
          costUsd: m.total_cost_usd,
        };
        turn.push("usage", usage);
        if (m.is_error) throw new Error(resultError(m));
      }
    }
  };

  try {
    try {
      await attempt(text, resume, forkSession);
    } catch (err) {
      // The SDK transcript behind `resume` is gone (a profile reset, a new
      // machine): start fresh with a summary of the stored messages instead.
      const msg = err instanceof Error ? err.message : String(err);
      if (!resume || sawOutput || turn.abort.signal.aborted || !/session|conversation|transcript|not found/i.test(msg)) throw err;
      const prior = await db.select().from(agentMessages).where(eq(agentMessages.sessionId, s.id)).orderBy(asc(agentMessages.createdAt));
      await attempt(`Earlier in this chat (the saved transcript):\n\n${transcript(prior.slice(0, -1))}\n\n---\n\n${text}`, undefined, false);
    }
    noteOk();
  } catch (err) {
    if (turn.abort.signal.aborted) status = "interrupted";
    else {
      status = "error";
      const message = explainError(err instanceof Error ? err.message : String(err));
      noteError(message);
      blocks.push({ type: "text", text: `⚠ ${message}` });
      turn.push("error", { message });
    }
  }

  await db.insert(agentMessages).values({
    sessionId: s.id,
    turnId: turn.id,
    role: "assistant",
    content: blocks,
    status,
    usage,
  });
  await db
    .update(agentSessions)
    .set({
      sdkSessionId,
      updatedAt: new Date(),
      turnCount: sql`${agentSessions.turnCount} + 1`,
      inputTokens: sql`${agentSessions.inputTokens} + ${usage?.inputTokens ?? 0}`,
      outputTokens: sql`${agentSessions.outputTokens} + ${usage?.outputTokens ?? 0}`,
      reportedCostUsd: sql`${agentSessions.reportedCostUsd} + ${usage?.costUsd ?? 0}`,
      expiresAt: s.kind === "side" ? new Date(Date.now() + SIDE_TTL_MS) : null,
    })
    .where(eq(agentSessions.id, s.id));

  turn.done = true;
  turn.push(status === "interrupted" ? "interrupted" : "done", { status });
  setTimeout(() => turns.delete(turn.id), 5 * 60_000);
}

// Side chat "Bring back": a 2-5 bullet summary of the side chat, parked on the
// main chat as a note from Brandon that rides along with his next message.
export async function bringBack(ownerId: string, sideId: string): Promise<string> {
  const db = getDb();
  const data = await getSession(ownerId, sideId);
  if (!data || data.session.kind !== "side" || !data.session.parentSessionId) throw new Error("not a side chat");
  const settings = await getSettings(ownerId);
  const abort = new AbortController();
  let summary = "";
  for await (const m of run(
    `Summarize this side conversation in 2 to 5 short bullets, written as Brandon's own notes (first person), keeping only conclusions and facts worth carrying back into the main conversation. Reply with only the bullets.\n\n${transcript(data.messages)}`,
    lockedOptions({ model: settings.agent.chatModel, systemPrompt: "You summarize conversations tersely.", maxTurns: 1, abort })
  )) {
    if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") summary += b.text;
    if (m.type === "result" && m.is_error) throw new Error(explainError(resultError(m)));
  }
  summary = summary.trim();
  await db.insert(agentMessages).values({
    sessionId: data.session.parentSessionId,
    turnId: crypto.randomUUID(),
    role: "system_note",
    content: [{ type: "text", text: summary }],
    status: "pending",
  });
  await deleteSession(ownerId, sideId);
  return summary;
}

// Usage for Settings → Agent: turns and tokens per day for the last 7 days.
export async function usageByDay(ownerId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${agentMessages.createdAt}, 'YYYY-MM-DD')`,
      turns: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(((${agentMessages.usage}->>'inputTokens')::bigint + (${agentMessages.usage}->>'outputTokens')::bigint - coalesce((${agentMessages.usage}->>'cachedTokens')::bigint, 0))), 0)::bigint`,
    })
    .from(agentMessages)
    .innerJoin(agentSessions, eq(agentSessions.id, agentMessages.sessionId))
    .where(and(eq(agentSessions.ownerId, ownerId), eq(agentMessages.role, "assistant"), gt(agentMessages.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, turns: Number(r.turns), tokens: Number(r.tokens) }));
}

