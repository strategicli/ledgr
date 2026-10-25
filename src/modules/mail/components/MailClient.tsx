"use client";

// The Mail screen: folders, message list and reading pane, fed live by
// /api/mail/read, plus acting (archive, delete, move, read, flag, tags) through
// /api/mail/act with optimistic updates and an Undo toast, and Ledgr links
// (linked items, Make task/note/meeting, attachment import) through
// /api/mail/link. Never sends.
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { showToast } from "@/components/ui/ActionToast";
import { badgeCount, formatBytes } from "@/lib/format-count";
import { Icon, type IconName } from "@/modules/mail/components/MailIcons";
import type { LinkedItem, LinkType } from "@/modules/mail/lib/links";
import type { MailAction, MailRef } from "@/modules/mail/lib/acting";
import type { AccountId, FullMessage, MailAddress, MailFolder, MailTag, MessageSummary } from "@/modules/mail/lib/types";

const SafeMailBody = dynamic(() => import("@/modules/mail/components/SafeMailBody"), { ssr: false });

type AccountView = AccountId | "all";
type ListErrors = { account: AccountId; error: string }[];
type ListData = { messages: MessageSummary[]; nextPageToken: string | null; errors?: ListErrors; searchedAll?: boolean };
type Density = "comfortable" | "compact";

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
const ROLE_ICON: Record<string, IconName> = { inbox: "inbox", drafts: "draft", sent: "send", archive: "archive", spam: "spam", trash: "trash" };

async function getJson<T>(params: Record<string, string | undefined>, signal: AbortSignal): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const res = await fetch(`/api/mail/read?${sp}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`), { status: res.status });
  }
  return body as T;
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const LINK_TYPES: LinkType[] = ["task", "note", "event"];
const TYPE_CAP: Record<LinkType, string> = { task: "Task", note: "Note", event: "Meeting" };
const TYPE_KEY: Record<LinkType, string> = { task: "T", note: "N", event: "M" };
// Ledgr item types get one hue each, everywhere on this screen.
const TYPE_TONE: Record<LinkType, string> = {
  task: "text-blue-500 border-blue-500/40 bg-blue-500/10",
  note: "text-amber-500 border-amber-500/40 bg-amber-500/10",
  event: "text-teal-500 border-teal-500/40 bg-teal-500/10",
};
const TYPE_TEXT: Record<LinkType, string> = { task: "text-blue-500", note: "text-amber-500", event: "text-teal-500" };
const GONE = "This email is no longer in your mailbox.";
const isDone = (i: LinkedItem) => /^(done|complete|completed|closed)$/i.test(i.status ?? "");
const asType = (t: string): LinkType | null => (LINK_TYPES.includes(t as LinkType) ? (t as LinkType) : null);

// POST /api/mail/link. Throws an Error carrying the server's message.
async function linkPost<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/mail/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
  return body as T;
}

const selKey = (r: MessageSummary) => `${r.account}:${r.id}`;
const rowKey = (r: MessageSummary) => `${r.account}:${r.threadId}`;
const refOf = (r: MessageSummary): MailRef => ({ account: r.account, id: r.id });
const MULTI_TIP = "Pick messages from one account to move or tag them";
const BTN = "rounded-card border border-line bg-surface-1 px-2 py-1 ui-row text-ink hover:bg-surface-2 disabled:opacity-50";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]";
const TIP_PANEL =
  "pointer-events-none absolute z-30 whitespace-nowrap rounded-card border border-neutral-700 bg-neutral-900 px-2 py-1 ui-meta normal-case text-ink opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";
const SECTION = "px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle";

// POST one action. Never throws: a failed request counts as every account failing.
async function post(items: MailRef[], action: MailAction): Promise<{ account: AccountId; error: string }[]> {
  try {
    const res = await fetch("/api/mail/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
    return Array.isArray(body.errors) ? body.errors : [];
  } catch (e) {
    return [...new Set(items.map((i) => i.account))].map((account) => ({ account, error: msg(e) }));
  }
}

// What a row looks like right after an in-place action (archive/move/trash remove it instead).
function applyAction(r: MessageSummary, a: MailAction): MessageSummary {
  switch (a.kind) {
    case "read":
      return { ...r, read: a.value };
    case "flag":
      return { ...r, flagged: a.value };
    case "tags": {
      const kept = r.tags.filter((t) => !a.remove.includes(t));
      return { ...r, tags: [...kept, ...a.add.filter((t) => !kept.includes(t))] };
    }
    default:
      return r;
  }
}

function toastText(a: MailAction, n: number): string {
  const s = `${n} message${n === 1 ? "" : "s"}`;
  switch (a.kind) {
    case "archive":
      return `Archived ${s}`;
    case "trash":
      return `Deleted ${s}`;
    case "move":
      return `Moved ${s}`;
    case "read":
      return `Marked ${s} ${a.value ? "read" : "unread"}`;
    case "flag":
      return `${a.value ? "Flagged" : "Unflagged"} ${s}`;
    case "tags":
      return `Updated tags on ${s}`;
    default:
      return `Updated ${s}`;
  }
}

// The calls that put things back, from each message's state BEFORE the action.
function undoGroups(ok: MessageSummary[], a: MailAction): { items: MailRef[]; action: MailAction }[] {
  const group = (key: (r: MessageSummary) => string | undefined, mk: (k: string) => MailAction) => {
    const g = new Map<string, MessageSummary[]>();
    for (const r of ok) {
      const k = key(r);
      if (k) g.set(k, [...(g.get(k) ?? []), r]);
    }
    return [...g].map(([k, rs]) => ({ items: rs.map(refOf), action: mk(k) }));
  };
  switch (a.kind) {
    case "archive":
    case "move":
      return group((r) => r.folderIds[0], (folderId) => ({ kind: "move", folderId }));
    case "trash":
      return group((r) => r.folderIds[0], (folderId) => ({ kind: "restore", folderId }));
    case "read":
      return group((r) => String(r.read), (k) => ({ kind: "read", value: k === "true" }));
    case "flag":
      return group((r) => String(r.flagged), (k) => ({ kind: "flag", value: k === "true" }));
    case "tags":
      return [{ items: ok.map(refOf), action: { kind: "tags", add: a.remove, remove: a.add } }];
    default:
      return [];
  }
}

const DAY = 86400000;
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const days = (startOfDay(now) - startOfDay(d)) / DAY;
  if (days <= 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US");
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} hr ago`;
  const d = Math.round(m / 1440);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function dayGroup(iso: string | null): string {
  if (!iso) return "Earlier";
  const days = (startOfDay(new Date()) - startOfDay(new Date(iso))) / DAY;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

function fullTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : "";
}

const who = (a: MailAddress | null) => (a ? a.name || a.email : "Unknown sender");
const addr = (a: MailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

// Sender avatars: initials on a color picked from the address, so a person
// keeps their color across the list, the thread and both accounts.
const AVATAR = ["bg-blue-600", "bg-violet-600", "bg-teal-600", "bg-orange-700", "bg-pink-700", "bg-lime-700", "bg-sky-700", "bg-purple-600"];
function avatarClass(a: MailAddress | null): string {
  const s = (a?.email || a?.name || "?").toLowerCase();
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
function initials(a: MailAddress | null): string {
  const base = (a?.name || a?.email.split("@")[0] || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Avatar({ from, size = 34, account }: { from: MailAddress | null; size?: number; account?: AccountId }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`relative grid shrink-0 place-items-center rounded-full font-semibold text-white ${avatarClass(from)}`}
    >
      {initials(from)}
      {account && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-0 ${ACCOUNT_DOT[account]}`} />
      )}
    </span>
  );
}

// Screen width: 3 = three panes, 2 = folders in a drawer, 1 = one pane at a time.
function useLayoutTier(): 1 | 2 | 3 {
  return useSyncExternalStore(
    (cb) => {
      const qs = [window.matchMedia("(min-width: 1180px)"), window.matchMedia("(min-width: 768px)")];
      qs.forEach((q) => q.addEventListener("change", cb));
      return () => qs.forEach((q) => q.removeEventListener("change", cb));
    },
    () => (window.matchMedia("(min-width: 1180px)").matches ? 3 : window.matchMedia("(min-width: 768px)").matches ? 2 : 1),
    () => 3
  );
}

// A remembered per-browser preference (density, the tags section). Storage can
// throw in private windows; the default is used then.
function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      // Reading storage after mount keeps the server render and the first client render the same.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) setV(s as T);
    } catch {}
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {}
    },
    [key]
  );
  return [v, set];
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
  const [density, setDensity] = usePref<Density>("ledgr.mail.density", "comfortable");

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
  const flagged = sp.get("flagged") === "1";
  const files = sp.get("files") === "1";
  // Client-side narrowing of the loaded page: only Ledgr knows these.
  const linkedOnly = sp.get("linked") === "1";
  const tagFilter = sp.get("tag");
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
  const [retry, setRetry] = useState(0);
  const listKey = `${account}|${folder ?? ""}|${q}|${unread}|${flagged}|${files}|${retry}`;
  const listLoading = foldersReady && settledKey !== listKey;
  const moreAbort = useRef<AbortController | null>(null);
  const listParams = useCallback(
    () => ({
      view: "messages",
      account: account ?? undefined,
      folder,
      q: q || undefined,
      unread: unread ? "1" : undefined,
      flagged: flagged ? "1" : undefined,
      files: files ? "1" : undefined,
    }),
    [account, folder, q, unread, flagged, files]
  );

  useEffect(() => {
    if (!account || !foldersReady) return;
    moreAbort.current?.abort();
    const ac = new AbortController();
    getJson<ListData>(listParams(), ac.signal)
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
    // listKey covers every list parameter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, foldersReady]);

  function loadMore() {
    if (!account || !list?.nextPageToken) return;
    moreAbort.current?.abort();
    const ac = new AbortController();
    moreAbort.current = ac;
    setMoreLoading(true);
    getJson<ListData>({ ...listParams(), page: list.nextPageToken }, ac.signal)
      .then((d) => {
        setList((prev) => {
          if (!prev) return d;
          // A combined page can repeat a message the last one ended on.
          const have = new Set(prev.messages.map(selKey));
          return { ...prev, messages: [...prev.messages, ...d.messages.filter((x) => !have.has(selKey(x)))], nextPageToken: d.nextPageToken, errors: d.errors };
        });
        setMoreLoading(false);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setListError(msg(e));
        setMoreLoading(false);
      });
  }

  const allRows = useMemo(() => list?.messages ?? [], [list]);

  // ---- acting
  const [actError, setActError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagsBy, setTagsBy] = useState<Partial<Record<AccountId, MailTag[]>>>({});
  const tagReq = useRef(new Set<AccountId>());
  const autoRead = useRef(new Set<string>());

  // ---- Ledgr links: cached by message id, looked up once per message.
  const [links, setLinks] = useState<Record<string, LinkedItem[]>>({});
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [linkError, setLinkError] = useState<string | null>(null);
  const looked = useRef(new Set<string>());
  const lookup = useCallback((ms: { id: string; internetMessageId: string | null }[]) => {
    const fresh = ms.filter((x) => !looked.current.has(x.id));
    for (const x of fresh) looked.current.add(x.id);
    for (let i = 0; i < fresh.length; i += 100) {
      const batch = fresh.slice(i, i + 100);
      linkPost<{ links: Record<string, LinkedItem[]> }>({
        op: "lookup",
        emails: batch.map((x) => ({ id: x.id, internetMessageId: x.internetMessageId })),
      })
        .then((d) =>
          setLinks((p) => {
            const n = { ...p };
            for (const x of batch) n[x.id] = d.links?.[x.id] ?? [];
            return n;
          })
        )
        // A failed lookup just shows no links; let a later load retry it.
        .catch(() => batch.forEach((x) => looked.current.delete(x.id)));
    }
  }, []);

  const rows = useMemo(
    () =>
      allRows.filter(
        (r) => (!linkedOnly || (links[r.id]?.length ?? 0) > 0) && (!tagFilter || r.tags.includes(tagFilter))
      ),
    [allRows, linkedOnly, tagFilter, links]
  );

  async function makeItem(r: MessageSummary, type: LinkType) {
    const k = `${r.id}:${type}`;
    if (creating.has(k)) return;
    setLinkError(null);
    setCreating((s) => new Set(s).add(k));
    try {
      const { item } = await linkPost<{ item: LinkedItem }>({ op: "create", account: r.account, id: r.id, type });
      setLinks((p) => ({ ...p, [r.id]: [...(p[r.id] ?? []), item] }));
      // The server flagged the email for a task; mirror it on the row.
      if (type === "task") {
        setList((prev) => prev && { ...prev, messages: prev.messages.map((x) => (selKey(x) === selKey(r) ? { ...x, flagged: true } : x)) });
      }
      showToast(`${TYPE_CAP[type]} created`, undefined, { link: { label: "Open", href: `/items/${item.id}` } });
    } catch (e) {
      setLinkError(msg(e));
    } finally {
      setCreating((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }

  // One-click import: the files become a new note linked to the email.
  async function importFiles(message: FullMessage, attachmentIds?: string[]) {
    const k = `${message.id}:import:${attachmentIds?.join(",") ?? "all"}`;
    if (creating.has(k)) return;
    setLinkError(null);
    setCreating((s) => new Set(s).add(k));
    try {
      const { item } = await linkPost<{ item: LinkedItem }>({ op: "import", account: message.account, messageId: message.id, attachmentIds });
      setLinks((p) => ({ ...p, [message.id]: [...(p[message.id] ?? []), item] }));
      showToast(`Imported to Ledgr as “${item.title}”`, undefined, { link: { label: "Open", href: `/items/${item.id}` } });
    } catch (e) {
      setLinkError(msg(e));
    } finally {
      setCreating((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }

  const paramsRef = useRef({ key: listKey, params: listParams });
  useEffect(() => {
    paramsRef.current = { key: listKey, params: listParams };
  });

  useEffect(() => lookup(allRows), [allRows, lookup]);

  // Tags are fetched once per account, only when a list shows that account.
  useEffect(() => {
    const want = new Set(allRows.map((r) => r.account));
    if (account && account !== "all") want.add(account);
    for (const a of want) {
      if (tagReq.current.has(a)) continue;
      tagReq.current.add(a);
      getJson<{ tags: MailTag[] }>({ view: "tags", account: a }, new AbortController().signal)
        .then((d) => setTagsBy((p) => ({ ...p, [a]: d.tags })))
        .catch(() => setTagsBy((p) => ({ ...p, [a]: [] })));
    }
  }, [allRows, account]);

  function refetch() {
    const p = paramsRef.current;
    getJson<ListData>(p.params(), new AbortController().signal)
      .then((d) => {
        if (paramsRef.current.key === p.key) {
          setList(d);
          setListError(null);
        }
      })
      .catch((e) => setActError(msg(e)));
  }

  const errText = (errs: { account: AccountId; error: string }[]) =>
    errs.map((e) => `${ACCOUNT_NAME[e.account]}: ${e.error}`).join(" ");

  async function undo(groups: { items: MailRef[]; action: MailAction }[]) {
    const errs: { account: AccountId; error: string }[] = [];
    for (const g of groups) errs.push(...(await post(g.items, g.action)));
    if (errs.length) setActError(errText(errs));
    refetch();
  }

  const open = useCallback((key: string | null) => setParams({ m: key }), [setParams]);

  async function doAct(targets: MessageSummary[], action: MailAction, silent = false) {
    if (!targets.length) return;
    setActError(null);
    const keys = new Set(targets.map(selKey));
    const order = new Map(allRows.map((r, i) => [selKey(r), i]));
    const removing = action.kind === "move" || action.kind === "archive" || action.kind === "trash";
    // Removing the open conversation moves on to the next one, as Gmail does.
    if (removing && m && targets.some((r) => rowKey(r) === m)) {
      const at = rows.findIndex((r) => rowKey(r) === m);
      const rest = (xs: MessageSummary[]) => xs.find((r) => !keys.has(selKey(r)) && rowKey(r) !== m);
      const nxt = rest(rows.slice(at + 1)) ?? rest(rows.slice(0, Math.max(at, 0)).reverse());
      open(nxt ? rowKey(nxt) : null);
    }
    setList(
      (prev) =>
        prev && {
          ...prev,
          messages: removing
            ? prev.messages.filter((r) => !keys.has(selKey(r)))
            : prev.messages.map((r) => (keys.has(selKey(r)) ? applyAction(r, action) : r)),
        }
    );
    const errors = await post(targets.map(refOf), action);
    const bad = new Set(errors.map((e) => e.account));
    if (bad.size) {
      const back = targets.filter((r) => bad.has(r.account));
      setList((prev) => {
        if (!prev) return prev;
        const byKey = new Map(back.map((r) => [selKey(r), r]));
        const have = new Set(prev.messages.map(selKey));
        const msgs = prev.messages.map((r) => byKey.get(selKey(r)) ?? r);
        for (const r of back) if (!have.has(selKey(r))) msgs.push(r);
        msgs.sort((a, b) => (order.get(selKey(a)) ?? 1e9) - (order.get(selKey(b)) ?? 1e9));
        return { ...prev, messages: msgs };
      });
      setActError(errText(errors));
    }
    const ok = targets.filter((r) => !bad.has(r.account));
    if (!ok.length || silent) return;
    const groups = undoGroups(ok, action);
    showToast(toastText(action, ok.length), groups.length ? () => void undo(groups) : undefined);
  }

  // Opening an unread message marks it read (once per message, no toast).
  useEffect(() => {
    const r = m ? allRows.find((x) => rowKey(x) === m) : undefined;
    if (!r || r.read || autoRead.current.has(selKey(r))) return;
    autoRead.current.add(selKey(r));
    void doAct([r], { kind: "read", value: true }, true);
    // doAct is a plain function over refs and setters; m and rows are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, allRows]);

  function endSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  function toggleSelect(r: MessageSummary) {
    setSelecting(true);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(selKey(r))) n.delete(selKey(r));
      else n.add(selKey(r));
      return n;
    });
  }

  const selectedRows = rows.filter((r) => selected.has(selKey(r)));
  const openedRow = m ? allRows.find((r) => rowKey(r) === m) : undefined;

  const searchRef = useRef<HTMLInputElement>(null);
  const [showFolders, setShowFolders] = useState(false);

  // ---- keyboard. Letters follow Gmail; Backspace archives and Delete deletes.
  const keyState = useRef({ rows, m, selecting, selectedRows, openedRow });
  useEffect(() => {
    keyState.current = { rows, m, selecting, selectedRows, openedRow };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const s = keyState.current;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && s.selecting) {
        endSelect();
        return;
      }
      const keys = s.rows.map(rowKey);
      const at = s.m ? keys.indexOf(s.m) : -1;
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!keys.length) return;
        e.preventDefault();
        const down = e.key === "j" || e.key === "ArrowDown";
        const next = keys[at < 0 ? 0 : Math.max(0, Math.min(keys.length - 1, at + (down ? 1 : -1)))];
        open(next);
        document.getElementById(`mail-row-${next}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      // Acts on the selection when there is one, otherwise the open message.
      const targets = s.selecting && s.selectedRows.length ? s.selectedRows : s.openedRow ? [s.openedRow] : [];
      if (!targets.length) return;
      const act = (a: MailAction) => {
        e.preventDefault();
        void doAct(targets, a);
        if (s.selecting) endSelect();
      };
      switch (e.key) {
        case "Backspace":
        case "e":
          return act({ kind: "archive" });
        case "Delete":
        case "#":
          return act({ kind: "trash" });
        case "s":
          return act({ kind: "flag", value: !targets.every((r) => r.flagged) });
        case "u":
          return act({ kind: "read", value: !targets.every((r) => r.read) });
        case "t":
        case "n":
        case "m":
          if (s.openedRow && !s.selecting) {
            e.preventDefault();
            void makeItem(s.openedRow, e.key === "t" ? "task" : e.key === "n" ? "note" : "event");
          }
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Reads live state through keyState; the handler itself never needs rebinding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const folderName =
    account === "all"
      ? ROLE_LABEL[folder ?? "inbox"]
      : (() => {
          const f = folderList?.find((x) => x.id === folder);
          return f ? (f.role ? ROLE_LABEL[f.role] : f.name) : "Mail";
        })();
  const searching = !!q;
  const allTags = account === "all" ? [...(tagsBy.microsoft ?? []), ...(tagsBy.gmail ?? [])] : (tagsBy[account] ?? []);

  const foldersPane = (
    <FolderPane
      options={options}
      account={account}
      folder={searching ? undefined : folder}
      ordered={ordered}
      error={foldersError}
      loading={account !== "all" && !folderList && !foldersError}
      tags={allTags}
      tagCounts={allRows}
      tagFilter={tagFilter}
      onAccount={(o) => {
        setParams({ account: o, folder: null, m: null, tag: null });
        setShowFolders(false);
      }}
      onPick={(id) => {
        setParams({ folder: id, m: null, q: null, tag: null });
        setShowFolders(false);
      }}
      onTag={(id) => {
        setParams({ tag: tagFilter === id ? null : id, m: null });
        setShowFolders(false);
      }}
    />
  );

  const chips: { key: string; label: string; on: boolean; param: string; count?: number }[] = [
    { key: "unread", label: "Unread", on: unread, param: "unread" },
    { key: "flagged", label: "Flagged", on: flagged, param: "flagged" },
    { key: "files", label: "Files", on: files, param: "files" },
    { key: "linked", label: "In Ledgr", on: linkedOnly, param: "linked", count: allRows.filter((r) => links[r.id]?.length).length },
  ];
  const anyChip = chips.some((c) => c.on) || !!tagFilter;
  const tagName = tagFilter ? (allTags.find((t) => t.id === tagFilter)?.name ?? tagFilter) : null;
  const unreadCount = allRows.filter((r) => !r.read).length;

  const listPane = (
    <section aria-label="Messages" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-3 pb-2 pt-3">
        <div className="flex items-baseline gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-ink">
            {searching ? (list?.searchedAll ? "All mail" : folderName) : folderName}
          </h1>
          <span className="shrink-0 ui-meta tabular-nums">
            {searching ? `${rows.length}${list?.nextPageToken ? "+" : ""} found` : `${unreadCount} unread · ${rows.length}${list?.nextPageToken ? "+" : ""}`}
          </span>
          <span className="flex-1" />
          {selecting && (
            <button type="button" onClick={() => setSelected(new Set(rows.map(selKey)))} className={`${BTN} shrink-0 ui-meta`}>
              All on page
            </button>
          )}
          <button type="button" aria-pressed={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))} className={`${BTN} shrink-0 ui-meta`}>
            {selecting ? "Done" : "Select"}
          </button>
        </div>
        {searching && (
          <div className="flex items-center gap-2 ui-meta">
            <Icon name="search" size={13} />
            <span className="min-w-0 truncate">
              {list?.searchedAll ? "Searching all folders" : "Searching"} for <span className="text-ink">{q}</span>
            </span>
            <button type="button" className="ml-auto shrink-0 text-ink-muted underline hover:text-ink" onClick={() => setParams({ q: null, m: null })}>
              Clear
            </button>
          </div>
        )}
        <div role="group" aria-label="Filter" className="no-scrollbar flex gap-1.5 overflow-x-auto">
          <Chip on={!anyChip} onClick={() => setParams({ unread: null, flagged: null, files: null, linked: null, tag: null, m: null })}>
            All
          </Chip>
          {chips.map((c) => (
            <Chip key={c.key} on={c.on} onClick={() => setParams({ [c.param]: c.on ? null : "1", m: null })}>
              {c.label}
              {c.count ? <span className="tabular-nums text-ink-subtle">{c.count}</span> : null}
            </Chip>
          ))}
          {tagName && (
            <Chip on onClick={() => setParams({ tag: null })}>
              <Icon name="tag" size={12} />
              {tagName}
              <Icon name="x" size={12} />
            </Chip>
          )}
        </div>
      </div>
      {list?.errors?.map((e) => (
        <Notice key={e.account} text={`${ACCOUNT_NAME[e.account]} couldn't be reached: ${e.error}`} slim />
      ))}
      {listError && <Notice text={listError} slim onRetry={() => setRetry((n) => n + 1)} />}
      {actError && <Notice text={actError} slim />}
      <div className={`min-h-0 flex-1 overflow-y-auto ${listLoading ? "opacity-60" : ""}`} aria-busy={listLoading}>
        {!list && listLoading && <ListSkeleton />}
        {list && rows.length === 0 && !listLoading && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center ui-meta">
            <Icon name={searching ? "search" : "inbox"} size={28} className="text-ink-faint" />
            <span className="ui-row text-ink-muted">{searching ? "No mail matches that search" : anyChip ? "Nothing matches these filters" : "Nothing here"}</span>
            {searching ? (
              <span>Check the spelling, or try fewer words. Operators like from: and has:attachment narrow a search.</span>
            ) : anyChip ? (
              <button type="button" className="underline hover:text-ink" onClick={() => setParams({ unread: null, flagged: null, files: null, linked: null, tag: null })}>
                Clear filters
              </button>
            ) : (
              <span>You&apos;re all caught up.</span>
            )}
          </div>
        )}
        <ul role="listbox" aria-label="Messages" aria-multiselectable={selecting}>
          {rows.map((r, i) => {
            const key = rowKey(r);
            const group = dayGroup(r.receivedAt);
            const showGroup = i === 0 || dayGroup(rows[i - 1].receivedAt) !== group;
            return (
              <MessageRow
                key={r.account + r.id}
                r={r}
                groupLabel={showGroup ? group : null}
                groupCount={showGroup ? rows.filter((x) => dayGroup(x.receivedAt) === group).length : 0}
                opened={key === m}
                compact={density === "compact"}
                selecting={selecting}
                picked={selected.has(selKey(r))}
                items={links[r.id] ?? []}
                tags={r.tags.map((id) => tagsBy[r.account]?.find((t) => t.id === id)).filter((t): t is MailTag => !!t)}
                onOpen={() => (selecting ? toggleSelect(r) : open(key))}
                onPick={() => toggleSelect(r)}
                onAct={(a) => void doAct([r], a)}
                onTask={() => void makeItem(r, "task")}
              />
            );
          })}
        </ul>
        {list?.nextPageToken && (
          <div className="p-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={moreLoading}
              className="w-full rounded-card border border-line bg-surface-1 px-3 py-2 ui-row text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60"
            >
              {moreLoading ? "Loading…" : searching ? "Load more results" : "Load older mail"}
            </button>
          </div>
        )}
      </div>
      {tier === 3 && (
        <div className="flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line px-3 py-1.5 ui-meta">
          <KeyHint k={["J", "K"]} label="move" />
          <KeyHint k={["⌫"]} label="archive" />
          <KeyHint k={["Del"]} label="delete" />
          <KeyHint k={["S"]} label="flag" />
          <KeyHint k={["T"]} label="task" />
        </div>
      )}
    </section>
  );

  const readPane = (
    <ReadingPane
      selection={m}
      rows={allRows}
      links={links}
      creating={creating}
      onLoaded={lookup}
      onImport={(message, ids) => void importFiles(message, ids)}
      onBack={tier === 1 ? () => open(null) : undefined}
      toolbar={
        openedRow && (
          <>
            <ActionBar
              label="Message actions"
              targets={[openedRow]}
              onAct={(a) => void doAct([openedRow], a)}
              folder={folder}
              folders={folderList}
              tags={tagsBy}
            />
            <span className="flex-1" />
            <div role="group" aria-label="Make in Ledgr" className="flex items-center gap-1.5">
              {tier === 3 && <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">Make</span>}
              {LINK_TYPES.map((t) => (
                <span key={t} className="group relative">
                  <button
                    type="button"
                    disabled={creating.has(`${openedRow.id}:${t}`)}
                    onClick={() => void makeItem(openedRow, t)}
                    aria-label={`Make a ${TYPE_CAP[t].toLowerCase()} from this email`}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-card border border-line bg-surface-1 px-2.5 ui-row font-medium hover:border-line-strong hover:bg-surface-2 disabled:opacity-50 ${FOCUS}`}
                  >
                    <Icon name={t} className={TYPE_TEXT[t]} />
                    {tier > 1 && TYPE_CAP[t]}
                  </button>
                  <span role="tooltip" className={`${TIP_PANEL} right-0 top-full mt-1.5`}>
                    Make a {TYPE_CAP[t].toLowerCase()} from this email <Kbd>{TYPE_KEY[t]}</Kbd>
                  </span>
                </span>
              ))}
            </div>
          </>
        )
      }
      notice={linkError && <Notice text={linkError} slim />}
    />
  );

  const showReading = tier === 1 ? !!m : true;
  const showList = tier === 1 ? !m : true;
  // Compact rows are one line, so the list widens to give the subject room.
  const listWidth = density === "compact" ? "w-[520px]" : "w-[400px]";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[24rem] flex-col bg-surface-0 text-ink">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        {tier < 3 && (
          <button
            type="button"
            onClick={() => setShowFolders((v) => !v)}
            aria-pressed={showFolders}
            aria-label="Folders"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-card text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}
          >
            <Icon name="menu" />
          </button>
        )}
        <SearchBox
          key={q}
          inputRef={searchRef}
          initial={q}
          scope={account === "all" ? "All accounts" : ACCOUNT_NAME[account]}
          showHints={tier > 1}
          onSubmit={(v) => setParams({ q: v || null, m: null })}
        />
        {tier > 1 && <span className="flex-1" />}
        {tier > 1 && (
          <div role="group" aria-label="Row density" className="inline-flex shrink-0 rounded-card border border-line bg-surface-1 p-0.5">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                onClick={() => setDensity(d)}
                className={`rounded-[8px] px-2 py-0.5 ui-meta capitalize ${density === d ? "bg-surface-3 text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "hover:text-ink"} ${FOCUS}`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="relative flex min-h-0 flex-1">
        {tier === 3 && <div className="min-h-0 w-[232px] shrink-0 overflow-y-auto border-r border-line">{foldersPane}</div>}
        {tier < 3 && showFolders && (
          <>
            <button type="button" aria-label="Close folders" className="absolute inset-0 z-30 bg-black/45" onClick={() => setShowFolders(false)} />
            <div className="absolute inset-y-0 left-0 z-40 w-[264px] max-w-[85%] overflow-y-auto border-r border-line-strong bg-surface-0 shadow-xl shadow-black/50">
              {foldersPane}
            </div>
          </>
        )}
        {showList && (
          <div className={`flex min-h-0 min-w-0 flex-col ${tier === 1 ? "flex-1" : `${tier === 3 ? listWidth : "w-[360px]"} shrink-0 border-r border-line`}`}>{listPane}</div>
        )}
        {showReading && <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{readPane}</div>}
      </div>
      {selecting && selectedRows.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-[12px] border border-line-strong bg-surface-3 py-1.5 pl-3.5 pr-1.5 shadow-xl shadow-black/50">
            <span className="mr-2 ui-row font-semibold tabular-nums text-ink">{selectedRows.length} selected</span>
            <ActionBar
              label="Bulk actions"
              targets={selectedRows}
              onAct={(a) => {
                void doAct(selectedRows, a);
                endSelect();
              }}
              folder={folder}
              folders={folderList}
              tags={tagsBy}
              up
            />
            <button type="button" onClick={endSelect} className={`ml-1 rounded-card px-2.5 py-1 ui-row text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-b-2 border-line-strong bg-surface-1 px-1 font-mono text-[10.5px] leading-none text-ink-muted">{children}</kbd>
  );
}

function KeyHint({ k, label }: { k: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {k.map((x) => (
        <Kbd key={x}>{x}</Kbd>
      ))}
      {label}
    </span>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 ui-meta ${
        on
          ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-ink"
          : "border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink"
      } ${FOCUS}`}
    >
      {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex gap-3 border-b border-line px-4 py-3">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-2" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
            <span className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
          </span>
        </div>
      ))}
    </div>
  );
}

function MessageRow({
  r,
  groupLabel,
  groupCount,
  opened,
  compact,
  selecting,
  picked,
  items,
  tags,
  onOpen,
  onPick,
  onAct,
  onTask,
}: {
  r: MessageSummary;
  groupLabel: string | null;
  groupCount: number;
  opened: boolean;
  compact: boolean;
  selecting: boolean;
  picked: boolean;
  items: LinkedItem[];
  tags: MailTag[];
  onOpen: () => void;
  onPick: () => void;
  onAct: (a: MailAction) => void;
  onTask: () => void;
}) {
  const key = rowKey(r);
  const subject = r.subject || "(no subject)";
  const strong = r.read ? "text-ink-muted" : "font-semibold text-ink";
  const linkChips = LINK_TYPES.map((t) => ({ t, xs: items.filter((i) => i.type === t) })).filter((g) => g.xs.length);
  const chipRow = (
    <>
      {linkChips.map(({ t, xs }) => (
        <span
          key={t}
          title={`${TYPE_CAP[t]} in Ledgr: ${xs.map((x) => x.title || "(untitled)").join("; ")}`}
          className={`inline-flex shrink-0 items-center gap-1 rounded-[5px] border px-1 text-[11px] leading-[17px] ${TYPE_TONE[t]} ${xs.every(isDone) ? "line-through opacity-60" : ""}`}
        >
          <Icon name={t} size={12} />
          {/* Compact keeps only the icon so the subject keeps the room. */}
          {!compact && TYPE_CAP[t]}
          {xs.length > 1 && <span className="tabular-nums">{xs.length}</span>}
        </span>
      ))}
      {!compact &&
        tags.slice(0, 2).map((t) => (
          <span key={t.id} className="inline-flex max-w-[9rem] shrink-0 items-center gap-1 text-[11px] text-ink-subtle">
            <TagDot color={t.color} />
            <span className="truncate">{t.name}</span>
          </span>
        ))}
      {!compact && tags.length > 2 && <span className="text-[11px] text-ink-subtle">+{tags.length - 2}</span>}
    </>
  );
  const icons = (
    <>
      {r.flagged && <Icon name="flag" size={14} filled className="text-amber-500" />}
      {r.hasAttachments && <Icon name="clip" size={14} className="text-ink-subtle" />}
    </>
  );
  const time = <span className={`shrink-0 text-xs tabular-nums ${r.read ? "text-ink-subtle" : "font-medium text-[var(--accent)]"}`}>{shortTime(r.receivedAt)}</span>;

  return (
    <>
      {groupLabel && (
        <li
          role="presentation"
          className="sticky top-0 z-10 flex justify-between border-b border-line bg-surface-0/90 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle backdrop-blur"
        >
          <span>{groupLabel}</span>
          <span className="tabular-nums">{groupCount}</span>
        </li>
      )}
      <li
        id={`mail-row-${key}`}
        role="option"
        aria-selected={selecting ? picked : opened}
        className={`group/row relative flex items-stretch border-b border-line ${
          opened ? "bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface-1))] shadow-[inset_3px_0_0_var(--accent)]" : picked ? "bg-surface-2" : "hover:bg-surface-1"
        }`}
      >
        <span aria-hidden className={`ml-1.5 w-1.5 shrink-0 self-start rounded-full ${compact ? "mt-[15px] h-1.5" : "mt-[22px] h-1.5"} ${r.read ? "" : "bg-[var(--accent)]"}`} />
        {!compact && (
          <button
            type="button"
            onClick={onPick}
            aria-pressed={picked}
            aria-label={`Select message from ${who(r.from)}: ${subject}`}
            className={`relative ml-1.5 mt-2.5 h-[34px] w-[34px] shrink-0 self-start rounded-full ${FOCUS}`}
          >
            {selecting || picked ? (
              <span
                className={`grid h-full w-full place-items-center rounded-full border-[1.5px] ${picked ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-line-strong bg-surface-2"}`}
              >
                {picked && <Icon name="check" size={16} />}
              </span>
            ) : (
              <Avatar from={r.from} account={r.account} />
            )}
          </button>
        )}
        {compact && selecting && (
          <button type="button" onClick={onPick} aria-pressed={picked} aria-label={`Select message from ${who(r.from)}: ${subject}`} className={`ml-2 self-center ${FOCUS}`}>
            <span className={`grid h-4 w-4 place-items-center rounded border ${picked ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-line-strong"}`}>
              {picked && <Icon name="check" size={12} />}
            </span>
          </button>
        )}
        <button type="button" onClick={onOpen} className={`min-w-0 flex-1 text-left ${compact ? "px-2 py-1.5" : "py-2 pl-2.5 pr-3"} ${FOCUS}`}>
          {compact ? (
            // Compact: the subject gets the room. The sender is a fixed column,
            // the preview only fills what the subject leaves over.
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${ACCOUNT_DOT[r.account]}`} />
              <span className={`w-28 shrink-0 truncate ui-row ${strong}`}>{who(r.from)}</span>
              <span title={subject} className={`min-w-0 shrink truncate ui-row ${r.read ? "text-ink" : "font-semibold text-ink"}`}>
                {subject}
              </span>
              <span className="min-w-0 flex-1 basis-0 truncate ui-meta">{r.preview}</span>
              {chipRow}
              {icons}
              {time}
            </span>
          ) : (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`min-w-0 flex-1 truncate ui-row ${strong}`}>{who(r.from)}</span>
                {icons}
                {time}
              </span>
              <span title={subject} className={`truncate ui-row ${r.read ? "text-ink-muted" : "font-medium text-ink"}`}>
                {subject}
              </span>
              <span className="truncate text-[12.5px] text-ink-subtle">{r.preview}</span>
              {(linkChips.length > 0 || tags.length > 0) && <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">{chipRow}</span>}
            </span>
          )}
        </button>
        {!selecting && (
          <span
            role="toolbar"
            aria-label="Quick actions"
            className="absolute right-2 top-1.5 z-10 hidden gap-0.5 rounded-card border border-line-strong bg-surface-3 p-0.5 shadow-lg shadow-black/40 [@media(hover:hover)]:group-hover/row:flex [@media(hover:hover)]:group-focus-within/row:flex"
          >
            <QuickBtn icon="archive" label="Archive" onClick={() => onAct({ kind: "archive" })} />
            <QuickBtn icon="trash" label="Delete" onClick={() => onAct({ kind: "trash" })} />
            <QuickBtn icon={r.read ? "mail" : "mailOpen"} label={r.read ? "Mark unread" : "Mark read"} onClick={() => onAct({ kind: "read", value: !r.read })} />
            <QuickBtn icon="flag" label={r.flagged ? "Unflag" : "Flag"} onClick={() => onAct({ kind: "flag", value: !r.flagged })} />
            <QuickBtn icon="task" label="Make task" onClick={onTask} />
          </span>
        )}
      </li>
    </>
  );
}

function QuickBtn({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-[6px] text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}
    >
      <Icon name={icon} />
    </button>
  );
}

const SEARCH_HELP: [string, string][] = [
  ["from:dana", "From a person or address"],
  ["to:me", "Sent to someone"],
  ['subject:"fall budget"', "Words in the subject"],
  ['"exact phrase"', "Those words, in order"],
  ["-pizza", "Leave out a word"],
  ["has:attachment", "Has files"],
  ["filename:pdf", "A file's name or type"],
  ["is:unread  is:flagged", "Read and flag state"],
  ["after:2026-10-01", "On or after a date (also before:)"],
  ["in:sent", "Only one folder (inbox, sent, archive, trash…)"],
];

function SearchBox({
  inputRef,
  initial,
  scope,
  showHints,
  onSubmit,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  initial: string;
  scope: string;
  showHints: boolean;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  const [help, setHelp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!help) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setHelp(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [help]);
  return (
    <div ref={wrap} className="relative min-w-0 max-w-[640px] flex-1">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setHelp(false);
          onSubmit(v.trim());
        }}
        className="flex h-8 items-center gap-2 rounded-card border border-line bg-surface-1 pl-2.5 pr-1 text-ink-subtle focus-within:border-line-strong"
      >
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          value={v}
          aria-label="Search mail"
          placeholder="Search mail, people, files"
          onChange={(e) => setV(e.target.value)}
          onFocus={() => setHelp(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setHelp(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent ui-row text-ink outline-none placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {v && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setV("");
              onSubmit("");
            }}
            className="grid h-6 w-6 place-items-center rounded text-ink-subtle hover:text-ink"
          >
            <Icon name="x" size={14} />
          </button>
        )}
        {showHints && <span className="shrink-0 rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-ink-muted">{scope}</span>}
        {showHints && !v && <Kbd>/</Kbd>}
      </form>
      {help && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-[min(420px,calc(100vw-24px))] rounded-card border border-line-strong bg-surface-3 p-3 shadow-xl shadow-black/50">
          <p className="mb-2 ui-meta">
            Press Enter to search. Words search all folders of {scope === "All accounts" ? "both accounts" : scope}. These narrow it:
          </p>
          <ul className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {SEARCH_HELP.map(([op, what]) => (
              <li key={op} className="contents">
                <button
                  type="button"
                  onClick={() => {
                    const next = `${v.trim()} ${op.split("  ")[0]}`.trim();
                    setV(op.endsWith(":") ? next : `${next} `);
                    inputRef.current?.focus();
                  }}
                  className="justify-self-start rounded bg-surface-1 px-1.5 font-mono text-[12px] text-ink hover:bg-surface-2"
                >
                  {op}
                </button>
                <span className="ui-meta self-center">{what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TagDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-[3px] ${color ? "" : "bg-ink-faint"}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

// An icon button with the app's CSS hover tooltip and its shortcut.
function ToolBtn({ icon, label, keys, onClick, up }: { icon: IconName; label: string; keys?: string; onClick: () => void; up?: boolean }) {
  return (
    <span className="group relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`grid h-8 w-8 place-items-center rounded-card text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}
      >
        <Icon name={icon} />
      </button>
      <span role="tooltip" className={`${TIP_PANEL} left-1/2 -translate-x-1/2 ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
        {label} {keys && <Kbd>{keys}</Kbd>}
      </span>
    </span>
  );
}

// The actions for one message or a selection. Move and Tags need a single account.
function ActionBar({
  label,
  targets,
  onAct,
  folder,
  folders,
  tags,
  up,
}: {
  label: string;
  targets: MessageSummary[];
  onAct: (a: MailAction) => void;
  folder: string | undefined;
  folders: MailFolder[] | null;
  tags: Partial<Record<AccountId, MailTag[]>>;
  up?: boolean;
}) {
  const accts = [...new Set(targets.map((t) => t.account))];
  const single = accts.length === 1 ? accts[0] : null;
  const allRead = targets.every((t) => t.read);
  const allFlagged = targets.every((t) => t.flagged);
  const preloaded = single && folders && folders.length && folders[0].account === single ? folders : undefined;
  return (
    <div role="toolbar" aria-label={label} className="flex items-center gap-0.5">
      <ToolBtn icon="archive" label="Archive" keys="⌫" up={up} onClick={() => onAct({ kind: "archive" })} />
      <ToolBtn icon="trash" label="Delete" keys="Del" up={up} onClick={() => onAct({ kind: "trash" })} />
      <Popover icon="move" label="Move to folder" up={up} disabledTip={single ? undefined : MULTI_TIP}>
        {(close) =>
          single && (
            <MovePicker
              account={single}
              current={folder}
              preloaded={preloaded}
              onPick={(folderId) => {
                close();
                onAct({ kind: "move", folderId });
              }}
            />
          )
        }
      </Popover>
      <Popover icon="tag" label="Tags" up={up} disabledTip={single ? undefined : MULTI_TIP}>
        {(close) =>
          single && (
            <TagPicker
              targets={targets}
              tags={tags[single]}
              onApply={(add, remove) => {
                close();
                onAct({ kind: "tags", add, remove });
              }}
            />
          )
        }
      </Popover>
      <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />
      <ToolBtn icon={allRead ? "mail" : "mailOpen"} label={allRead ? "Mark unread" : "Mark read"} keys="U" up={up} onClick={() => onAct({ kind: "read", value: !allRead })} />
      <ToolBtn icon="flag" label={allFlagged ? "Unflag" : "Flag"} keys="S" up={up} onClick={() => onAct({ kind: "flag", value: !allFlagged })} />
    </div>
  );
}

// An icon button that opens a small panel; closes on Esc and outside click.
// With `disabledTip` it is a disabled button with a CSS hover tooltip (the app standard).
function Popover({
  icon,
  label,
  disabledTip,
  up,
  children,
}: {
  icon: IconName;
  label: string;
  disabledTip?: string;
  up?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const side = up ? "bottom-full mb-1.5" : "top-full mt-1.5";
  if (disabledTip) {
    return (
      <span className="group relative cursor-help">
        <button type="button" disabled aria-label={label} className="grid h-8 w-8 place-items-center rounded-card text-ink-faint">
          <Icon name={icon} />
        </button>
        <span role="tooltip" className={`${TIP_PANEL} left-0 ${side} w-56 whitespace-normal`}>
          {disabledTip}
        </span>
      </span>
    );
  }
  return (
    <div ref={ref} className="group relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={`grid h-8 w-8 place-items-center rounded-card hover:bg-surface-2 hover:text-ink ${open ? "bg-surface-2 text-ink" : "text-ink-muted"} ${FOCUS}`}
      >
        <Icon name={icon} />
      </button>
      {!open && (
        <span role="tooltip" className={`${TIP_PANEL} left-1/2 -translate-x-1/2 ${side}`}>
          {label}
        </span>
      )}
      {open && (
        <div className={`absolute left-0 z-40 ${side} min-w-48 max-w-72 rounded-card border border-line-strong bg-surface-3 shadow-xl shadow-black/50`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MovePicker({
  account,
  current,
  preloaded,
  onPick,
}: {
  account: AccountId;
  current: string | undefined;
  preloaded: MailFolder[] | undefined;
  onPick: (folderId: string) => void;
}) {
  const [fetched, setFetched] = useState<MailFolder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (preloaded) return;
    const ac = new AbortController();
    getJson<{ folders: MailFolder[] }>({ view: "folders", account }, ac.signal)
      .then((d) => setFetched(d.folders))
      .catch((e) => {
        if (!ac.signal.aborted) setErr(msg(e));
      });
    return () => ac.abort();
  }, [account, preloaded]);
  // `current` is a folder id, or a role name in the combined view.
  const list = (preloaded ?? fetched)
    ?.filter((f) => f.id !== current && f.role !== current)
    .filter((f) => !filter || (f.role ? ROLE_LABEL[f.role] : f.name).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="py-1">
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && list?.length) onPick(list[0].id);
        }}
        placeholder="Find a folder"
        aria-label="Find a folder"
        className="mx-2 mb-1 w-[calc(100%-1rem)] rounded border border-line bg-surface-1 px-2 py-1 ui-row text-ink outline-none placeholder:text-ink-subtle"
      />
      <div className="max-h-64 overflow-y-auto">
        {err && <p className="px-3 py-1 ui-meta text-ink-muted">{err}</p>}
        {!list && !err && <p className="px-3 py-1 ui-meta text-ink-muted">Loading…</p>}
        {list && list.length === 0 && <p className="px-3 py-1 ui-meta text-ink-muted">No other folders</p>}
        <ul role="menu">
          {list?.map((f) => (
            <li key={f.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onPick(f.id)}
                className="flex w-full items-center gap-2 truncate px-3 py-1.5 text-left ui-row text-ink hover:bg-surface-2"
              >
                <Icon name={f.role ? ROLE_ICON[f.role] : "folder"} size={14} className="text-ink-subtle" />
                <span className="truncate">{f.role ? ROLE_LABEL[f.role] : f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type TagState = "all" | "some" | "none";

function TagPicker({
  targets,
  tags,
  onApply,
}: {
  targets: MessageSummary[];
  tags: MailTag[] | undefined;
  onApply: (add: string[], remove: string[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, TagState>>({});
  const initial = (t: MailTag): TagState => {
    const n = targets.filter((r) => r.tags.includes(t.id)).length;
    return n === targets.length ? "all" : n ? "some" : "none";
  };
  const now = (t: MailTag) => draft[t.id] ?? initial(t);
  const add = (tags ?? []).filter((t) => now(t) === "all" && initial(t) !== "all").map((t) => t.id);
  const remove = (tags ?? []).filter((t) => now(t) === "none" && initial(t) !== "none").map((t) => t.id);
  return (
    <div className="py-1">
      {!tags && <p className="px-3 py-1 ui-meta text-ink-muted">Loading…</p>}
      {tags?.length === 0 && <p className="px-3 py-1 ui-meta text-ink-muted">No tags available</p>}
      <ul className="max-h-64 overflow-y-auto">
        {tags?.map((t) => {
          const st = now(t);
          return (
            <li key={t.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={st === "all" ? true : st === "some" ? "mixed" : false}
                onClick={() => setDraft((d) => ({ ...d, [t.id]: st === "all" ? "none" : "all" }))}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left ui-row text-ink hover:bg-surface-2"
              >
                <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line-strong ui-meta">
                  {st === "all" ? "✓" : st === "some" ? "–" : ""}
                </span>
                <TagDot color={t.color} />
                <span className="truncate">{t.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line p-2">
        <button type="button" disabled={!add.length && !remove.length} onClick={() => onApply(add, remove)} className={`${BTN} w-full`}>
          Apply
        </button>
      </div>
    </div>
  );
}

function Notice({ text, slim, onRetry }: { text: string; slim?: boolean; onRetry?: () => void }) {
  return (
    <p
      role="alert"
      className={`flex items-center gap-3 border-b border-line bg-surface-2 ui-meta text-ink-muted ${slim ? "px-3 py-1.5" : "m-4 rounded-card border px-3 py-2"}`}
    >
      <span className="min-w-0 flex-1">{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-ink underline">
          Try again
        </button>
      )}
    </p>
  );
}

function FolderPane({
  options,
  account,
  folder,
  ordered,
  error,
  loading,
  tags,
  tagCounts,
  tagFilter,
  onAccount,
  onPick,
  onTag,
}: {
  options: AccountView[];
  account: AccountView;
  folder: string | undefined;
  ordered: { f: MailFolder; depth: number }[];
  error: string | null;
  loading: boolean;
  tags: MailTag[];
  tagCounts: MessageSummary[];
  tagFilter: string | null;
  onAccount: (a: AccountView) => void;
  onPick: (id: string) => void;
  onTag: (id: string) => void;
}) {
  // Tags are tucked away by default; the owner opens them when wanted.
  const [tagsOpen, setTagsOpen] = usePref<"open" | "closed">("ledgr.mail.tags", "closed");
  const items =
    account === "all"
      ? ROLES.map((r) => ({ id: r as string, name: ROLE_LABEL[r], icon: ROLE_ICON[r], depth: 0, unread: 0, role: r as string | null }))
      : ordered.map(({ f, depth }) => ({
          id: f.id,
          name: f.role ? ROLE_LABEL[f.role] : f.name,
          icon: f.role ? ROLE_ICON[f.role] : ("folder" as IconName),
          depth,
          unread: f.unread,
          role: f.role,
        }));
  const system = items.filter((i) => i.role);
  const custom = items.filter((i) => !i.role);
  const item = (it: (typeof items)[number]) => {
    const on = it.id === folder;
    return (
      <li key={it.id}>
        <button
          type="button"
          onClick={() => onPick(it.id)}
          aria-current={on ? "true" : undefined}
          style={{ paddingLeft: 8 + it.depth * 14 }}
          className={`flex h-[30px] w-full items-center gap-2.5 rounded-[8px] pr-2 text-left ui-row ${on ? "bg-surface-2 font-medium text-ink" : "text-ink-muted hover:bg-surface-1 hover:text-ink"} ${FOCUS}`}
        >
          <Icon name={it.icon} className={on ? "text-[var(--accent)]" : ""} />
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
          {it.unread > 0 &&
            (it.role === "inbox" ? (
              <span className="min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11.5px] font-semibold tabular-nums text-white">{badgeCount(it.unread)}</span>
            ) : (
              <span className="text-[11.5px] tabular-nums text-ink-subtle">{badgeCount(it.unread)}</span>
            ))}
        </button>
      </li>
    );
  };
  return (
    <nav aria-label="Folders" className="px-2 py-2.5">
      {options.length > 1 && (
        <div role="group" aria-label="Account" className="mb-2 grid auto-cols-fr grid-flow-col gap-0.5 rounded-card border border-line bg-surface-1 p-0.5">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === account}
              onClick={() => onAccount(o)}
              className={`flex h-7 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] ${
                o === account ? "bg-surface-3 text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-subtle hover:text-ink"
              } ${FOCUS}`}
            >
              {o === "all" ? (
                <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[conic-gradient(var(--color-sky-500)_0_50%,var(--color-rose-500)_0)]" />
              ) : (
                <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${ACCOUNT_DOT[o]}`} />
              )}
              {o === "all" ? "All" : ACCOUNT_NAME[o]}
            </button>
          ))}
        </div>
      )}
      {error && <Notice text={error} slim />}
      {loading && <p className="px-2 py-1 ui-meta">Loading folders…</p>}
      <ul className="flex flex-col gap-px">{system.map(item)}</ul>
      {custom.length > 0 && (
        <>
          <div className={SECTION}>Folders</div>
          <ul className="flex flex-col gap-px">{custom.map(item)}</ul>
        </>
      )}
      {account === "all" && <p className="px-2 pt-2 text-[11.5px] text-ink-subtle">Pick one account to see its own folders.</p>}
      {tags.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={tagsOpen === "open"}
            onClick={() => setTagsOpen(tagsOpen === "open" ? "closed" : "open")}
            className={`flex w-full items-center gap-1 ${SECTION} hover:text-ink ${FOCUS}`}
          >
            <Icon name={tagsOpen === "open" ? "down" : "right"} size={12} />
            Tags
            <span className="ml-auto font-normal normal-case tracking-normal tabular-nums">{tags.length}</span>
          </button>
          {tagsOpen === "open" && (
            <ul className="flex flex-col gap-px">
              {tags.map((t) => {
                const n = tagCounts.filter((r) => r.account === t.account && r.tags.includes(t.id)).length;
                const on = tagFilter === t.id;
                return (
                  <li key={`${t.account}:${t.id}`}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onTag(t.id)}
                      title="Show the messages on screen with this tag"
                      className={`flex h-[28px] w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[13px] ${on ? "bg-surface-2 text-ink" : "text-ink-muted hover:bg-surface-1 hover:text-ink"} ${FOCUS}`}
                    >
                      <span className="grid w-4 place-items-center">
                        <TagDot color={t.color} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      {n > 0 && <span className="text-[11.5px] tabular-nums text-ink-subtle">{n}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </nav>
  );
}

function ReadingPane({
  selection,
  rows,
  links,
  creating,
  onLoaded,
  onImport,
  onBack,
  toolbar,
  notice,
}: {
  selection: string | null;
  rows: MessageSummary[];
  links: Record<string, LinkedItem[]>;
  creating: Set<string>;
  onLoaded: (ms: { id: string; internetMessageId: string | null }[]) => void;
  onImport: (message: FullMessage, attachmentIds?: string[]) => void;
  onBack?: () => void;
  toolbar?: React.ReactNode;
  notice?: React.ReactNode;
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
        } catch (e2) {
          const gone = (e as { status?: number }).status === 404 || (e2 as { status?: number }).status === 404;
          setError({ key: selection, text: gone ? GONE : msg(e) });
          return;
        }
      }
      if (ac.signal.aborted) return;
      setError(null);
      setThread({ key: selection, messages });
      onLoaded(messages);
      setExpanded(new Set(messages.length ? [messages[messages.length - 1].id] : []));
    })();
    return () => ac.abort();
  }, [selection, onLoaded]);

  if (!selection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center ui-meta">
        <Icon name="mail" size={28} className="text-ink-faint" />
        <span className="ui-row text-ink-muted">No message open</span>
        <span>
          Pick one from the list, or press <Kbd>J</Kbd>.
        </span>
      </div>
    );
  }
  const current = thread?.key === selection ? thread.messages : null;
  const err = error?.key === selection ? error.text : null;
  const first = current?.[0];
  const subject = first?.subject || "(no subject)";
  const threadItems = current
    ? [...new Map(current.flatMap((x) => links[x.id] ?? []).map((i) => [i.id, i])).values()]
    : [];
  // Earlier messages beyond the first two fold into "N more", as Gmail does.
  const hiddenFrom = current && current.length > 4 && !expanded.has("*") ? 1 : -1;
  const hiddenCount = hiddenFrom > 0 && current ? current.length - 3 : 0;

  return (
    <article className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-line bg-surface-0/95 px-3 py-1.5 backdrop-blur">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back to list" className={`grid h-8 w-8 place-items-center rounded-card text-ink-muted hover:bg-surface-2 ${FOCUS}`}>
            <Icon name="back" />
          </button>
        )}
        {toolbar}
      </div>
      {notice}
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3.5 px-4 pb-12 pt-5 md:px-6">
        {err && <Notice text={err} />}
        {!current && !err && (
          <div aria-hidden className="flex flex-col gap-3">
            <span className="h-6 w-2/3 animate-pulse rounded bg-surface-2" />
            <span className="h-24 animate-pulse rounded-card bg-surface-1" />
            <span className="h-64 animate-pulse rounded-card bg-surface-1" />
          </div>
        )}
        {current && first && (
          <>
            <header className="flex flex-col gap-2">
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink [text-wrap:balance]">{subject}</h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill>
                  <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${ACCOUNT_DOT[first.account]}`} />
                  {ACCOUNT_NAME[first.account]}
                </Pill>
                {current.length > 1 && <Pill>{current.length} messages</Pill>}
                {current.some((x) => x.flagged) && (
                  <Pill>
                    <Icon name="flag" size={12} filled className="text-amber-500" />
                    Flagged
                  </Pill>
                )}
              </div>
            </header>
            <InLedgrPanel items={threadItems} />
            <div className="flex flex-col overflow-hidden rounded-card border border-line">
              {current.map((message, idx) => {
                const isLast = idx === current.length - 1;
                if (hiddenFrom > 0 && idx >= hiddenFrom && idx < hiddenFrom + hiddenCount) {
                  if (idx !== hiddenFrom) return null;
                  return (
                    <button
                      key="more"
                      type="button"
                      onClick={() => setExpanded((s) => new Set(s).add("*"))}
                      className="flex w-full items-center gap-3 border-t border-line bg-surface-1 px-3 py-1.5 ui-meta text-ink-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <span className="h-px flex-1 bg-line-strong" />
                      {hiddenCount} more
                      <span className="h-px flex-1 bg-line-strong" />
                    </button>
                  );
                }
                const isOpen = isLast || expanded.has(message.id);
                return isOpen ? (
                  <MessageView
                    key={message.id}
                    message={message}
                    items={links[message.id] ?? []}
                    creating={creating}
                    onImport={onImport}
                    divider={idx > 0}
                  />
                ) : (
                  <button
                    key={message.id}
                    type="button"
                    aria-expanded={false}
                    onClick={() => setExpanded((s) => new Set(s).add(message.id))}
                    className={`grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 bg-surface-1 px-3 py-2 text-left hover:bg-surface-2 ${idx > 0 ? "border-t border-line" : ""} ${FOCUS}`}
                  >
                    <Avatar from={message.from} size={30} />
                    <span className="flex min-w-0 items-baseline gap-2.5">
                      <span className="shrink-0 ui-row font-medium text-ink">{who(message.from)}</span>
                      <span className="min-w-0 truncate text-[12.5px] text-ink-subtle">{message.preview}</span>
                    </span>
                    <span className="ui-meta tabular-nums">{shortTime(message.receivedAt)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-muted">{children}</span>;
}

// What this conversation already is in Ledgr: the reason the module exists, so
// it sits above the mail rather than in a footer.
function InLedgrPanel({ items }: { items: LinkedItem[] }) {
  return (
    <section aria-label="In Ledgr" className="overflow-hidden rounded-card border border-line bg-surface-1">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
        <span aria-hidden className="h-3 w-3 rounded-[3px] bg-[var(--accent)]" />
        In Ledgr
        {items.length > 0 && <span className="ml-auto tabular-nums">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] text-ink-subtle">Nothing yet. Make a task, note or meeting from this email above, or import its files.</p>
      ) : (
        <ul>
          {items.map((i) => {
            const t = asType(i.type);
            const done = isDone(i);
            return (
              <li key={i.id} className="border-t border-line first:border-t-0">
                <Link href={`/items/${i.id}`} className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 hover:bg-surface-2 ${FOCUS}`}>
                  <Icon name={t ?? "note"} className={t ? TYPE_TEXT[t] : "text-ink-subtle"} />
                  <span className={`truncate ui-row ${done ? "text-ink-muted line-through" : "text-ink"}`}>{i.title || "(untitled)"}</span>
                  <span
                    className={`rounded-full px-2 text-[11px] font-medium ${
                      done ? "bg-emerald-500/15 text-emerald-500" : "bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]"
                    }`}
                  >
                    {done ? "Done" : t === "event" ? "Meeting" : t === "note" ? "Note" : "Open"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const FILE_TONE: [RegExp, string, string][] = [
  [/pdf/i, "PDF", "bg-red-600"],
  [/sheet|excel|csv/i, "XLS", "bg-green-600"],
  [/word|document/i, "DOC", "bg-blue-600"],
  [/presentation|powerpoint/i, "PPT", "bg-orange-600"],
  [/^image\//i, "IMG", "bg-violet-600"],
  [/zip|compressed/i, "ZIP", "bg-neutral-600"],
];
function fileBadge(contentType: string, name: string): [string, string] {
  for (const [re, label, tone] of FILE_TONE) if (re.test(contentType)) return [label, tone];
  const ext = name.split(".").pop()?.slice(0, 4).toUpperCase();
  return [ext && ext !== name.toUpperCase() ? ext : "FILE", "bg-neutral-600"];
}

function MessageView({
  message,
  items,
  creating,
  onImport,
  divider,
}: {
  message: FullMessage;
  items: LinkedItem[];
  creating: Set<string>;
  onImport: (message: FullMessage, attachmentIds?: string[]) => void;
  divider: boolean;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  async function save(attachmentId: string, item: LinkedItem) {
    setSaveError(null);
    setSaving(attachmentId);
    try {
      await linkPost({ op: "attach", account: message.account, messageId: message.id, attachmentId, itemId: item.id });
      showToast(`Saved to ${item.title || "item"}`);
    } catch (e) {
      setSaveError(msg(e));
    } finally {
      setSaving(null);
    }
  }
  const files = message.attachments.filter((a) => !a.inline);
  const provider = ACCOUNT_NAME[message.account];
  const recipients = [...message.to, ...message.cc];
  const toLine = recipients.length
    ? recipients
        .slice(0, 3)
        .map((a) => a.name || a.email)
        .join(", ") + (recipients.length > 3 ? ` +${recipients.length - 3}` : "")
    : "undisclosed recipients";
  const importingAll = creating.has(`${message.id}:import:all`);
  return (
    <div className={`flex flex-col gap-3 bg-surface-0 p-3.5 ${divider ? "border-t border-line" : ""}`}>
      <div className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-start gap-3">
        <Avatar from={message.from} size={38} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="ui-row font-semibold text-ink">{who(message.from)}</span>
            {message.from?.name && <span className="text-[12.5px] text-ink-subtle">{message.from.email}</span>}
          </div>
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((v) => !v)}
            className={`mt-0.5 flex max-w-full items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink ${FOCUS}`}
          >
            <span className="truncate">to {toLine}</span>
            <Icon name="down" size={13} className={details ? "rotate-180" : ""} />
          </button>
          {details && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-[8px] border border-line bg-surface-1 px-2.5 py-2 text-[12.5px]">
              <dt className="text-ink-subtle">From</dt>
              <dd className="min-w-0 break-words text-ink">{message.from ? addr(message.from) : "Unknown sender"}</dd>
              {message.to.length > 0 && (
                <>
                  <dt className="text-ink-subtle">To</dt>
                  <dd className="min-w-0 break-words text-ink-muted">{message.to.map(addr).join(", ")}</dd>
                </>
              )}
              {message.cc.length > 0 && (
                <>
                  <dt className="text-ink-subtle">Cc</dt>
                  <dd className="min-w-0 break-words text-ink-muted">{message.cc.map(addr).join(", ")}</dd>
                </>
              )}
              <dt className="text-ink-subtle">Date</dt>
              <dd className="text-ink-muted">{fullTime(message.receivedAt)}</dd>
            </dl>
          )}
        </div>
        <div className="text-right text-xs tabular-nums text-ink-subtle">
          <div className="text-[12.5px] font-medium text-ink-muted">{shortTime(message.receivedAt)}</div>
          {ago(message.receivedAt)}
        </div>
      </div>
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {files.map((a) => {
              const [badge, tone] = fileBadge(a.contentType, a.name);
              const importing = creating.has(`${message.id}:import:${a.id}`);
              return (
                <div
                  key={a.id}
                  className="grid w-[300px] max-w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-card border border-line bg-surface-1 py-1.5 pl-2 pr-1"
                >
                  <span className={`grid h-9 w-8 place-items-center rounded-[5px] font-mono text-[9px] font-semibold tracking-wide text-white ${tone}`}>{badge}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink" title={a.name}>
                      {a.name}
                    </span>
                    <span className="block text-[11.5px] text-ink-subtle">{formatBytes(a.size)}</span>
                  </span>
                  <span className="flex items-center">
                    <span className="group relative">
                      <button
                        type="button"
                        aria-label={`Import ${a.name} to Ledgr`}
                        disabled={importing}
                        onClick={() => onImport(message, [a.id])}
                        className={`grid h-7 w-7 place-items-center rounded-[6px] text-[var(--accent)] hover:bg-surface-2 disabled:opacity-50 ${FOCUS}`}
                      >
                        <Icon name="import" />
                      </button>
                      <span role="tooltip" className={`${TIP_PANEL} right-0 top-full mt-1.5`}>
                        Import to Ledgr as a new note
                      </span>
                    </span>
                    {items.length > 0 && (
                      <SaveToItem items={items} busy={saving === a.id} onSave={(item) => void save(a.id, item)} />
                    )}
                    <span className="group relative">
                      <a
                        href={`/api/mail/attachment?account=${message.account}&message=${encodeURIComponent(message.id)}&id=${encodeURIComponent(a.id)}`}
                        aria-label={`Download ${a.name}`}
                        className={`grid h-7 w-7 place-items-center rounded-[6px] text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}
                      >
                        <Icon name="download" />
                      </a>
                      <span role="tooltip" className={`${TIP_PANEL} right-0 top-full mt-1.5`}>
                        Download
                      </span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          {files.length > 1 && (
            <button
              type="button"
              disabled={importingAll}
              onClick={() => onImport(message)}
              className={`inline-flex items-center gap-1.5 self-start rounded-card border border-line bg-surface-1 px-2.5 py-1 ui-meta text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50 ${FOCUS}`}
            >
              <Icon name="import" size={14} />
              {importingAll ? "Importing…" : `Import all ${files.length} files to Ledgr`}
            </button>
          )}
        </div>
      )}
      {saveError && <Notice text={saveError} slim />}
      <SafeMailBody html={message.bodyHtml} text={message.bodyText} />
      {message.webLink && (
        <a
          href={message.webLink}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 self-start rounded-card border border-line bg-surface-1 px-2.5 py-1 ui-meta text-ink-muted hover:bg-surface-2 hover:text-ink ${FOCUS}`}
        >
          <Icon name="ext" size={14} />
          Reply in {provider}
        </a>
      )}
    </div>
  );
}

// Add a file to an item the email is already linked to.
function SaveToItem({ items, busy, onSave }: { items: LinkedItem[]; busy: boolean; onSave: (item: LinkedItem) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  const label = items.length === 1 ? `Add to “${items[0].title || "item"}”` : "Add to a linked item";
  return (
    <span ref={ref} className="group relative">
      <button
        type="button"
        aria-label={label}
        disabled={busy}
        onClick={() => (items.length === 1 ? onSave(items[0]) : setOpen((v) => !v))}
        className={`grid h-7 w-7 place-items-center rounded-[6px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50 ${FOCUS}`}
      >
        <Icon name="link" />
      </button>
      {!open && (
        <span role="tooltip" className={`${TIP_PANEL} right-0 top-full mt-1.5`}>
          {label}
        </span>
      )}
      {open && (
        <ul role="menu" className="absolute right-0 top-full z-40 mt-1.5 max-h-64 min-w-56 overflow-y-auto rounded-card border border-line-strong bg-surface-3 py-1 shadow-xl shadow-black/50">
          {items.map((i) => {
            const t = asType(i.type);
            return (
              <li key={i.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSave(i);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left ui-row text-ink hover:bg-surface-2"
                >
                  <Icon name={t ?? "note"} size={14} className={t ? TYPE_TEXT[t] : ""} />
                  <span className="truncate">{i.title || "(untitled)"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}
