// Pure checks of the email ↔ item link helpers (src/modules/mail/lib/links.ts):
// the link back to Mail, the record kept on the item, and the body Ledgr writes.
// No database: createFromEmail itself is a thin wrapper over these plus the
// item store. Run: npx tsx scripts/verify-mail-links.mts
import type { FullMessage } from "../src/modules/mail/lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { mailHref, emailLinkFor, bodyFor } = await import("../src/modules/mail/lib/links");

check("gmail href", mailHref("gmail", "t1") === "/mail?account=gmail&m=gmail%3At1", mailHref("gmail", "t1"));
check("outlook href", mailHref("microsoft", "AAMk=") === "/mail?account=microsoft&m=microsoft%3AAAMk%3D", mailHref("microsoft", "AAMk="));
{
  const h = mailHref("gmail", "a b&c/d?e#f%g");
  const m = new URL(h, "http://x").searchParams.get("m");
  check("hostile id stays inside one query param", m === "gmail:a b&c/d?e#f%g" && h.split("&").length === 2, h);
}

const msg: FullMessage = {
  id: "m1",
  account: "gmail",
  threadId: "t1",
  internetMessageId: "<abc@x>",
  subject: "*[click](javascript:alert(1))* plans",
  from: { name: "Eve [admin](javascript:x)", email: "eve@example.org" },
  to: [],
  receivedAt: "2026-10-20T15:00:00.000Z",
  preview: "p".repeat(500),
  read: false,
  flagged: false,
  hasAttachments: false,
  tags: [],
  folderIds: ["INBOX"],
  cc: [],
  bcc: [],
  replyTo: [],
  bodyHtml: "<p>Hello <b>team</b></p><script>alert(1)</script>",
  bodyText: null,
  attachments: [],
  webLink: null,
};

const link = emailLinkFor(msg);
check(
  "the item keeps account, ids, thread, sender and subject",
  link.account === "gmail" && link.messageId === "m1" && link.internetMessageId === "<abc@x>" && link.threadId === "t1" &&
    link.fromEmail === "eve@example.org" && link.subject === msg.subject
);
check("the kept preview is capped at 300 characters", link.preview?.length === 300);

const task = bodyFor("task", msg);
check("a task points back at the email in Mail", task.includes("[View email in Mail](/mail?account=gmail&m=gmail%3At1)"));
check("a task keeps only the preview, not the email's text", !task.includes("Hello") && task.includes("ppp"));
check("hostile subject can't become a link", !/(?<!\\)\]\(javascript:/.test(task) && task.includes("\\*\\[click\\]"), task.split("\n").find((l) => l.startsWith("**Subject")));
check("hostile sender name can't become a link", task.includes("Eve \\[admin\\](javascript:x) (eve@example.org)"));

const note = bodyFor("note", msg);
check("a note brings the email's text along", note.includes("Hello") && note.includes("team"));
check("the email's script never reaches the note", !/<script|alert\(1\)<\/script/.test(note));
check("a note also links back to the email", note.includes("[View email in Mail]("));

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll mail-links checks passed.");
