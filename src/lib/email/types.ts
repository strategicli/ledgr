// Email-in types + source interface (slice 26, PRD §5.3). The engine reads
// through a MailSource — the Graph source is production, a stub verifies the
// import engine against Neon with no creds. Capture works off a dedicated
// Outlook "Ledgr Import" folder polled via messages/delta; each message
// becomes a note (or a task if the subject is prefixed `task:`).

export type MailAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
};

// A message normalized to what the importer needs. The engine never sees Graph
// JSON. Either bodyHtml or bodyText may be present; the converter prefers text.
export type NormalizedMessage = {
  id: string;
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
