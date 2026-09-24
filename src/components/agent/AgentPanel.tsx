// The Claude sidebar (ADR-271, Features 1 and 5). One global panel mounted by
// the root layout when the agent is on: a resizable right-side panel on desktop
// (it takes room beside the canvas through --agent-w rather than covering it),
// a full-height bottom sheet on a phone. It follows whatever item is open and
// whatever text is selected in it, and hosts up to five chat tabs plus one
// temporary side chat per chat.
//
// Keys: Ctrl/Cmd+J toggles the panel; Ctrl/Cmd+Alt+J opens a side chat
// (Ctrl+Shift+J is the browser's DevTools console, so it can't be used).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { showToast } from "@/components/ui/ActionToast";
import ChatView, { type Block } from "./ChatView";

const OPEN_KEY = "ledgr:agent-open";
const WIDTH_KEY = "ledgr:agent-width";
const TABS_KEY = "ledgr:agent-tabs";
const MAX_TABS = 5;
const UUID = /^\/items\/([0-9a-f-]{36})/i;

type SessionRow = { id: string; title: string; updatedAt: string };
type Tab = { id: string; title: string };

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Private mode or storage full: the panel still works, it just forgets.
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (r.status === 204 ? null : await r.json()) as T;
}

function useDesktop(): boolean {
  const [d, setD] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setD(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return d;
}

// The item open in the canvas (full page or the peek/sheet, which both own the
// URL), and the owner's text selection inside it. A selection is kept while
// focus moves into the panel, and dropped when it collapses in the canvas.
function useCanvasContext() {
  const pathname = usePathname();
  const itemId = UUID.exec(pathname ?? "")?.[1] ?? null;
  const [item, setItem] = useState<{ id: string; title: string; type: string } | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    if (!itemId) return;
    let off = false;
    fetch(`/api/items?ids=${itemId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: { id: string; title: string; type: string }[] }) => {
        if (!off) setItem(d.items[0] ?? null);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [itemId]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = window.getSelection();
        const node = sel?.anchorNode;
        const el = node instanceof Element ? node : node?.parentElement;
        if (!el?.closest("[data-toc-scope]")) return;
        const text = sel?.toString().trim() ?? "";
        setSelection(text || null);
      }, 250);
    };
    document.addEventListener("selectionchange", on);
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", on);
    };
  }, []);
  return { item: itemId && item?.id === itemId ? item : null, selection: itemId ? selection : null };
}

export default function AgentPanel() {
  const desktop = useDesktop();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(420);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [side, setSide] = useState<{ id: string; question?: string } | null>(null);
  const [switcher, setSwitcher] = useState<SessionRow[] | null>(null);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [detached, setDetached] = useState<Record<string, boolean>>({});
  const ctx = useCanvasContext();

  // Restore the owner's panel state on this device.
  // After mount, not in the initial state: the server render has no storage,
  // and reading it during render would mismatch hydration.
  // The save effects below wait for this, or their first run would write the
  // empty defaults over what was stored before the restore could read it.
  const restored = useRef(false);
  useEffect(() => {
    queueMicrotask(() => {
      restored.current = true;
      setOpen(store(OPEN_KEY, false));
      setWidth(store(WIDTH_KEY, 420));
      const t = store<Tab[]>(TABS_KEY, []);
      setTabs(t);
      setActive(t[0]?.id ?? null);
    });
  }, []);
  useEffect(() => {
    if (restored.current) save(OPEN_KEY, open);
  }, [open]);
  useEffect(() => {
    if (restored.current) save(TABS_KEY, tabs);
  }, [tabs]);

  // Take room beside the canvas on desktop; overlay on a phone.
  useEffect(() => {
    const s = document.body.style;
    if (open && desktop) s.setProperty("--agent-w", `${width}px`);
    else s.removeProperty("--agent-w");
    return () => {
      s.removeProperty("--agent-w");
    };
  }, [open, desktop, width]);

  const newChat = useCallback(async () => {
    const { session } = await api<{ session: { id: string; title: string } }>("/api/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ contextItemId: ctx.item?.id ?? null }),
    });
    setTabs((t) => [{ id: session.id, title: session.title }, ...t.filter((x) => x.id !== session.id)].slice(0, MAX_TABS));
    setActive(session.id);
    setSide(null);
    setOpen(true);
    return session.id;
  }, [ctx.item?.id]);

  const openSide = useCallback(
    async (question?: string) => {
      const parent = active ?? (await newChat());
      const { session } = await api<{ session: { id: string } }>("/api/agent/sessions", {
        method: "POST",
        body: JSON.stringify({ kind: "side", parentSessionId: parent }),
      });
      setSide({ id: session.id, question });
      setOpen(true);
    },
    [active, newChat]
  );

  // First open with no chats: start one.
  useEffect(() => {
    if (open && tabs.length === 0 && !active) queueMicrotask(() => void newChat());
  }, [open, tabs.length, active, newChat]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j") return;
      e.preventDefault();
      if (e.altKey) void openSide();
      else setOpen((o) => !o);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [openSide]);

  // Desktop resize from the inner edge.
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, w: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const w = Math.round(Math.min(Math.max(drag.current.w + (drag.current.x - e.clientX), 320), window.innerWidth * 0.5));
    setWidth(w);
  };
  const onUp = () => {
    if (drag.current) save(WIDTH_KEY, width);
    drag.current = null;
  };

  const activeTab = tabs.find((t) => t.id === active) ?? null;
  const setTitle = useCallback(
    (title: string) => setTabs((t) => t.map((x) => (x.id === active ? { ...x, title } : x))),
    [active]
  );

  async function openSwitcher() {
    setSwitcher((await api<{ sessions: SessionRow[] }>(`/api/agent/sessions${q ? `?q=${encodeURIComponent(q)}` : ""}`)).sessions);
  }
  useEffect(() => {
    if (switcher === null) return;
    const t = setTimeout(() => {
      void api<{ sessions: SessionRow[] }>(`/api/agent/sessions${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((d) => setSwitcher(d.sessions));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function pick(s: SessionRow) {
    setTabs((t) => (t.some((x) => x.id === s.id) ? t : [{ id: s.id, title: s.title }, ...t].slice(0, MAX_TABS)));
    setActive(s.id);
    setSwitcher(null);
    setSide(null);
  }
  function closeTab(id: string) {
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (active === id) setActive(next[0]?.id ?? null);
  }

  async function rename(title: string) {
    if (!active) return;
    await api(`/api/agent/sessions/${active}`, { method: "PATCH", body: JSON.stringify({ title }) });
    setTitle(title);
    setRenaming(false);
  }
  async function archive() {
    if (!active) return;
    await api(`/api/agent/sessions/${active}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    closeTab(active);
    setMenu(false);
    showToast("Chat archived");
  }
  async function transcript(): Promise<{ title: string; text: string } | null> {
    if (!active) return null;
    const d = await api<{ session: { title: string }; messages: { role: string; content: Block[] }[] }>(`/api/agent/sessions/${active}`);
    const text = d.messages
      .map((m) => `**${m.role === "assistant" ? "Claude" : "Brandon"}:** ${m.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim()}`)
      .join("\n\n");
    return { title: d.session.title, text };
  }
  async function copyTranscript() {
    const t = await transcript();
    if (t) await navigator.clipboard.writeText(t.text);
    setMenu(false);
    showToast("Transcript copied");
  }
  async function saveTranscript() {
    const t = await transcript();
    setMenu(false);
    if (!t) return;
    await api("/api/items", { method: "POST", body: JSON.stringify({ type: "note", title: `Chat: ${t.title}`, body: { format: "markdown", text: t.text } }) });
    showToast("Saved the chat as a note");
  }

  async function sideAction(action: "bring" | "keep" | "close") {
    if (!side) return;
    if (action === "bring") {
      showToast("Summarizing the side chat…");
      try {
        await api(`/api/agent/sessions/${side.id}/bring-back`, { method: "POST" });
        showToast("Brought back. It rides along with your next message.");
      } catch {
        showToast("Couldn't summarize the side chat");
        return;
      }
    } else if (action === "keep") {
      await api(`/api/agent/sessions/${side.id}`, { method: "PATCH", body: JSON.stringify({ keep: true }) });
      setTabs((t) => [{ id: side.id, title: "Kept side chat" }, ...t].slice(0, MAX_TABS));
    } else {
      await api(`/api/agent/sessions/${side.id}`, { method: "DELETE" });
    }
    setSide(null);
  }

  const detachedHere = active ? detached[active] : false;
  const chatContext = { itemId: detachedHere ? null : ctx.item?.id ?? null, selection: detachedHere ? null : ctx.selection };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Claude (Ctrl/Cmd+J)"
        aria-label="Open Claude"
        className="fixed bottom-24 right-4 z-[45] flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-ink shadow-lg hover:bg-surface-2 sm:bottom-16"
      >
        <Sparkle />
      </button>
    );
  }

  const chrome = (
    <>
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {renaming ? (
          <input
            autoFocus
            defaultValue={activeTab?.title}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename(e.currentTarget.value);
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 flex-1 rounded border border-line bg-surface-0 px-1.5 py-0.5 text-sm text-ink outline-none"
          />
        ) : (
          <button type="button" onClick={() => setRenaming(true)} title="Rename this chat" className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink">
            {activeTab?.title ?? "Claude"}
          </button>
        )}
        <HeaderBtn label="Your chats" onClick={() => void (switcher ? setSwitcher(null) : openSwitcher())}>☰</HeaderBtn>
        <HeaderBtn label="New chat" onClick={() => void newChat()}>＋</HeaderBtn>
        <HeaderBtn label="Side chat (Ctrl/Cmd+Alt+J): a temporary question that doesn't touch this chat" onClick={() => void openSide()}>⤳</HeaderBtn>
        <HeaderBtn label="More" onClick={() => setMenu((m) => !m)}>⋯</HeaderBtn>
        <HeaderBtn label="Close (Ctrl/Cmd+J)" onClick={() => setOpen(false)}>✕</HeaderBtn>
      </header>
      {menu && (
        <div className="absolute right-2 top-10 z-30 w-52 rounded-card border border-line-strong bg-surface-2 py-1 text-sm shadow-xl">
          <MenuBtn onClick={() => void copyTranscript()}>Copy transcript</MenuBtn>
          <MenuBtn onClick={() => void saveTranscript()}>Save chat as a note</MenuBtn>
          <MenuBtn onClick={() => void archive()}>Archive chat</MenuBtn>
          <a href="/settings#agent" className="block px-3 py-1.5 text-ink-muted hover:bg-surface-3">
            Usage and settings
          </a>
        </div>
      )}
      {desktop && tabs.length > 1 && (
        <div className="flex gap-0.5 overflow-x-auto border-b border-line px-1 pt-1 text-xs">
          {tabs.map((t) => (
            <span key={t.id} className={`flex max-w-[9rem] items-center gap-1 rounded-t px-2 py-1 ${t.id === active ? "bg-surface-3 text-ink" : "text-ink-subtle hover:bg-surface-2"}`}>
              <button type="button" onClick={() => { setActive(t.id); setSide(null); }} className="truncate">
                {t.title}
              </button>
              <button type="button" aria-label="Close tab" onClick={() => closeTab(t.id)} className="opacity-60 hover:opacity-100">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {switcher && (
        <div className="absolute inset-x-2 top-10 z-30 max-h-[60%] overflow-auto rounded-card border border-line-strong bg-surface-2 p-1.5 shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your chats"
            className="mb-1 w-full rounded border border-line bg-surface-0 px-2 py-1 text-sm text-ink outline-none"
          />
          {switcher.length === 0 && <p className="px-2 py-1 text-xs text-ink-subtle">No chats yet.</p>}
          {switcher.map((s) => (
            <button key={s.id} type="button" onClick={() => pick(s)} className="block w-full truncate rounded px-2 py-1 text-left text-sm text-ink-muted hover:bg-surface-3">
              {s.title}
              <span className="ml-2 text-xs text-ink-faint">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
      {(ctx.item || ctx.selection) && (
        <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5 text-xs">
          {ctx.item && !detachedHere && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-1 px-2 py-0.5 text-ink-muted" title="Claude sees this item">
              <span className="truncate">Viewing: {ctx.item.title || "Untitled"}</span>
              <span className="text-ink-faint">({ctx.item.type})</span>
              <button type="button" aria-label="Don't send this item in this chat" onClick={() => active && setDetached((d) => ({ ...d, [active]: true }))} className="hover:text-ink">
                ✕
              </button>
            </span>
          )}
          {detachedHere && ctx.item && (
            <button type="button" onClick={() => active && setDetached((d) => ({ ...d, [active]: false }))} className="text-ink-subtle underline decoration-dotted">
              Send the open item again
            </button>
          )}
          {ctx.selection && !detachedHere && (
            <span className="rounded-full border border-line bg-surface-1 px-2 py-0.5 text-ink-muted" title="Claude sees your highlighted text">
              Selection ({ctx.selection.split(/\s+/).filter(Boolean).length} words)
            </span>
          )}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {active && (
          <ChatView key={active} sessionId={active} context={chatContext} onNewChat={() => void newChat()} onOpenSide={(qq) => void openSide(qq)} onTitle={setTitle} />
        )}
        {side && (
          <div className="absolute inset-x-0 bottom-0 flex h-2/3 flex-col border-t-2 border-sky-700 bg-sky-950/95 shadow-2xl">
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-sky-100">
              <span className="flex-1 font-medium">Side chat (temporary)</span>
              <button type="button" onClick={() => void sideAction("bring")} title="Add a short summary of this side chat to the main chat" className="rounded px-1.5 py-0.5 hover:bg-sky-900">
                Bring back
              </button>
              <button type="button" onClick={() => void sideAction("keep")} title="Keep it as its own chat" className="rounded px-1.5 py-0.5 hover:bg-sky-900">
                Keep
              </button>
              <button type="button" onClick={() => void sideAction("close")} title="Discard it" className="rounded px-1.5 py-0.5 hover:bg-sky-900">
                Close
              </button>
            </div>
            <SideChat key={side.id} id={side.id} question={side.question} context={chatContext} />
          </div>
        )}
      </div>
    </>
  );

  if (!desktop) {
    return (
      <div role="dialog" aria-label="Claude" className="fixed inset-x-0 bottom-0 top-8 z-[66] flex flex-col rounded-t-2xl border-t border-line-strong bg-surface-2 shadow-2xl">
        <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        {chrome}
      </div>
    );
  }
  return (
    <aside
      aria-label="Claude"
      className="fixed z-[45] flex flex-col border-l border-line-strong bg-surface-2 shadow-2xl"
      style={{ top: "var(--nav-pt, 0px)", bottom: "var(--nav-pb, 0px)", right: "var(--nav-pr, 0px)", width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Claude panel"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={() => {
          setWidth(420);
          save(WIDTH_KEY, 420);
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize"
      />
      {chrome}
    </aside>
  );
}

// A side chat opened with "/btw <question>" sends that question first.
function SideChat({ id, question, context }: { id: string; question?: string; context: { itemId: string | null; selection: string | null } }) {
  return <ChatView sessionId={id} context={context} side initialQuestion={question} onNewChat={() => {}} onOpenSide={() => {}} />;
}

function HeaderBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="rounded px-1.5 py-0.5 text-sm text-ink-subtle hover:bg-surface-3 hover:text-ink">
      {children}
    </button>
  );
}
function MenuBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full px-3 py-1.5 text-left text-ink-muted hover:bg-surface-3">
      {children}
    </button>
  );
}
function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}
