// Email-in types + source interface (slice 26, PRD §5.3). The engine reads
// through a MailSource — the Graph source is production, a stub verifies the
// import engine against Neon with no creds. Capture works off a dedicated
// Outlook "Ledgr Import" folder polled via messages/delta; each message
// becomes a note (or a task if the subject is prefixed `task:`).

// Attachment metadata only — the importer links to attachments in the original
// email rather than copying bytes into R2 (ADR: link-don't-copy). Inline
// signature images are filtered out upstream and never reach the engine.
export type MailAttachment = {
  name: string;
  contentType: string;
  size: number;
};

// A message normalized to what the importer needs. The engine never sees Graph
// JSON. Either bodyHtml or bodyText may be present; the converter prefers text.
// `internetMessageId` is the stable RFC822 Message-ID: unlike the Graph `id`,
// it survives the message moving between folders, so it's both the dedup key
// and the durable handle the "Open in Outlook" redirect re-resolves through.
export type NormalizedMessage = {
  id: string;
  internetMessageId: string | null;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: MailAttachment[];
};

export interface MailSource {
  // New/changed messages since the stored delta token, plus the next token to
  // persist. messages/delta returns only what's new (PRD §5.3 efficiency).
  listNewMessages(
    deltaToken: string | null
  ): Promise<{ messages: NormalizedMessage[]; nextDeltaToken: string | null }>;
  // After a message is imported: mark it read and move it to the "Imported"
  // subfolder so it never double-imports.
  markImported(messageId: string): Promise<void>;
}
