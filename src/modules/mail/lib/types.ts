// The mail & calendar action list (plan note a06242d3, "Moving to the Rust
// version"). The screens only ever ask for these actions; everything behind
// them (Graph for Microsoft, the Gmail REST API for Google) is provider code
// that the Rust port rewrites. Keep this list short and provider-neutral:
// nothing here may carry a Graph or Gmail JSON shape.

export type AccountId = "microsoft" | "gmail";

// An Outlook folder or a Gmail label. Gmail labels double as the tag list
// (see MailTag); a folder is something a message is "in".
export type MailFolder = {
  id: string;
  account: AccountId;
  name: string;
  // Well-known role so the screens can find the inbox/sent/trash on either side.
  role: "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | null;
  parentId: string | null;
  unread: number;
};

// An Outlook category or a user Gmail label: the one tag picker.
export type MailTag = {
  id: string;
  account: AccountId;
  name: string;
  // CSS colour, or null when the provider has none.
  color: string | null;
};

export type MailAddress = { name: string | null; email: string };

export type MailAttachmentMeta = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  inline: boolean;
  // For inline images: the cid the HTML body refers to.
  contentId: string | null;
};

export type MessageSummary = {
  // Stable id: Outlook immutable id, Gmail message id. Item links key on it.
  id: string;
  account: AccountId;
  threadId: string;
  internetMessageId: string | null;
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  receivedAt: string | null;
  preview: string;
  read: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  // Tag ids (category names on Outlook, label ids on Gmail).
  tags: string[];
  folderIds: string[];
};

export type FullMessage = MessageSummary & {
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  // Raw, UNSANITIZED provider HTML. Only ever shown through SafeMailBody.
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: MailAttachmentMeta[];
  webLink: string | null;
};

export type ListMessagesQuery = {
  folderId?: string;
  search?: string;
  unreadOnly?: boolean;
  pageToken?: string;
  limit?: number;
};

export type MessagePage = { messages: MessageSummary[]; nextPageToken: string | null };

export type MessageChange = {
  read?: boolean;
  flagged?: boolean;
  addTags?: string[];
  removeTags?: string[];
};

export type OutgoingMessage = {
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  html: string;
  // Reply/forward target, so threading and quoting come from the provider.
  inReplyTo?: { messageId: string; mode: "reply" | "replyAll" | "forward" };
  attachments?: { name: string; contentType: string; base64: string }[];
};

export interface MailProvider {
  readonly account: AccountId;
  listFolders(): Promise<MailFolder[]>;
  listTags(): Promise<MailTag[]>;
  listMessages(q: ListMessagesQuery): Promise<MessagePage>;
  getMessage(id: string): Promise<FullMessage>;
  getThread(threadId: string): Promise<FullMessage[]>;
  getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<{ name: string; contentType: string; bytes: Uint8Array }>;
  modify(ids: string[], change: MessageChange): Promise<void>;
  move(ids: string[], folderId: string): Promise<void>;
  // The native archive for the account: Outlook's Archive folder, Gmail's
  // "remove INBOX".
  archive(ids: string[]): Promise<void>;
  trash(ids: string[]): Promise<void>;
  // Drafts are the only way mail leaves: create, then send by id. That keeps
  // undo-send (phase 5) a matter of delaying sendDraft, and every outgoing
  // message visible in the provider's own Drafts folder until it goes.
  createDraft(msg: OutgoingMessage): Promise<{ id: string }>;
  deleteDraft(id: string): Promise<void>;
  sendDraft(id: string): Promise<void>;
}

export type CalendarAttendee = MailAddress & {
  response: "accepted" | "declined" | "tentative" | "none";
};

export type MailCalendarEvent = {
  id: string;
  account: AccountId;
  calendarId: string;
  title: string;
  start: string; // ISO instant
  end: string;
  allDay: boolean;
  location: string | null;
  organizer: MailAddress | null;
  attendees: CalendarAttendee[];
  // The owner's own answer to the invite.
  myResponse: CalendarAttendee["response"] | "organizer";
  joinUrl: string | null;
  seriesId: string | null;
  bodyPreview: string | null;
  webLink: string | null;
};

export type EventInput = {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string | null;
  attendees?: MailAddress[];
  body?: string;
  teamsMeeting?: boolean;
};

export interface CalendarProvider {
  readonly account: AccountId;
  listEvents(startIso: string, endIso: string): Promise<MailCalendarEvent[]>;
  createEvent(input: EventInput): Promise<MailCalendarEvent>;
  updateEvent(id: string, input: Partial<EventInput>): Promise<MailCalendarEvent>;
  deleteEvent(id: string): Promise<void>;
  respond(id: string, answer: "accept" | "decline" | "tentative", comment?: string): Promise<void>;
}

export class MailProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "auth" | "request",
    readonly status?: number
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}
