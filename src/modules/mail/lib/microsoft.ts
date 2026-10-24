// Microsoft side of the mail & calendar action list (types.ts): Graph behind
// MailProvider / CalendarProvider. Plain fetch over the shared Graph client, but
// ALWAYS with the mail module's own hub-only app registration (graph-auth.ts),
// never the shared GRAPH_* one. Graph shapes stop at this file.
import { graphFetch, GraphError, type GraphCredentials } from "@/modules/microsoft/lib/client";
import { getMailGraphConnection, getMailUpn } from "./graph-auth";
import {
  MailProviderError,
  type CalendarAttendee,
  type CalendarProvider,
  type EventInput,
  type FullMessage,
  type InlineImage,
  type ListMessagesQuery,
  type MailAddress,
  type MailAttachmentMeta,
  type MailCalendarEvent,
  type MailFolder,
  type MailProvider,
  type MailTag,
  type MessageChange,
  type MessagePage,
  type MessageSummary,
  type OutgoingMessage,
} from "./types";

const GRAPH = "https://graph.microsoft.com/";
const SUMMARY_SELECT =
  "id,conversationId,internetMessageId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments,categories,parentFolderId";
const FULL_SELECT = `${SUMMARY_SELECT},ccRecipients,bccRecipients,replyTo,body,webLink`;
const EVENT_SELECT =
  "id,subject,start,end,isAllDay,location,organizer,attendees,responseStatus,isOrganizer,onlineMeeting,seriesMasterId,bodyPreview,webLink";
const FOLDER_SELECT = "id,displayName,parentFolderId,childFolderCount,unreadItemCount";
const MAX_PAGES = 25;
const MAX_FOLDER_DEPTH = 5;

// Well-known folder names -> our roles.
const WELL_KNOWN: [string, NonNullable<MailFolder["role"]>][] = [
  ["inbox", "inbox"],
  ["sentitems", "sent"],
  ["drafts", "drafts"],
  ["deleteditems", "trash"],
  ["junkemail", "spam"],
  ["archive", "archive"],
];

// Outlook category presets -> CSS hex ("none" / unknown -> null).
const PRESET_COLORS = [
  "#e7a1a2", "#f9ba89", "#f7dd8f", "#fcfa90", "#78d168", "#9fdcc9", "#c6d2b0", "#9db7e8",
  "#b5a1e2", "#daaec2", "#dad9dc", "#6b7f8e", "#cfcfcf", "#7f7f7f", "#4d4d4d", "#e64a57",
  "#f5811f", "#e9b400", "#d4d600", "#37a826", "#0b9b7a", "#7a8c3c", "#2f6fcc", "#6e49b8",
  "#c43d86",
];

type GAddr = { emailAddress?: { name?: string; address?: string } } | undefined;
type GMessage = {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: GAddr;
  toRecipients?: GAddr[];
  ccRecipients?: GAddr[];
  bccRecipients?: GAddr[];
  replyTo?: GAddr[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  categories?: string[];
  parentFolderId?: string;
  body?: { contentType?: string; content?: string };
  webLink?: string;
};
type GDateTime = { dateTime?: string; timeZone?: string } | undefined;
type GEvent = {
  id: string;
  subject?: string;
  start?: GDateTime;
  end?: GDateTime;
  isAllDay?: boolean;
  location?: { displayName?: string };
  organizer?: GAddr;
  attendees?: (GAddr & { status?: { response?: string } })[];
  responseStatus?: { response?: string };
  isOrganizer?: boolean;
  onlineMeeting?: { joinUrl?: string };
  seriesMasterId?: string;
  bodyPreview?: string;
  webLink?: string;
};

function addr(a: GAddr): MailAddress | null {
  const email = a?.emailAddress?.address?.trim();
  if (!email) return null;
  return { name: a?.emailAddress?.name?.trim() || null, email };
}
const addrs = (l: GAddr[] | undefined): MailAddress[] =>
  (l ?? []).map(addr).filter((a): a is MailAddress => a !== null);
const recipients = (l: MailAddress[]) =>
  l.map((a) => ({ emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) } }));

function summary(m: GMessage): MessageSummary {
  return {
    id: m.id,
    account: "microsoft",
    threadId: m.conversationId ?? m.id,
    internetMessageId: m.internetMessageId ?? null,
    subject: m.subject ?? "",
    from: addr(m.from),
    to: addrs(m.toRecipients),
    receivedAt: m.receivedDateTime ?? null,
    preview: m.bodyPreview ?? "",
    read: m.isRead === true,
    flagged: m.flag?.flagStatus === "flagged",
    hasAttachments: m.hasAttachments === true,
    tags: m.categories ?? [],
    folderIds: m.parentFolderId ? [m.parentFolderId] : [],
  };
}

// Graph dateTime ("2026-06-20T15:00:00.0000000", zone UTC because we asked) -> ISO instant.
function instant(dt: GDateTime): string {
  const raw = dt?.dateTime ?? "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
// Our ISO instant -> Graph {dateTime, timeZone:"UTC"}.
const gdt = (iso: string) => ({ dateTime: new Date(iso).toISOString().slice(0, -1), timeZone: "UTC" });

function response(r: string | undefined): CalendarAttendee["response"] {
  if (r === "accepted" || r === "declined") return r;
  return r === "tentativelyAccepted" ? "tentative" : "none";
}

// Shared transport: ImmutableId on everything, the mail registration's token,
// and Graph failures surfaced as MailProviderError (with Graph's own message).
class GraphBase {
  constructor(
    protected upn: string,
    private creds: GraphCredentials,
    private prefer: string,
    // False while Outlook borrows Ledgr's shared connection, which must never send
    // mail or change the calendar: those rights live only in the hub-only app.
    private ownApp = true
  ) {}

  protected needOwnApp(what: string): void {
    if (!this.ownApp) {
      throw new MailProviderError(`${what} needs the Outlook mail app set up on this computer (runbook §1w)`, "not_configured");
    }
  }

  protected get base() {
    return `${GRAPH}v1.0/users/${encodeURIComponent(this.upn)}`;
  }

  protected async req(url: string, method = "GET", body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await graphFetch(
        url,
        {
          method,
          headers: {
            Prefer: this.prefer,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        this.creds
      );
    } catch (err) {
      if (err instanceof GraphError) throw new MailProviderError(err.message, err.kind, err.status);
      throw err;
    }
    if (!res.ok) {
      let detail = "";
      try {
        const b = (await res.json()) as { error?: { message?: string } };
        if (b.error?.message) detail = `: ${b.error.message}`;
      } catch {
        /* non-JSON */
      }
      throw new MailProviderError(`Graph ${method} ${res.status}${detail}`, "request", res.status);
    }
    return res;
  }

  protected async json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const url = path.startsWith(GRAPH) ? path : `${this.base}${path}`;
    return (await (await this.req(url, method, body)).json()) as T;
  }

  // Calls whose reply we ignore (PATCH/DELETE/move/send return little or nothing).
  protected async send(path: string, method: string, body?: unknown): Promise<void> {
    await this.req(`${this.base}${path}`, method, body);
  }
}

const mid = (id: string) => encodeURIComponent(id);

export class GraphMailProvider extends GraphBase implements MailProvider {
  readonly account = "microsoft" as const;

  constructor(upn: string, creds: GraphCredentials, ownApp = true) {
    super(upn, creds, 'IdType="ImmutableId"', ownApp);
  }

  async listFolders(): Promise<MailFolder[]> {
    const [roles, tops] = await Promise.all([this.roleIds(), this.folderPage("/mailFolders")]);
    const out: MailFolder[] = [];
    const walk = async (list: GFolder[], parentId: string | null, depth: number) => {
      for (const f of list) {
        out.push({
          id: f.id,
          account: "microsoft",
          name: f.displayName,
          role: roles.get(f.id) ?? null,
          parentId,
          unread: f.unreadItemCount ?? 0,
        });
        if ((f.childFolderCount ?? 0) > 0 && depth < MAX_FOLDER_DEPTH) {
          await walk(await this.folderPage(`/mailFolders/${mid(f.id)}/childFolders`), f.id, depth + 1);
        }
      }
    };
    await walk(tops, null, 1);
    return out;
  }

  private async folderPage(path: string): Promise<GFolder[]> {
    const all: GFolder[] = [];
    let url: string | null = `${this.base}${path}?$top=100&$select=${FOLDER_SELECT}`;
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const d: { value?: GFolder[]; "@odata.nextLink"?: string } = await this.json(url);
      all.push(...(d.value ?? []));
      url = d["@odata.nextLink"] ?? null;
    }
    return all;
  }

  // id -> role for the six well-known folders; a missing one (no Archive yet) is fine.
  private async roleIds(): Promise<Map<string, NonNullable<MailFolder["role"]>>> {
    const found = await Promise.all(
      WELL_KNOWN.map(async ([name, role]) => {
        try {
          const f = await this.json<{ id: string }>(`/mailFolders/${name}?$select=id`);
          return [f.id, role] as const;
        } catch (err) {
          if (err instanceof MailProviderError && err.status === 404) return null;
          throw err;
        }
      })
    );
    return new Map(found.filter((x) => x !== null));
  }

  async listTags(): Promise<MailTag[]> {
    const d = await this.json<{ value?: { displayName: string; color?: string }[] }>(
      "/outlook/masterCategories"
    );
    return (d.value ?? []).map((c) => {
      const n = /^preset(\d+)$/.exec(c.color ?? "");
      return {
        id: c.displayName,
        account: "microsoft",
        name: c.displayName,
        color: n ? (PRESET_COLORS[Number(n[1])] ?? null) : null,
      };
    });
  }

  async listMessages(q: ListMessagesQuery): Promise<MessagePage> {
    let url: string;
    if (q.pageToken) {
      // SSRF guard: a page token is only ever Graph's own nextLink.
      if (!q.pageToken.startsWith(GRAPH)) throw new MailProviderError("Invalid page token", "request");
      url = q.pageToken;
    } else {
      const params = new URLSearchParams({
        $select: SUMMARY_SELECT,
        $top: String(Math.min(Math.max(q.limit ?? 50, 1), 100)),
      });
      // Graph forbids $orderby together with $search.
      if (q.search) params.set("$search", `"${q.search.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
      else params.set("$orderby", "receivedDateTime desc");
      if (q.unreadOnly) params.set("$filter", "isRead eq false");
      const path = q.folderId ? `/mailFolders/${mid(q.folderId)}/messages` : "/messages";
      url = `${this.base}${path}?${params}`;
    }
    const d = await this.json<{ value?: GMessage[]; "@odata.nextLink"?: string }>(url);
    return { messages: (d.value ?? []).map(summary), nextPageToken: d["@odata.nextLink"] ?? null };
  }

  private async full(m: GMessage): Promise<FullMessage> {
    const html = m.body?.contentType?.toLowerCase() === "html";
    const attachments: MailAttachmentMeta[] = [];
    if (m.hasAttachments) {
      const a = await this.json<{
        value?: { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean }[];
      }>(`/messages/${mid(m.id)}/attachments?$select=id,name,contentType,size,isInline`);
      for (const x of a.value ?? []) {
        attachments.push({
          id: x.id,
          name: x.name ?? "attachment",
          contentType: x.contentType ?? "application/octet-stream",
          size: x.size ?? 0,
          inline: x.isInline === true,
          // ponytail: cid images need contentId, add with phase 2 reading pane
          contentId: null,
        });
      }
    }
    return {
      ...summary(m),
      cc: addrs(m.ccRecipients),
      bcc: addrs(m.bccRecipients),
      replyTo: addrs(m.replyTo),
      bodyHtml: html ? (m.body?.content ?? null) : null,
      bodyText: html ? null : (m.body?.content ?? null),
      attachments,
      webLink: m.webLink ?? null,
    };
  }

  async getMessage(id: string): Promise<FullMessage> {
    return this.full(await this.json<GMessage>(`/messages/${mid(id)}?$select=${FULL_SELECT}`));
  }

  async getThread(threadId: string): Promise<FullMessage[]> {
    // No $orderby alongside $filter (Graph rejects the combo); sort here.
    const filter = `conversationId eq '${threadId.replace(/'/g, "''")}'`;
    const params = new URLSearchParams({ $filter: filter, $select: FULL_SELECT, $top: "100" });
    const d = await this.json<{ value?: GMessage[] }>(`/messages?${params}`);
    const msgs = await Promise.all((d.value ?? []).map((m) => this.full(m)));
    return msgs.sort((a, b) => (a.receivedAt ?? "").localeCompare(b.receivedAt ?? ""));
  }

  async getInlineImages(messageId: string): Promise<InlineImage[]> {
    const list = await this.json<{ value?: { id: string; isInline?: boolean; contentType?: string }[] }>(
      `/messages/${mid(messageId)}/attachments?$select=id,isInline,contentType`
    );
    // ponytail: cap of 20 pictures per message keeps a spammy mail from fanning out
    // into hundreds of requests; raise it if real mail needs more.
    // Inline ones first, then any other picture: some senders mark a picture
    // their HTML points at by cid as a regular attachment. Only called when the
    // body has a cid: reference, so this never runs for ordinary mail.
    const pics = (list.value ?? [])
      .filter((a) => (a.contentType ?? "").toLowerCase().startsWith("image/"))
      .sort((a, b) => Number(b.isInline === true) - Number(a.isInline === true))
      .slice(0, 20);
    const got = await Promise.all(
      pics.map((a) =>
        this.json<{ contentId?: string; contentType?: string; contentBytes?: string }>(
          `/messages/${mid(messageId)}/attachments/${mid(a.id)}`
        )
      )
    );
    const out: InlineImage[] = [];
    for (const g of got) {
      const contentId = g.contentId?.replace(/^<|>$/g, "");
      if (!contentId || !g.contentBytes) continue;
      out.push({ contentId, contentType: g.contentType ?? "application/octet-stream", base64: g.contentBytes });
    }
    return out;
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const a = await this.json<{ name?: string; contentType?: string; contentBytes?: string }>(
      `/messages/${mid(messageId)}/attachments/${mid(attachmentId)}`
    );
    return {
      name: a.name ?? "attachment",
      contentType: a.contentType ?? "application/octet-stream",
      bytes: new Uint8Array(Buffer.from(a.contentBytes ?? "", "base64")),
    };
  }

  async modify(ids: string[], change: MessageChange): Promise<void> {
    // ponytail: one request per message, use $batch if bulk actions feel slow
    for (const id of ids) {
      const patch: Record<string, unknown> = {};
      if (change.read !== undefined) patch.isRead = change.read;
      if (change.flagged !== undefined) {
        patch.flag = { flagStatus: change.flagged ? "flagged" : "notFlagged" };
      }
      if (change.addTags?.length || change.removeTags?.length) {
        const cur = await this.json<{ categories?: string[] }>(
          `/messages/${mid(id)}?$select=categories`
        );
        const drop = new Set(change.removeTags ?? []);
        patch.categories = [...new Set([...(cur.categories ?? []), ...(change.addTags ?? [])])].filter(
          (c) => !drop.has(c)
        );
      }
      if (Object.keys(patch).length) await this.send(`/messages/${mid(id)}`, "PATCH", patch);
    }
  }

  async move(ids: string[], folderId: string): Promise<void> {
    for (const id of ids) {
      await this.send(`/messages/${mid(id)}/move`, "POST", { destinationId: folderId });
    }
  }

  archive(ids: string[]): Promise<void> {
    return this.move(ids, "archive");
  }

  trash(ids: string[]): Promise<void> {
    return this.move(ids, "deleteditems");
  }

  restore(ids: string[], folderId: string): Promise<void> {
    return this.move(ids, folderId);
  }

  async createDraft(msg: OutgoingMessage): Promise<{ id: string }> {
    const content = {
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.html },
    };
    let id: string;
    if (msg.inReplyTo) {
      const verb = { reply: "createReply", replyAll: "createReplyAll", forward: "createForward" }[
        msg.inReplyTo.mode
      ];
      const draft = await this.json<{ id: string }>(
        `/messages/${mid(msg.inReplyTo.messageId)}/${verb}`,
        "POST",
        {}
      );
      id = draft.id;
      // Only override recipients we were given; otherwise keep Graph's defaults.
      await this.send(`/messages/${mid(id)}`, "PATCH", {
        ...content,
        ...(msg.to.length ? { toRecipients: recipients(msg.to) } : {}),
        ...(msg.cc?.length ? { ccRecipients: recipients(msg.cc) } : {}),
        ...(msg.bcc?.length ? { bccRecipients: recipients(msg.bcc) } : {}),
      });
    } else {
      const draft = await this.json<{ id: string }>("/messages", "POST", {
        ...content,
        toRecipients: recipients(msg.to),
        ccRecipients: recipients(msg.cc ?? []),
        bccRecipients: recipients(msg.bcc ?? []),
      });
      id = draft.id;
    }
    // ponytail: 3 MB limit per attachment, upload session for larger
    for (const a of msg.attachments ?? []) {
      await this.send(`/messages/${mid(id)}/attachments`, "POST", {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.base64,
      });
    }
    return { id };
  }

  deleteDraft(id: string): Promise<void> {
    return this.send(`/messages/${mid(id)}`, "DELETE");
  }

  async sendDraft(id: string): Promise<void> {
    this.needOwnApp("Sending mail");
    await this.send(`/messages/${mid(id)}/send`, "POST");
  }
}

type GFolder = {
  id: string;
  displayName: string;
  childFolderCount?: number;
  unreadItemCount?: number;
};

export class GraphCalendarProvider extends GraphBase implements CalendarProvider {
  readonly account = "microsoft" as const;

  constructor(upn: string, creds: GraphCredentials, ownApp = true) {
    super(upn, creds, 'IdType="ImmutableId", outlook.timezone="UTC"', ownApp);
  }

  private event(e: GEvent): MailCalendarEvent {
    return {
      id: e.id,
      account: "microsoft",
      calendarId: "default",
      title: e.subject?.trim() || "(no subject)",
      start: instant(e.start),
      end: instant(e.end),
      allDay: e.isAllDay === true,
      location: e.location?.displayName?.trim() || null,
      organizer: addr(e.organizer),
      attendees: (e.attendees ?? [])
        .map((a) => {
          const p = addr(a);
          return p ? { ...p, response: response(a.status?.response) } : null;
        })
        .filter((a): a is CalendarAttendee => a !== null),
      myResponse: e.isOrganizer ? "organizer" : response(e.responseStatus?.response),
      joinUrl: e.onlineMeeting?.joinUrl ?? null,
      seriesId: e.seriesMasterId ?? null,
      bodyPreview: e.bodyPreview?.trim() || null,
      webLink: e.webLink ?? null,
    };
  }

  async listEvents(startIso: string, endIso: string): Promise<MailCalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: startIso,
      endDateTime: endIso,
      $top: "100",
      $select: EVENT_SELECT,
    });
    const out: MailCalendarEvent[] = [];
    let url: string | null = `${this.base}/calendarView?${params}`;
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const d: { value?: GEvent[]; "@odata.nextLink"?: string } = await this.json(url);
      out.push(...(d.value ?? []).map((e) => this.event(e)));
      url = d["@odata.nextLink"] ?? null;
    }
    return out;
  }

  // Only the fields present on `i` (create passes a full input, update a partial).
  private payload(i: Partial<EventInput>): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    if (i.title !== undefined) p.subject = i.title;
    if (i.start !== undefined) p.start = gdt(i.start);
    if (i.end !== undefined) p.end = gdt(i.end);
    if (i.allDay !== undefined) p.isAllDay = i.allDay;
    if (i.location !== undefined) p.location = { displayName: i.location ?? "" };
    if (i.attendees !== undefined) {
      p.attendees = i.attendees.map((a) => ({
        type: "required",
        emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
      }));
    }
    if (i.body !== undefined) p.body = { contentType: "HTML", content: i.body };
    if (i.teamsMeeting) {
      p.isOnlineMeeting = true;
      p.onlineMeetingProvider = "teamsForBusiness";
    }
    return p;
  }

  async createEvent(input: EventInput): Promise<MailCalendarEvent> {
    this.needOwnApp("Creating events");
    return this.event(await this.json<GEvent>("/events", "POST", this.payload(input)));
  }

  async updateEvent(id: string, input: Partial<EventInput>): Promise<MailCalendarEvent> {
    this.needOwnApp("Changing events");
    return this.event(await this.json<GEvent>(`/events/${mid(id)}`, "PATCH", this.payload(input)));
  }

  async deleteEvent(id: string): Promise<void> {
    this.needOwnApp("Deleting events");
    await this.send(`/events/${mid(id)}`, "DELETE");
  }

  async respond(id: string, answer: "accept" | "decline" | "tentative", comment?: string): Promise<void> {
    this.needOwnApp("Answering invites");
    const verb = answer === "tentative" ? "tentativelyAccept" : answer;
    await this.send(`/events/${mid(id)}/${verb}`, "POST", { comment: comment ?? "", sendResponse: true });
  }
}

// Null until a Microsoft connection and the mailbox UPN are both resolvable.
export function getMicrosoftMail(): GraphMailProvider | null {
  const c = getMailGraphConnection();
  const upn = getMailUpn();
  return c && upn ? new GraphMailProvider(upn, c.creds, c.ownApp) : null;
}

export function getMicrosoftCalendar(): GraphCalendarProvider | null {
  const c = getMailGraphConnection();
  const upn = getMailUpn();
  return c && upn ? new GraphCalendarProvider(upn, c.creds, c.ownApp) : null;
}
