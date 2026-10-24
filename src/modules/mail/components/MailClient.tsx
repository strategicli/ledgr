"use client";

// The Mail screen (phase 2, read only): folders, message list and reading pane,
// all fed live by /api/mail/read. Nothing here marks, moves or sends.
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { badgeCount, formatBytes } from "@/lib/format-count";
import type { AccountId, FullMessage, MailAddress, MailFolder, MessageSummary } from "@/modules/mail/lib/types";

const SafeMailBody = dynamic(() => import("@/modules/mail/components/SafeMailBody"), { ssr: false });

type AccountView = AccountId | "all";
type ListErrors = { account: AccountId; error: string }[];
type ListData = { messages: MessageSummary[]; nextPageToken: string | null; errors?: ListErrors };

const ACCOUNT_NAME: Record<AccountId, string> = { microsoft: "Outlook", gmail: "Gmail" };
const ACCOUNT_DOT: Record<AccountId, string> = { microsoft: "bg-sky-500", gmail: "bg-rose-500" };
const ROLES = ["inbox", "drafts", "sent", "archive", "spam", "trash"] as const;
const ROLE_LABEL: Record<string, string> = {
  inbox: "Inbox",
  drafts: "Drafts",
  sent: "Sent",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

async function getJson<T>(params: Record<string, string | undefined>, signal: AbortSignal): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const res = await fetch(`/api/mail/read?${sp}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
  return body as T;
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US");
}

function fullTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "";
}

const who = (a: MailAddress | null) => (a ? a.name || a.email : "Unknown sender");
const addr = (a: MailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

// Screen width: 3 = three panes, 2 = folders behind a button, 1 = one pane at a time.
function useLayoutTier(): 1 | 2 | 3 {
  return useSyncExternalStore(
    (cb) => {
      const qs = [window.matchMedia("(min-width: 1024px)"), window.matchMedia("(min-width: 768px)")];
      qs.forEach((q) => q.addEventListener("change", cb));
      return () => qs.forEach((q) => q.removeEventListener("change", cb));
    },
    () => (window.matchMedia("(min-width: 1024px)").matches ? 3 : window.matchMedia("(min-width: 768px)").matches ? 2 : 1),
    () => 3
  );
}

export default function MailClient() {
  return (
    <Suspense fallback={<div className="p-6 ui-meta text-ink-muted">Loading mail…</div>}>
      <MailScreen />
    </Suspense>
  );
}

function MailScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tier = useLayoutTier();

  const [accounts, setAccounts] = useState<AccountId[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getJson<{ accounts: AccountId[] }>({ view: "accounts" }, ac.signal)
      .then((d) => setAccounts(d.accounts))
      .catch((e) => {
        if (!ac.signal.aborted) setAccountsError(msg(e));
      });
    return () => ac.abort();
  }, []);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname]
  );

  const options: AccountView[] = useMemo(
    () => (accounts ? (accounts.length === 2 ? ["all", ...accounts] : accounts) : []),
    [accounts]
  );
  const rawAccount = sp.get("account");
  const account: AccountView | null = options.length
    ? options.includes(rawAccount as AccountView)
      ? (rawAccount as AccountView)
      : options[0]
    : null;
  const q = sp.get("q") ?? "";
  const unread = sp.get("unread") === "1";
  const m = sp.get("m");

  // ---- folders
  const [folders, setFolders] = useState<{ account: AccountId; list: MailFolder[] } | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  useEffect(() => {
    if (!account || account === "all") return;
    const ac = new AbortController();
    getJson<{ folders: MailFolder[] }>({ view: "folders", account }, ac.signal)
      .then((d) => {
        setFolders({ account, list: d.folders });
        setFoldersError(null);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setFoldersError(msg(e));
      });
    return () => ac.abort();
  }, [account]);

  const folderList: MailFolder[] | null =
    account && account !== "all" && folders?.account === account ? folders.list : null;
  const ordered = useMemo(() => {
    if (!folderList) return [];
    const byParent = new Map<string | null, MailFolder[]>();
    const ids = new Set(folderList.map((f) => f.id));
    for (const f of folderList) {
      const p = f.parentId && ids.has(f.parentId) ? f.parentId : null;
      byParent.set(p, [...(byParent.get(p) ?? []), f]);
    }
    const rank = (f: MailFolder) => (f.role ? ROLES.indexOf(f.role as (typeof ROLES)[number]) : -1);
    const sort = (a: MailFolder, b: MailFolder) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra >= 0 && rb >= 0) return ra - rb;
      if (ra >= 0) return -1;
      if (rb >= 0) return 1;
      return a.name.localeCompare(b.name);
    };
    const out: { f: MailFolder; depth: number }[] = [];
    const walk = (p: string | null, depth: number) => {
      for (const f of (byParent.get(p) ?? []).sort(sort)) {
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folderList]);

  const rawFolder = sp.get("folder");
  const inboxId = folderList?.find((f) => f.role === "inbox")?.id;
  const folder: string | undefined =
    account === "all" ? (rawFolder && ROLES.includes(rawFolder as (typeof ROLES)[number]) ? rawFolder : "inbox") : (rawFolder ?? inboxId);
  // A single account waits for its folder list so the first fetch already knows the inbox.
  const foldersReady = account === "all" || !!rawFolder || !!folderList || !!foldersError;

  // ---- message list (keeps the old list on screen while the next one loads)
  const [list, setList] = useState<ListData | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const listKey = `${account}|${folder ?? ""}|${q}|${unread}`;
  const listLoading = foldersReady && settledKey !== listKey;
  const moreAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!account || !foldersReady) return;
    moreAbort.current?.abort();
    const ac = new AbortController();
    getJson<ListData>({ view: "messages", account, folder, q: q || undefined, unread: unread ? "1" : undefined }, ac.signal)
      .then((d) => {
        setList(d);
        setListError(null);
        setSettledKey(listKey);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setListError(msg(e));
        setSettledKey(listKey);
      });
    return () => ac.abort();
    // listKey covers account, folder, q and unread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, foldersReady]);

  function loadMore() {
    if (!account || !list?.nextPageToken) return;
    moreAbort.current?.abort();
    const ac = new AbortController();
    moreAbort.current = ac;
    setMoreLoading(true);
    getJson<ListData>(
      { view: "messages", account, folder, q: q || undefined, unread: unread ? "1" : undefined, page: list.nextPageToken },
      ac.signal
    )
      .then((d) => {
        setList((prev) => (prev ? { messages: [...prev.messages, ...d.messages], nextPageToken: d.nextPageToken, errors: d.errors } : d));
        setMoreLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setListError(msg(e));
        setMoreLoading(false);
      });
  }

  const rows = useMemo(() => list?.messages ?? [], [list]);
  const rowKey = (r: MessageSummary) => `${r.account}:${r.threadId}`;

  // ---- keyboard cursor (j/k move, Enter opens)
  const [cursor, setCursor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showFolders, setShowFolders] = useState(false);

  const open = useCallback((key: string | null) => setParams({ m: key }), [setParams]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!rows.length) return;
      const keys = rows.map(rowKey);
      const at = cursor ? keys.indexOf(cursor) : m ? keys.indexOf(m) : -1;
      if (e.key === "j" || e.key === "k") {
        const next = keys[Math.max(0, Math.min(keys.length - 1, at + (e.key === "j" ? 1 : -1)))];
        setCursor(next);
        document.getElementById(`mail-row-${next}`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && at >= 0 && t?.tagName !== "BUTTON") {
        open(keys[at]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, m, open]);

  // ---- no account / loading
  if (accountsError) return <Notice text={accountsError} />;
  if (!accounts) return <div className="p-6 ui-meta text-ink-muted">Loading mail…</div>;
  if (!account) {
    return (
      <div className="p-6 ui-row text-ink-muted">
        No mail account is connected.{" "}
        <Link href="/build/modules" className="text-ink underline">
          Connect Outlook or Gmail in Build → Modules → Mail &amp; Calendar
        </Link>
        .
      </div>
    );
  }

  const foldersPane = (
    <FolderPane
      account={account}
      folder={folder}
      ordered={ordered}
      error={foldersError}
      loading={account !== "all" && !folderList && !foldersError}
      onPick={(id) => {
        setParams({ folder: id, m: null });
        setShowFolders(false);
      }}
    />
  );

  const listPane = (
    <section aria-label="Messages" className="flex min-h-0 flex-1 flex-col">
      {list?.errors?.map((e) => (
        <Notice key={e.account} text={`${ACCOUNT_NAME[e.account]} couldn't be reached: ${e.error}`} slim />
      ))}
      {listError && <Notice text={listError} slim />}
      <div className={`min-h-0 flex-1 overflow-y-auto ${listLoading ? "opacity-70" : ""}`} aria-busy={listLoading}>
        {!list && listLoading && <p className="p-4 ui-meta text-ink-muted">Loading…</p>}
        {list && rows.length === 0 && !listLoading && <p className="p-4 ui-meta text-ink-muted">No messages</p>}
        <ul role="listbox" aria-label="Messages" className="divide-y divide-line">
          {rows.map((r) => {
            const key = rowKey(r);
            const opened = key === m;
            return (
              <li key={r.account + r.id} id={`mail-row-${key}`} role="option" aria-selected={opened}>
                <button
                  type="button"
                  onClick={() => {
                    setCursor(key);
                    open(key);
                  }}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-muted ${
                    opened ? "bg-surface-3" : cursor === key ? "bg-surface-2" : "hover:bg-surface-1"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {account === "all" && (
                      <>
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${ACCOUNT_DOT[r.account]}`} />
                        <span className="sr-only">{ACCOUNT_NAME[r.account]} account</span>
                      </>
                    )}
                    {!r.read && (
                      <>
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-ink" />
                        <span className="sr-only">Unread</span>
                      </>
                    )}
                    <span className={`min-w-0 flex-1 truncate ui-row ${r.read ? "text-ink-muted" : "font-semibold text-ink"}`}>
                      {who(r.from)}
                    </span>
                    {r.flagged && (
                      <span title="Flagged" aria-label="Flagged" className="text-amber-500">
                        ⚑
                      </span>
                    )}
                    {r.hasAttachments && (
                      <span title="Has attachments" aria-label="Has attachments" className="text-ink-subtle">
                        📎
                      </span>
                    )}
                    <span className="shrink-0 ui-meta text-ink-subtle">{shortTime(r.receivedAt)}</span>
                  </span>
                  <span className={`truncate ui-row ${r.read ? "text-ink-muted" : "font-semibold text-ink"}`}>
                    {r.subject || "(no subject)"}
                  </span>
                  <span className="truncate ui-meta text-ink-subtle">{r.preview}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {list?.nextPageToken && (
          <div className="p-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={moreLoading}
              className="w-full rounded-card border border-line bg-surface-1 px-3 py-2 ui-row text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              {moreLoading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </section>
  );

  const readPane = (
    <ReadingPane
      selection={m}
      rows={rows}
      onBack={tier === 1 ? () => open(null) : undefined}
    />
  );

  const showReading = tier === 1 ? !!m : true;
  const showList = tier === 1 ? !m && !showFolders : !(tier === 2 && showFolders);
  const showFoldersPane = tier === 3 || showFolders;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[24rem] flex-col bg-surface-0 text-ink">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {tier < 3 && (
          <button
            type="button"
            onClick={() => setShowFolders((v) => !v)}
            aria-pressed={showFolders}
            className="rounded-card border border-line bg-surface-1 px-3 py-1 ui-row hover:bg-surface-2"
          >
            Folders
          </button>
        )}
        <div role="group" aria-label="Account" className="inline-flex overflow-hidden rounded-card border border-line">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === account}
              onClick={() => {
                setParams({ account: o, folder: null, m: null });
                setShowFolders(false);
              }}
              className={`px-3 py-1 ui-row ${o === account ? "bg-surface-3 text-ink" : "bg-surface-1 text-ink-muted hover:bg-surface-2"}`}
            >
              {o === "all" ? "All" : ACCOUNT_NAME[o]}
            </button>
          ))}
        </div>
        <SearchBox
          key={q}
          inputRef={searchRef}
          initial={q}
          onSubmit={(v) => setParams({ q: v || null, m: null })}
        />
        <label className="flex items-center gap-1.5 ui-row text-ink-muted">
          <input type="checkbox" checked={unread} onChange={(e) => setParams({ unread: e.target.checked ? "1" : null, m: null })} />
          Unread only
        </label>
      </header>
      <div className="flex min-h-0 flex-1">
        {showFoldersPane && (
          <div className={`min-h-0 overflow-y-auto border-r border-line ${tier === 1 ? "flex-1" : "w-[220px] shrink-0"}`}>{foldersPane}</div>
        )}
        {showList && (
          <div className={`flex min-h-0 flex-col ${tier === 1 ? "flex-1" : "w-[380px] shrink-0 border-r border-line"}`}>{listPane}</div>
        )}
        {showReading && !(tier === 1 && showFolders) && <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{readPane}</div>}
      </div>
    </div>
  );
}

function SearchBox({
  inputRef,
  initial,
  onSubmit,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  initial: string;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="relative min-w-40 flex-1">
      <input
        ref={inputRef}
        type="search"
        value={v}
        aria-label="Search mail"
        placeholder="Search mail (press / to focus)"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(v.trim());
        }}
        className="w-full rounded-card border border-line bg-surface-1 px-3 py-1 pr-8 ui-row text-ink placeholder:text-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {v && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setV("");
            onSubmit("");
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-2 text-ink-subtle hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  );
}

function Notice({ text, slim }: { text: string; slim?: boolean }) {
  return (
    <p role="alert" className={`border-b border-line bg-surface-2 ui-meta text-ink-muted ${slim ? "px-3 py-1" : "m-4 rounded-card border px-3 py-2"}`}>
      {text}
    </p>
  );
}

function FolderPane({
  account,
  folder,
  ordered,
  error,
  loading,
  onPick,
}: {
  account: AccountView;
  folder: string | undefined;
  ordered: { f: MailFolder; depth: number }[];
  error: string | null;
  loading: boolean;
  onPick: (id: string) => void;
}) {
  const items =
    account === "all"
      ? ROLES.map((r) => ({ id: r as string, name: ROLE_LABEL[r], depth: 0, unread: 0 }))
      : ordered.map(({ f, depth }) => ({ id: f.id, name: f.role ? ROLE_LABEL[f.role] : f.name, depth, unread: f.unread }));
  return (
    <nav aria-label="Folders" className="py-2">
      {error && <Notice text={error} slim />}
      {loading && <p className="px-3 ui-meta text-ink-muted">Loading…</p>}
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onPick(it.id)}
              aria-current={it.id === folder ? "true" : undefined}
              style={{ paddingLeft: 12 + it.depth * 12 }}
              className={`flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-left ui-row focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-muted ${
                it.id === folder ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-1"
              }`}
            >
              <span className="truncate">{it.name}</span>
              {it.unread > 0 && <span className="ui-meta text-ink-subtle">{badgeCount(it.unread)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ReadingPane({
  selection,
  rows,
  onBack,
}: {
  selection: string | null;
  rows: MessageSummary[];
  onBack?: () => void;
}) {
  const [thread, setThread] = useState<{ key: string; messages: FullMessage[] } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The row's own message id, for the one-message fallback; read through a ref so a list reload doesn't refetch.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  useEffect(() => {
    if (!selection) return;
    const i = selection.indexOf(":");
    const account = selection.slice(0, i) as AccountId;
    const threadId = selection.slice(i + 1);
    const ac = new AbortController();
    (async () => {
      let messages: FullMessage[];
      try {
        messages = (await getJson<{ messages: FullMessage[] }>({ view: "thread", account, id: threadId }, ac.signal)).messages;
      } catch (e) {
        if (ac.signal.aborted) return;
        const row = rowsRef.current.find((r) => r.account === account && r.threadId === threadId);
        try {
          messages = [(await getJson<{ message: FullMessage }>({ view: "message", account, id: row?.id ?? threadId }, ac.signal)).message];
        } catch {
          setError({ key: selection, text: msg(e) });
          return;
        }
      }
      if (ac.signal.aborted) return;
      setError(null);
      setThread({ key: selection, messages });
      setExpanded(new Set(messages.length ? [messages[messages.length - 1].id] : []));
    })();
    return () => ac.abort();
  }, [selection]);

  if (!selection) {
    return <p className="p-6 ui-meta text-ink-muted">Select a message to read it.</p>;
  }
  const current = thread?.key === selection ? thread.messages : null;
  const err = error?.key === selection ? error.text : null;
  const subject = current?.[0]?.subject || "(no subject)";

  return (
    <article className="flex flex-col gap-3 p-4">
      {onBack && (
        <button type="button" onClick={onBack} className="self-start rounded-card border border-line bg-surface-1 px-3 py-1 ui-row hover:bg-surface-2">
          ← Back
        </button>
      )}
      {err && <Notice text={err} />}
      {!current && !err && <p className="ui-meta text-ink-muted">Loading…</p>}
      {current && (
        <>
          <h2 className="ui-title">{subject}</h2>
          {current.map((message, idx) => {
            const isLast = idx === current.length - 1;
            const isOpen = isLast ? true : expanded.has(message.id);
            return isOpen ? (
              <MessageView key={message.id} message={message} />
            ) : (
              <button
                key={message.id}
                type="button"
                aria-expanded={false}
                onClick={() => setExpanded((s) => new Set(s).add(message.id))}
                className="flex items-center gap-3 rounded-card border border-line bg-surface-1 px-3 py-2 text-left hover:bg-surface-2"
              >
                <span className="shrink-0 ui-row text-ink">{who(message.from)}</span>
                <span className="shrink-0 ui-meta text-ink-subtle">{shortTime(message.receivedAt)}</span>
                <span className="min-w-0 flex-1 truncate ui-meta text-ink-subtle">{message.preview}</span>
              </button>
            );
          })}
        </>
      )}
    </article>
  );
}

function MessageView({ message }: { message: FullMessage }) {
  const files = message.attachments.filter((a) => !a.inline);
  const provider = ACCOUNT_NAME[message.account];
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 ui-meta">
        <dt className="text-ink-subtle">From</dt>
        <dd className="text-ink">{message.from ? addr(message.from) : "Unknown sender"}</dd>
        {message.to.length > 0 && (
          <>
            <dt className="text-ink-subtle">To</dt>
            <dd className="text-ink-muted">{message.to.map(addr).join(", ")}</dd>
          </>
        )}
        {message.cc.length > 0 && (
          <>
            <dt className="text-ink-subtle">Cc</dt>
            <dd className="text-ink-muted">{message.cc.map(addr).join(", ")}</dd>
          </>
        )}
        <dt className="text-ink-subtle">Date</dt>
        <dd className="text-ink-muted">{fullTime(message.receivedAt)}</dd>
      </dl>
      <SafeMailBody html={message.bodyHtml} text={message.bodyText} />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((a) => (
            <li key={a.id}>
              <a
                href={`/api/mail/attachment?account=${message.account}&message=${encodeURIComponent(message.id)}&id=${encodeURIComponent(a.id)}`}
                className="inline-flex items-center gap-2 rounded-card border border-line bg-surface-2 px-3 py-1 ui-meta text-ink hover:bg-surface-3"
              >
                <span aria-hidden>📎</span>
                <span>{a.name}</span>
                <span className="text-ink-subtle">{formatBytes(a.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {message.webLink && (
        <a href={message.webLink} target="_blank" rel="noopener noreferrer" className="self-start ui-meta text-ink underline">
          Open in {provider}
        </a>
      )}
    </div>
  );
}
