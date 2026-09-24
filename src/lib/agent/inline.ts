// Inline edit (ADR-271, Feature 2): select text, give an instruction, get back
// replacement text to accept or reject as a word-level diff. One shot, no
// tools, the owner's inline-edit prompt as the system prompt. Every proposal is
// logged with its outcome, which is the accept-rate record for tuning later.
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentEditProposals } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { getItem } from "@/lib/items";
import { callTool } from "@/lib/mcp/tools";
import { readAgentPrompt } from "./prompts";
import { promptModel, resolvePromptItem } from "./context";
import { explainError, lockedOptions, noteError, noteOk, resultError, run } from "./runtime";

export type InlineInput = {
  itemId: string | null;
  itemTitle: string;
  itemType: string;
  instruction: string;
  selected: string;
  before: string;
  after: string;
  baseHash?: string | null;
  commandPromptId?: string | null;
  voice?: boolean;
};

// The model is told to return only the replacement; strip the wrappers it
// sometimes adds anyway (a code fence, or the whole thing in quotes).
export function cleanReplacement(raw: string): string {
  let t = raw.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1];
  const q = t.match(/^"([\s\S]*)"$/) ?? t.match(/^“([\s\S]*)”$/);
  if (q && !q[1].includes('"')) t = q[1];
  return t;
}

const FORMAT_RE = /<span\b|<mark\b|<ins class="slide"|\{==|\[@[^\]]*\]\(ledgr:\/\//g;
const count = (s: string) => (s.match(FORMAT_RE) ?? []).length;

// True when the proposal drops or adds color, highlight, slide, comment, or
// mention markup the instruction never asked about.
export function formattingChanged(original: string, proposed: string, instruction: string): boolean {
  if (/format|colou?r|highlight|slide|mention|link|comment|plain/i.test(instruction)) return false;
  return count(original) !== count(proposed);
}

async function styleGuide(ownerId: string): Promise<string | null> {
  if (!(await getSettings(ownerId)).aiMemoryEnabled) return null;
  const hit = await callTool(ownerId, "search_items", { query: "writing style guide", type: "memory", limit: 1 });
  if (hit.isError) return null;
  try {
    const id = (JSON.parse(hit.content[0].text) as { items?: { id: string }[] }).items?.[0]?.id;
    if (!id) return null;
    const it = await callTool(ownerId, "get_item", { id, bodyLimit: 8000 });
    return (JSON.parse(it.content[0].text) as { body?: string }).body ?? null;
  } catch {
    return null;
  }
}

export async function runInlineEdit(ownerId: string, i: InlineInput) {
  if (i.itemId && !i.itemTitle) {
    try {
      const it = await getItem(ownerId, i.itemId);
      i = { ...i, itemTitle: it.title, itemType: it.type };
    } catch {
      i = { ...i, itemId: null };
    }
  }
  const settings = await getSettings(ownerId);
  const model = (await promptModel(ownerId, i.commandPromptId)) ?? settings.agent.inlineModel;
  let system = await readAgentPrompt(ownerId, "inline");
  if (i.commandPromptId) {
    const p = await resolvePromptItem(ownerId, i.commandPromptId, i.itemId);
    if (p) system += `\n\n## Brandon's prompt: ${p.title}\n${p.text}`;
  }
  if (i.voice) {
    const guide = await styleGuide(ownerId);
    if (guide) system += `\n\n## Brandon's writing style guide\n${guide}`;
  }
  const user = [
    `Document: ${i.itemTitle || "Untitled"} (${i.itemType})`,
    `Instruction: ${i.instruction}`,
    `Text before the selection (context only):\n<before>\n${i.before.slice(-1500)}\n</before>`,
    i.selected
      ? `Selected text to rewrite:\n<selection>\n${i.selected}\n</selection>`
      : "Nothing is selected: write new text to insert at the cursor.",
    `Text after the selection (context only):\n<after>\n${i.after.slice(0, 1500)}\n</after>`,
  ].join("\n\n");

  const [row] = await getDb()
    .insert(agentEditProposals)
    .values({
      ownerId,
      itemId: i.itemId,
      baseHash: i.baseHash ?? null,
      originalText: i.selected,
      instruction: i.instruction,
      commandPromptId: i.commandPromptId ?? null,
      model,
    })
    .returning({ id: agentEditProposals.id });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);
  let text = "";
  let usage: unknown = null;
  try {
    for await (const m of run(user, lockedOptions({ model, systemPrompt: system, maxTurns: 1, abort }))) {
      if (m.type === "assistant") {
        for (const b of m.message.content) if (b.type === "text") text += b.text;
      } else if (m.type === "result") {
        usage = { ...m.usage, costUsd: m.total_cost_usd };
        if (m.is_error) throw new Error(resultError(m));
      }
    }
  } catch (err) {
    const message = explainError(err instanceof Error ? err.message : String(err));
    noteError(message);
    await getDb().update(agentEditProposals).set({ status: "error", resolvedAt: new Date() }).where(eq(agentEditProposals.id, row.id));
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
  const proposed = cleanReplacement(text);
  if (!proposed.trim()) {
    await getDb().update(agentEditProposals).set({ status: "error", resolvedAt: new Date() }).where(eq(agentEditProposals.id, row.id));
    throw new Error("Claude returned nothing. Try again or reword the instruction.");
  }
  noteOk();
  await getDb().update(agentEditProposals).set({ proposedText: proposed, usage }).where(eq(agentEditProposals.id, row.id));
  return {
    proposalId: row.id,
    text: proposed,
    formattingWarning: formattingChanged(i.selected, proposed, i.instruction),
  };
}

export async function resolveProposal(ownerId: string, id: string, status: "accepted" | "rejected" | "stale") {
  await getDb()
    .update(agentEditProposals)
    .set({ status, resolvedAt: new Date() })
    .where(and(eq(agentEditProposals.id, id), eq(agentEditProposals.ownerId, ownerId)));
}
