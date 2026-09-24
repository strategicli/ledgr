// The one message box for the in-app agent (ADR-271): the chat sidebar, the
// side chat, and the inline-edit popover all use it. "/" at the start picks a
// built-in command or one of Brandon's prompt items; "@" anywhere attaches an
// item as context. Picked things become chips above the box, so the text stays
// plain and removing a chip removes it from the message.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PromptOption = { id: string; title: string; slug: string | null; scope: string; description: string };
export type Mention = { id: string; title: string; type: string };
export type Builtin = { name: string; help: string };
export type Submit = {
  text: string;
  prompt: PromptOption | null;
  mentions: Mention[];
  answers: Record<string, string>;
};

let promptCache: Promise<PromptOption[]> | null = null;
export function loadPrompts(refresh = false): Promise<PromptOption[]> {
  if (!promptCache || refresh) {
    promptCache = fetch("/api/agent/prompts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { prompts: [] }))
      .then((d: { prompts: PromptOption[] }) => d.prompts)
      .catch(() => []);
  }
  return promptCache;
}

function fuzzy(q: string, s: string): boolean {
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

type Pick =
  | { kind: "slash"; q: string }
  | { kind: "mention"; q: string; start: number }
  | null;

export default function AgentInput({
  onSubmit,
  onBuiltin,
  builtins = [],
  scope,
  mentions: allowMentions = true,
  busy = false,
  onStop,
  placeholder = "Ask Claude…",
  autoFocus = false,
  initialText = "",
}: {
  onSubmit: (s: Submit) => void;
  onBuiltin?: (name: string, rest: string) => void;
  builtins?: Builtin[];
  scope: "chat" | "inline";
  mentions?: boolean;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [prompt, setPrompt] = useState<PromptOption | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [pick, setPick] = useState<Pick>(null);
  const [hits, setHits] = useState<Mention[]>([]);
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<{ labels: string[]; values: Record<string, string> } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadPrompts().then(setPrompts);
  }, []);
  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);
  // Grow with the text, up to a cap.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // @ search: the same endpoint and ranking the body editor's picker uses.
  const mentionQ = pick?.kind === "mention" ? pick.q : null;
  useEffect(() => {
    if (mentionQ === null) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/items?limit=8&q=${encodeURIComponent(mentionQ)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: Mention[] }) => {
          setHits((d.items ?? []).map((i) => ({ id: i.id, title: i.title, type: i.type })));
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [mentionQ]);

  const slashOptions = useMemo(() => {
    if (pick?.kind !== "slash") return [];
    const q = pick.q;
    const b = builtins
      .filter((x) => fuzzy(q, x.name))
      .map((x) => ({ key: `b:${x.name}`, label: `/${x.name}`, help: x.help, builtin: x.name as string | null, prompt: null as PromptOption | null }));
    const p = prompts
      .filter((x) => x.scope === "both" || x.scope === scope)
      .filter((x) => fuzzy(q, x.title) || (x.slug ? fuzzy(q, x.slug) : false))
      .slice(0, 12)
      .map((x) => ({ key: x.id, label: x.title, help: x.slug ? `/${x.slug} · ${x.description}` : x.description, builtin: null, prompt: x }));
    return [...b, ...p];
  }, [pick, builtins, prompts, scope]);

  const options =
    pick?.kind === "slash"
      ? slashOptions
      : pick?.kind === "mention"
        ? hits.map((h) => ({ key: h.id, label: h.title || "Untitled", help: h.type, builtin: null, prompt: null, mention: h }))
        : [];

  function onChange(v: string, caret: number) {
    setText(v);
    const upto = v.slice(0, caret);
    const slash = /^\/(\S*)$/.exec(upto);
    const at = allowMentions ? /(^|\s)@([^\s@]{0,40})$/.exec(upto) : null;
    if (slash) setPick({ kind: "slash", q: slash[1] });
    else if (at) setPick({ kind: "mention", q: at[2], start: caret - at[2].length - 1 });
    else setPick(null);
  }

  async function choose(i: number) {
    const o = options[i] as (typeof options)[number] & { mention?: Mention };
    if (!o) return;
    if (pick?.kind === "slash") {
      if (o.builtin) {
        setText("");
        setPick(null);
        onBuiltin?.(o.builtin, "");
        return;
      }
      setPrompt(o.prompt);
      setText("");
      setPick(null);
      if (o.prompt) {
        const r = await fetch(`/api/agent/prompts?id=${o.prompt.id}`).catch(() => null);
        const labels = r?.ok ? ((await r.json()) as { askLabels: string[] }).askLabels : [];
        if (labels.length) setAsk({ labels, values: {} });
      }
    } else if (pick?.kind === "mention" && o.mention) {
      const m = o.mention;
      setMentions((xs) => (xs.some((x) => x.id === m.id) || xs.length >= 10 ? xs : [...xs, m]));
      setText((t) => t.slice(0, pick.start) + t.slice(pick.start + pick.q.length + 1));
      setPick(null);
    }
    ta.current?.focus();
  }

  function send() {
    if (busy) return;
    const t = text.trim();
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(t);
    if (cmd && builtins.some((b) => b.name === cmd[1])) {
      onBuiltin?.(cmd[1], cmd[2]);
      setText("");
      return;
    }
    if (!t && !prompt) return;
    if (ask && ask.labels.some((l) => !ask.values[l]?.trim())) return;
    if (prompt) void fetch("/api/agent/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: prompt.id }) });
    onSubmit({ text: t, prompt, mentions, answers: ask?.values ?? {} });
    setText("");
    setPrompt(null);
    setMentions([]);
    setAsk(null);
  }

  return (
    <div className="relative">
      {options.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full overflow-auto rounded-card border border-line-strong bg-surface-2 py-1 text-sm shadow-xl"
        >
          {options.map((o, i) => (
            <li key={o.key}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void choose(i);
                }}
                className={`block w-full px-3 py-1.5 text-left ${i === active ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-3"}`}
              >
                <span className="block truncate">{o.label}</span>
                {o.help && <span className="block truncate text-xs text-ink-subtle">{o.help}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(prompt || mentions.length > 0) && (
        <div className="mb-1 flex flex-wrap gap-1">
          {prompt && (
            <Chip onRemove={() => { setPrompt(null); setAsk(null); }} title="This prompt's instructions apply to this message only">
              / {prompt.title}
            </Chip>
          )}
          {mentions.map((m) => (
            <Chip key={m.id} onRemove={() => setMentions((xs) => xs.filter((x) => x.id !== m.id))} title={`${m.type}, sent to Claude as context`}>
              @ {m.title || "Untitled"}
            </Chip>
          ))}
        </div>
      )}
      {ask && (
        <div className="mb-1 space-y-1 rounded-card border border-line bg-surface-1 p-2">
          <p className="text-xs text-ink-subtle">This prompt needs:</p>
          {ask.labels.map((l) => (
            <label key={l} className="flex items-center gap-2 text-xs text-ink-muted">
              <span className="w-24 shrink-0 truncate">{l}</span>
              <input
                value={ask.values[l] ?? ""}
                onChange={(e) => setAsk({ ...ask, values: { ...ask.values, [l]: e.target.value } })}
                className="min-w-0 flex-1 rounded border border-line bg-surface-0 px-2 py-1 text-ink outline-none"
              />
            </label>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-card border border-line-strong bg-surface-0 p-1.5 focus-within:border-[color:var(--accent)]">
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={prompt ? `Add to "${prompt.title}" (optional)…` : placeholder}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); void choose(active); return; }
              if (e.key === "Escape") { e.preventDefault(); setPick(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-[200px] min-h-[1.75rem] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        {busy && onStop ? (
          <button type="button" onClick={onStop} className="rounded-md border border-line-strong px-2.5 py-1 text-xs text-ink hover:bg-surface-2" aria-label="Stop Claude">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy || (!text.trim() && !prompt)}
            className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
            aria-label="Send"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ children, onRemove, title }: { children: React.ReactNode; onRemove: () => void; title: string }) {
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
      <span className="truncate">{children}</span>
      <button type="button" onClick={onRemove} aria-label="Remove" className="text-ink-subtle hover:text-ink">
        ✕
      </button>
    </span>
  );
}
