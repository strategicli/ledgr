// Attachment tool (ADR-150): let an AI put an image or file into a note.
// The browser upload path (presign → PUT bytes → ![](url)) can't work over
// MCP — an AI has no way to PUT to a presigned URL — so this tool hands the
// bytes to Ledgr and the server does the R2 write via createAttachmentFromBytes
// (the same owner/quota/cap checks the in-app POST /api/attachments runs). The
// bytes arrive one of two ways: a sourceUrl the server fetches, or inline
// base64. By default the tool also embeds a markdown reference in the item body
// (image → ![alt](url), any other file → [name](url)), so "add this diagram to
// the note" is a single call. Markdown stays the source of truth (ADR-037).
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { imageToMarkdown } from "@/lib/editor/image-markdown";
import { createAttachmentFromBytes } from "@/lib/attachments";
import { asUuid } from "@/lib/api";
import { ItemError, getItem } from "@/lib/items";
import { updateItem } from "@/lib/item-mutations";
import { optString } from "./args";
import type { McpTool } from "./wire";

// Ceiling on bytes we'll pull from a sourceUrl in one shot. Comfortably covers
// images and documents an AI would drop into a note, without risking an OOM on
// a hostile or mistaken URL. The per-file/quota caps still apply on top of this
// (reserveAttachment), this just bounds what we buffer before those run.
const FETCH_MAX_BYTES = 50 * 1024 * 1024;

export function isImageContentType(contentType: string): boolean {
  return /^image\//i.test(contentType);
}

// The markdown reference embedded in the item body: an image renders inline,
// any other file becomes a link. Escapes brackets in the label either way.
// Exported (with the parsers below) so the pure glue is node-testable, the same
// discipline image-markdown.ts follows.
export function buildEmbedReference(
  contentType: string,
  publicUrl: string,
  label: string
): string {
  return isImageContentType(contentType)
    ? imageToMarkdown({ src: publicUrl, alt: label })
    : `[${label.replace(/[[\]]/g, "\\$&")}](${publicUrl})`;
}

// Decode base64 (bare or a data: URI) to bytes without Buffer, so it works in
// any runtime. Returns the bytes plus any content type carried by a data URI.
export function decodeBase64(input: string): { bytes: Uint8Array; contentType?: string } {
  let contentType: string | undefined;
  let b64 = input;
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma < 0) throw new ItemError("bad_request", "malformed data: URI in dataBase64");
    const header = input.slice(5, comma); // e.g. image/png;base64
    const semi = header.indexOf(";");
    const ct = (semi >= 0 ? header.slice(0, semi) : header).trim();
    if (ct) contentType = ct;
    b64 = input.slice(comma + 1);
  }
  const clean = b64.replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new ItemError("bad_request", "dataBase64 is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

// Pull a filename out of a Content-Disposition header if it carries one.
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/^["']|["']$/g, ""));
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = header.match(/filename=("?)([^";]+)\1/i);
  return plain ? plain[2] : undefined;
}

// Fetch the bytes at a URL, guarded: http/https only, size-capped, and never
// buffering more than the ceiling. Returns bytes + best-effort content type and
// filename derived from the response.
async function fetchSource(sourceUrl: string): Promise<{
  bytes: Uint8Array;
  contentType?: string;
  filename?: string;
}> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new ItemError("bad_request", "sourceUrl is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ItemError("bad_request", "sourceUrl must be an http or https URL");
  }

  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch {
    throw new ItemError("bad_request", `could not fetch sourceUrl`);
  }
  if (!res.ok) {
    throw new ItemError("bad_request", `could not fetch sourceUrl (HTTP ${res.status})`);
  }

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > FETCH_MAX_BYTES) {
    throw new ItemError(
      "bad_request",
      `sourceUrl is too large (${Math.round(declared / (1024 * 1024))}MB; limit ${Math.round(FETCH_MAX_BYTES / (1024 * 1024))}MB)`
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > FETCH_MAX_BYTES) {
    throw new ItemError(
      "bad_request",
      `sourceUrl is too large (limit ${Math.round(FETCH_MAX_BYTES / (1024 * 1024))}MB)`
    );
  }

  const ct = res.headers.get("content-type")?.split(";")[0].trim() || undefined;
  const fromDisposition = filenameFromDisposition(res.headers.get("content-disposition"));
  const fromPath = decodeURIComponent(url.pathname.split("/").pop() || "").trim() || undefined;
  return { bytes: buf, contentType: ct, filename: fromDisposition || fromPath };
}

export const attachmentTools: McpTool[] = [
  {
    name: "attach_file",
    title: "Attach a file or image to an item",
    description:
      "Add an image or file to an item (a note, meeting, etc.) — store the bytes " +
      "in Ledgr's file storage and, by default, embed a reference in the item's " +
      "markdown body (an image shows inline as ![alt](url); any other file shows " +
      "as a [filename](url) link). Provide the bytes one of two ways: sourceUrl " +
      "(an http/https URL the server fetches — the usual way to add an image or " +
      "document you have a link to) or dataBase64 (the file's bytes as base64, or " +
      "a data: URI — for generated or pasted content). Give a filename when the " +
      "URL doesn't carry one; contentType is inferred when you omit it. Set " +
      "embedInBody=false to attach without touching the body. Requires file " +
      "storage to be configured; subject to the per-file and ~10GB quota caps.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item (UUID) to attach the file to." },
        sourceUrl: {
          type: "string",
          description:
            "http/https URL to fetch the file bytes from. Use this or dataBase64.",
        },
        dataBase64: {
          type: "string",
          description:
            "The file bytes as base64, or a full data: URI (data:<type>;base64,<...>). " +
            "Use this or sourceUrl.",
        },
        filename: {
          type: "string",
          description:
            "Filename to store (e.g. diagram.png). Optional when it can be derived " +
            "from sourceUrl; recommended for dataBase64.",
        },
        contentType: {
          type: "string",
          description:
            "MIME type (e.g. image/png, application/pdf). Optional — inferred from " +
            "the response or data: URI when omitted; drives whether the body embed " +
            "renders as an inline image or a file link.",
        },
        alt: {
          type: "string",
          description:
            "Alt text / caption for the body embed (defaults to the filename). " +
            "Ignored when embedInBody is false.",
        },
        embedInBody: {
          type: "boolean",
          description:
            "Append the markdown reference to the item body (default true). Set " +
            "false to attach the file without changing the body.",
        },
      },
      required: ["itemId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const itemId = asUuid(args.itemId, "itemId");
      const sourceUrl = optString(args, "sourceUrl");
      const dataBase64 = args.dataBase64; // may be a large string; don't trim/normalize via optString
      const argFilename = optString(args, "filename");
      const argContentType = optString(args, "contentType");
      const alt = optString(args, "alt");
      const embedInBody = args.embedInBody !== false; // default true

      if (!sourceUrl && (dataBase64 === undefined || dataBase64 === null)) {
        throw new ItemError("bad_request", "provide sourceUrl or dataBase64");
      }
      if (sourceUrl && dataBase64 != null) {
        throw new ItemError("bad_request", "provide only one of sourceUrl or dataBase64");
      }

      let bytes: Uint8Array;
      let contentType: string | undefined = argContentType;
      let filename: string | undefined = argFilename;

      if (sourceUrl) {
        const fetched = await fetchSource(sourceUrl);
        bytes = fetched.bytes;
        contentType = contentType || fetched.contentType;
        filename = filename || fetched.filename;
      } else {
        if (typeof dataBase64 !== "string") {
          throw new ItemError("bad_request", "dataBase64 must be a string");
        }
        const decoded = decodeBase64(dataBase64);
        bytes = decoded.bytes;
        contentType = contentType || decoded.contentType;
      }

      if (bytes.byteLength === 0) {
        throw new ItemError("bad_request", "the file has no bytes");
      }
      if (!filename) filename = "attachment";
      if (!contentType) contentType = "application/octet-stream";

      const attachment = await createAttachmentFromBytes(ownerId, {
        itemId,
        filename,
        contentType,
        bytes,
      });

      let embedded = false;
      if (embedInBody) {
        const item = await getItem(ownerId, itemId);
        const existing = bodyMarkdown(item.body);
        const label = alt || attachment.filename;
        const ref = buildEmbedReference(contentType, attachment.publicUrl, label);
        const next = existing.trim() ? `${existing.replace(/\s+$/, "")}\n\n${ref}\n` : `${ref}\n`;
        await updateItem(ownerId, itemId, { body: makeMarkdownBody(next) });
        embedded = true;
      }

      return {
        id: attachment.id,
        itemId,
        filename: attachment.filename,
        contentType,
        sizeBytes: bytes.byteLength,
        publicUrl: attachment.publicUrl,
        embedded,
      };
    },
  },
];
