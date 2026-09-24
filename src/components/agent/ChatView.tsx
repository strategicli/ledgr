// One chat's transcript and live turn (ADR-271, Features 1 and 5). Used for the
// main chat and, tinted, for the side chat drawer. The server owns the turn; this
// only renders its event stream, and on load reattaches to a turn still running
// (the phone slept, the page reloaded) or just shows the stored messages.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MarkdownPreview from "@/components/markdown-editor/MarkdownPreview";
import { showToast } from "@/components/ui/ActionToast";
import AgentInput, { type Builtin, type Submit } from "./AgentInput";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; input?: unknown; result?: string; isError?: boolean };

type Msg = { id: string; role: string; content: Block[]; status: string; usage?: { inputTokens?: number; outputTokens?: number } | null };
type Approval = { id: string; tool: string; args: unknown; preview: string };
type SessionData = {
  session: { id: string; title: string; kind: string; inputTokens: number; outputTokens: number; parentSessionId: string | null };
  messages: Msg[];
  pendingApprovals: Approval[];
  sideSessionId: string | null;
  liveTurnId: string | null;
};

export type ChatContext = {
  itemId: string | null;
  selection: string | null;
};

const BUILTINS: Builtin[] = [
  { name: "new", help: "Start a new chat" },
  { name: "side", help: "Open a side chat (temporary, doesn't touch this one)" },
  { name: "btw", help: "Ask a side question: /btw your question" },
  { name: "save", help: "Save this chat as a note" },
  { name: "model", help: "Which model this chat uses (change it in Settings)" },
  { name: "clear", help: "Start over in a new chat" },
  { name: "help", help: "What Claude in Ledgr can do" },
];

const HELP = `**Claude in Ledgr** can read and change your items as you. Type **@** to attach an item as context, and **/** to run one of your prompts or a command (/new, /side, /btw, /save). It sees the item you have open and any text you've selected. Creating and editing run right away; moving to Trash or sharing always asks first.`;

function blocksText(blocks: Block[]): string {
  return blocks.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

// Read a text/event-stream body frame by frame.
async function readSse(res: Response, on: (event: string, data: unknown, id: number | null) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      let id: number | null = null;
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
        else if (line.startsWith("id: ")) id = Number(line.slice(4));
      }
      if (data) on(event, JSON.parse(data), id);
    }
  }
}

export default function ChatView({
  sessionId,
  context,
  side = false,
  onNewChat,
  onOpenSide,
  onTitle,
  initialQuestion,
}: {
  sessionId: string;
  context: ChatContext;
  side?: boolean;
  onNewChat: () => void;
  onOpenSide: (question?: string) => void;
  onTitle?: (title: string) => void;
  // A side chat opened with "/btw <question>" asks it on open.
  initialQuestion?: string;
}) {
  const [data, setData] = useState<SessionData | null>(null);
  const [live, setLive] = useState<{ turnId: string | null; blocks: Block[]; approvals: Approval[]; error: string | null } | null>(null);
  const [localNotes, setLocalNotes] = useState<string[]>([]);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Whether a stream is attached right now, so a refocus only reattaches a
  // stream that actually dropped (two would double every word).
  const streaming = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/agent/sessions/${sessionId}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as SessionData;
    setData(d);
    onTitle?.(d.session.title);
    return d;
  }, [sessionId, onTitle]);

  const onEvent = useCallback(
    (event: string, payload: unknown, id: number | null) => {
      if (id !== null) seq.current = id + 1;
      const p = payload as Record<string, unknown>;
      setLive((l) => {
        const cur = l ?? { turnId: null, blocks: [], approvals: [], error: null };
        const blocks = [...cur.blocks];
        switch (event) {
          case "turn":
            return { ...cur, turnId: String(p.turnId) };
          case "text_delta": {
            const last = blocks[blocks.length - 1];
            if (last?.type === "text") blocks[blocks.length - 1] = { ...last, text: last.text + String(p.text) };
            else blocks.push({ type: "text", text: String(p.text) });
            return { ...cur, blocks };
          }
          case "tool_start":
            blocks.push({ type: "tool", id: String(p.id), name: String(p.name), summary: String(p.summary), input: p.input });
            return { ...cur, blocks };
          case "tool_result":
            return {
              ...cur,
              blocks: blocks.map((b) => (b.type === "tool" && b.id === p.id ? { ...b, result: String(p.result ?? ""), isError: !!p.isError } : b)),
            };
          case "approval_request":
            return { ...cur, approvals: [...cur.approvals, p as unknown as Approval] };
          case "approval_resolved":
            return { ...cur, approvals: cur.approvals.filter((a) => a.id !== p.id) };
          case "error":
            return { ...cur, error: String(p.message) };
          default:
            return cur;
        }
      });
    },
    []
  );

  const follow = useCallback(
    async (res: Response) => {
      streaming.current = true;
      try {
        await readSse(res, onEvent);
      } catch {
        streaming.current = false;
        // The stream dropped (phone slept, network blip). The turn keeps running
        // on the server; the visibility handler below reattaches.
        return;
      }
      streaming.current = false;
      await load();
      setLive(null);
    },
    [load, onEvent]
  );

  const reattach = useCallback(
    async (turnId: string) => {
      const r = await fetch(`/api/agent/turn/${turnId}/stream?from=${seq.current}`);
      if (r.ok) await follow(r);
      else {
        await load();
        setLive(null);
      }
    },
    [follow, load]
  );

  // Keyed by session in the panel, so each chat mounts fresh.
  useEffect(() => {
    queueMicrotask(() => void load().then((d) => {
      if (!d) return;
      if (initialQuestion && d.messages.length === 0 && !d.liveTurnId) {
        void send({ text: initialQuestion, prompt: null, mentions: [], answers: {} });
      } else if (d.liveTurnId) {
        setLive({ turnId: d.liveTurnId, blocks: [], approvals: d.pendingApprovals, error: null });
        void reattach(d.liveTurnId);
      }
    }));
    // Mount-only per chat (the panel keys ChatView by session).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, load, reattach]);

  // Coming back to the tab: reattach if a turn was running, else refresh.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (live?.turnId && !streaming.current) void reattach(live.turnId);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [live?.turnId, reattach]);

  // Keep the newest message in view unless the owner scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  async function send(s: Submit, retry = false) {
    seq.current = 0;
    setLive({ turnId: null, blocks: [], approvals: [], error: null });
    if (!retry) {
      setData((d) =>
        d ? { ...d, messages: [...d.messages, { id: `local-${Date.now()}`, role: "user", content: [{ type: "text", text: s.text || `/${s.prompt?.title}` }], status: "complete" }] } : d
      );
    }
    stick.current = true;
    const res = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        text: s.text || (s.prompt ? `Run "${s.prompt.title}".` : ""),
        retry,
        itemId: context.itemId,
        selection: context.selection,
        mentionIds: s.mentions.map((m) => m.id),
        commandPromptId: s.prompt?.id ?? null,
        answers: s.answers,
      }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      setLive({ turnId: null, blocks: [], approvals: [], error: e.error ?? `HTTP ${res.status}` });
      return;
    }
    await follow(res);
  }

  async function stop() {
    if (live?.turnId) await fetch(`/api/agent/turn/${live.turnId}/stop`, { method: "POST" });
  }

  async function decide(a: Approval, decision: "allow_once" | "deny", note?: string) {
    await fetch(`/api/agent/approval/${a.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    setLive((l) => (l ? { ...l, approvals: l.approvals.filter((x) => x.id !== a.id) } : l));
  }

  async function saveNote(title: string, text: string) {
    const r = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "note", title, body: { format: "markdown", text } }),
    });
    const d = (await r.json().catch(() => ({}))) as { item?: { id: string } };
    if (r.ok && d.item) showToast("Saved as a note");
    else showToast("Couldn't save the note");
  }

  function transcriptText(): string {
    return (data?.messages ?? [])
      .filter((m) => m.role !== "tool")
      .map((m) => `**${m.role === "assistant" ? "Claude" : "Brandon"}:** ${blocksText(m.content)}`)
      .join("\n\n");
  }

  function builtin(name: string, rest: string) {
    if (name === "new" || name === "clear") onNewChat();
    else if (name === "side") onOpenSide();
    else if (name === "btw") onOpenSide(rest || undefined);
    else if (name === "save") void saveNote(`Chat: ${data?.session.title ?? "Claude"}`, transcriptText());
    else if (name === "model") setLocalNotes((n) => [...n, "This chat uses the model set in Settings → Claude in Ledgr. Change it there; the next message picks it up."]);
    else if (name === "help") setLocalNotes((n) => [...n, HELP]);
  }

  const busy = !!live && !live.error && (live.turnId !== null || live.blocks.length === 0);
  const msgs = data?.messages ?? [];
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {msgs.length === 0 && !live && (
          <p className="text-sm text-ink-subtle">
            {side
              ? "A side chat knows everything in the main chat but never adds to it. Bring the answer back, keep it, or close it."
              : "Ask about the item you have open, or anything in Ledgr. Type @ to attach an item, / for your prompts."}
          </p>
        )}
        {msgs.map((m) => (
          <Message
            key={m.id}
            m={m}
            canRetry={m === lastAssistant && !busy}
            onRetry={() => void send({ text: "", prompt: null, mentions: [], answers: {} }, true)}
            onSave={() => void saveNote(blocksText(m.content).split("\n")[0].slice(0, 80) || "From Claude", blocksText(m.content))}
          />
        ))}
        {live && (
          <div className="space-y-2">
            {live.blocks.map((b, i) => (b.type === "text" ? <p key={i} className="whitespace-pre-wrap text-sm text-ink">{b.text}</p> : <ToolRow key={b.id} b={b} />))}
            {busy && live.blocks.length === 0 && <p className="animate-pulse text-sm text-ink-subtle">Claude is thinking…</p>}
            {live.approvals.map((a) => (
              <ApprovalCard key={a.id} a={a} onDecide={(d, note) => void decide(a, d, note)} />
            ))}
            {live.error && <p className="rounded bg-red-950/50 px-2 py-1.5 text-sm text-red-200">{live.error}</p>}
          </div>
        )}
        {localNotes.map((n, i) => (
          <div key={i} className="rounded-card border border-line bg-surface-1 px-3 py-2 text-sm text-ink-muted">
            <MarkdownPreview text={n} />
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <AgentInput
          scope="chat"
          builtins={side ? BUILTINS.filter((b) => !["side", "btw"].includes(b.name)) : BUILTINS}
          onBuiltin={builtin}
          busy={busy}
          onStop={() => void stop()}
          onSubmit={(s) => void send(s)}
          autoFocus
        />
        {data && (
          <p className="mt-1 text-right text-xs text-ink-faint">
            {(data.session.inputTokens + data.session.outputTokens).toLocaleString()} tokens in this chat
          </p>
        )}
      </div>
    </div>
  );
}

function Message({ m, canRetry, onRetry, onSave }: { m: Msg; canRetry: boolean; onRetry: () => void; onSave: () => void }) {
  const text = blocksText(m.content);
  if (m.role === "user" || m.role === "system_note") {
    return (
      <div className={`ml-8 rounded-card px-3 py-2 text-sm ${m.role === "system_note" ? "border border-line bg-surface-1 italic text-ink-muted" : "bg-surface-3 text-ink"}`}>
        {m.role === "system_note" && <span className="mb-1 block text-xs not-italic text-ink-subtle">Brought back from a side chat</span>}
        <span className="whitespace-pre-wrap">{text}</span>
      </div>
    );
  }
  return (
    <div className="group space-y-1.5">
      {m.content.map((b, i) =>
        b.type === "text" ? (
          <div key={i} className="text-sm [&_.ledgr-prose]:text-sm">
            <MarkdownPreview text={b.text} />
          </div>
        ) : (
          <ToolRow key={b.id} b={b} />
        )
      )}
      {m.status === "interrupted" && <p className="text-xs text-ink-subtle">Stopped.</p>}
      <div className="flex gap-2 text-xs text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => showToast("Copied"))} className="hover:text-ink">
          Copy
        </button>
        {canRetry && (
          <button type="button" onClick={onRetry} className="hover:text-ink">
            Retry
          </button>
        )}
        <button type="button" onClick={onSave} className="hover:text-ink" title="Create a note from this reply">
          Save as note
        </button>
      </div>
    </div>
  );
}

function ToolRow({ b }: { b: Extract<Block, { type: "tool" }> }) {
  return (
    <details className="rounded border border-line bg-surface-1 text-xs text-ink-subtle">
      <summary className="cursor-pointer select-none px-2 py-1">
        <span className={b.isError ? "text-red-300" : ""}>{b.summary}</span>
        {b.result === undefined && <span className="ml-1 animate-pulse">…</span>}
      </summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-line px-2 py-1 font-mono text-xs">
        {JSON.stringify(b.input, null, 2)}
        {b.result !== undefined ? `\n→ ${b.result}` : ""}
      </pre>
    </details>
  );
}

function ApprovalCard({ a, onDecide }: { a: Approval; onDecide: (d: "allow_once" | "deny", note?: string) => void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div role="alert" className="space-y-2 rounded-card border border-amber-600/70 bg-amber-950/40 p-2.5 text-sm text-amber-100">
      <p>
        Claude wants to: <strong>{a.preview}</strong>
      </p>
      <details className="text-xs text-amber-200/80">
        <summary className="cursor-pointer">Exact details</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(a.args, null, 2)}</pre>
      </details>
      {note !== null && (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why not, or what to do instead"
          className="w-full rounded border border-amber-700 bg-amber-950/60 px-2 py-1 text-xs text-amber-50 outline-none"
        />
      )}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button type="button" onClick={() => onDecide("allow_once")} className="rounded bg-amber-600 px-2.5 py-1 font-medium text-amber-950 hover:bg-amber-500">
          Allow once
        </button>
        <button type="button" onClick={() => onDecide("deny", note ?? undefined)} className="rounded border border-amber-600 px-2.5 py-1 hover:bg-amber-900/60">
          {note !== null ? "Deny with this note" : "Deny"}
        </button>
        {note === null && (
          <button type="button" onClick={() => setNote("")} className="rounded px-2 py-1 underline decoration-dotted hover:bg-amber-900/60">
            Deny with note
          </button>
        )}
      </div>
    </div>
  );
}
