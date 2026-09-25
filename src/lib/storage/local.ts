// Local-disk implementation of the storage provider: files live in the install's
// own data folder (`<LEDGR_SUPERVISOR_DIR>/files/<storageKey>`), so a fresh
// self-hosted install can take uploads without a Cloudflare account.
//
// The SAME security properties R2 gives, mirrored rather than relaxed:
//   - Nothing is readable without a signature. The only way in is a short-lived
//     HMAC-signed URL, minted by presignDownload after the /files/<id> access
//     gate (ADR-231) has already decided who may read. Same TTLs as R2.
//   - An upload URL is signed for ONE key, ONE content type and ONE size, and
//     expires in 15 minutes, like R2's presigned PUT. The size binding is the
//     part R2 lacks: the quota was checked against the declared size, so a PUT
//     larger than that is refused mid-stream rather than trusted.
//   - Bytes are served from the app's own origin (R2 serves them from its own),
//     so every response carries `nosniff` and a sandbox CSP. An uploaded HTML
//     page still opens as a live page with its own script (the File type's
//     Share promises that), but in an opaque origin with no `allow-same-origin`:
//     no Ledgr cookies, no Ledgr storage, no readable same-site requests. That
//     is the same footing a page served from R2's separate origin has.
//   - Keys are validated and resolved inside the root before any disk access,
//     so a key can never name a path outside the files folder.
//
// The signing key is a random 32 bytes the app writes into the data folder the
// first time it needs one. No env var, nothing to paste; losing it only expires
// links that were already short-lived.
//
// The route that serves these URLs is /files/local/<key> (src/app/files/local).
// It is kept out of the proxy's matcher on purpose: with a proxy in front, Next
// buffers request bodies and silently cuts them at 10MB, which would truncate
// every large upload. The signature is the credential, so the proxy has nothing
// to add there.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { PresignedUpload, StorageProvider } from "./types";

export const LOCAL_FILES_ROUTE = "/files/local";
const UPLOAD_URL_TTL_SECONDS = 900;
const DOWNLOAD_URL_TTL_SECONDS = 3600;
// A grant claiming to live longer than this was not minted here.
const MAX_TTL_SECONDS = 24 * 3600;
// Never add allow-same-origin: it is the one flag that would hand an uploaded
// page this app's cookies and storage.
export const SANDBOX_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/** Where the bytes live, given the supervisor's data folder. */
export function localFilesDir(supervisorDir: string): string {
  return join(supervisorDir, "files");
}
export function localSigningKeyPath(supervisorDir: string): string {
  return join(supervisorDir, "file-signing.key");
}

// ── Signed grants (pure) ────────────────────────────────────────────────────

export type LocalGrant = {
  op: "get" | "put";
  key: string;
  exp: number; // unix seconds
  ct: string; // content type (put only; "" for get)
  n: number; // max bytes (put only; 0 for get)
};

// JSON, not a joined string, so no field can smuggle a separator into another.
function signGrant(secret: Buffer, g: LocalGrant): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify([g.op, g.key, g.exp, g.ct, g.n]))
    .digest("base64url");
}

export function grantIsValid(
  secret: Buffer,
  g: LocalGrant,
  sig: string,
  nowSec: number
): boolean {
  if (!Number.isSafeInteger(g.exp) || g.exp < nowSec || g.exp > nowSec + MAX_TTL_SECONDS) {
    return false;
  }
  if (g.op === "put" && (!Number.isSafeInteger(g.n) || g.n < 1)) return false;
  const want = Buffer.from(signGrant(secret, g));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Root-relative URL for a grant. The browser resolves it against the page. */
export function grantUrl(secret: Buffer, g: LocalGrant): string {
  const q = new URLSearchParams({ exp: String(g.exp) });
  if (g.op === "put") {
    q.set("ct", g.ct);
    q.set("n", String(g.n));
  }
  q.set("sig", signGrant(secret, g));
  const path = g.key.split("/").map(encodeURIComponent).join("/");
  return `${LOCAL_FILES_ROUTE}/${path}?${q}`;
}

/**
 * The grant a request claims. The op comes from the HTTP METHOD, never from the
 * URL, so a download link can't be replayed as an upload or the reverse.
 */
export function grantFromRequest(
  op: "get" | "put",
  key: string,
  q: URLSearchParams
): { grant: LocalGrant; sig: string } {
  return {
    grant: {
      op,
      key,
      exp: Number(q.get("exp")),
      ct: op === "put" ? (q.get("ct") ?? "") : "",
      n: op === "put" ? Number(q.get("n")) : 0,
    },
    sig: q.get("sig") ?? "",
  };
}

// ── Key → path (pure) ───────────────────────────────────────────────────────

// Names Windows treats as devices, with or without an extension.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Is this a key we would ever mint? Every segment is a plain file or folder
 * name: no traversal, no separators or characters Windows rejects, no device
 * names, no trailing dot or space (Windows silently drops those, so the file
 * on disk would not match its key), and no leading dot (reserved for the
 * half-written `.part` files an upload streams into).
 */
export function isSafeKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  return key
    .split("/")
    .every(
      (s) =>
        s.length > 0 &&
        s.length <= 255 &&
        !s.startsWith(".") &&
        !/[. ]$/.test(s) &&
        !/[\x00-\x1f\\:*?"<>|]/.test(s) &&
        !WINDOWS_DEVICE.test(s)
    );
}

/** The file for a key, guaranteed to sit inside `root`. Throws otherwise. */
export function keyPath(root: string, key: string): string {
  if (!isSafeKey(key)) throw new Error("unsafe storage key");
  const base = resolve(root);
  const p = resolve(base, ...key.split("/"));
  if (!p.startsWith(base + sep)) throw new Error("unsafe storage key");
  return p;
}

// ── Serving (pure helpers) ──────────────────────────────────────────────────

// Content type by extension. R2 serves the type stamped at upload; a file on
// disk has none, so the name decides. A miss is octet-stream, which downloads
// rather than renders: the safe direction. ponytail: a fixed table, a sidecar
// type file if a real format ever needs its uploaded type preserved.
const EXT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};
export function guessContentType(filename: string): string {
  const ext = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return (ext && EXT_CONTENT_TYPES[ext]) || "application/octet-stream";
}

/**
 * One `Range: bytes=…` header against a file size. Null means "serve the whole
 * file" (no header, or a form we don't do, like multiple ranges, which the spec
 * lets a server ignore). Audio and video need this to seek.
 */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end };
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

class TooLarge extends Error {}

/**
 * Every stored file under `root` whose key starts with `prefix`, as keys with
 * forward slashes. Skips dot-files (uploads in flight). A missing folder is no
 * files. Async all the way down: the app is one process, and a blocking walk
 * of a big library would stall every request (ADR-246).
 */
export async function listFiles(
  root: string,
  prefix = ""
): Promise<{ key: string; sizeBytes: number }[]> {
  const base = resolve(root);
  const out: { key: string; sizeBytes: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const key = relative(base, p).split(sep).join("/");
      if (!key.startsWith(prefix)) continue;
      try {
        out.push({ key, sizeBytes: (await stat(p)).size });
      } catch {
        // deleted between readdir and stat
      }
    }
  };
  await walk(base);
  return out;
}

// ── The signing key ─────────────────────────────────────────────────────────

const secrets = new Map<string, Promise<Buffer>>();

async function loadOrCreateSecret(path: string): Promise<Buffer> {
  try {
    const existing = Buffer.from((await readFile(path, "utf8")).trim(), "base64url");
    if (existing.length >= 32) return existing;
  } catch {
    // first use: fall through and create it
  }
  await mkdir(dirname(path), { recursive: true });
  try {
    // `wx`: two first requests at once must agree on one key, so the loser of
    // the race reads the winner's instead of overwriting it.
    await writeFile(path, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return Buffer.from((await readFile(path, "utf8")).trim(), "base64url");
}

// ── The provider ────────────────────────────────────────────────────────────

export class LocalDiskProvider implements StorageProvider {
  readonly kind = "local" as const;

  constructor(
    readonly root: string,
    private secretPath: string
  ) {}

  private secret(): Promise<Buffer> {
    let s = secrets.get(this.secretPath);
    if (!s) {
      s = loadOrCreateSecret(this.secretPath);
      // A failed read must not poison every later call.
      s.catch(() => secrets.delete(this.secretPath));
      secrets.set(this.secretPath, s);
    }
    return s;
  }

  async presignUpload(
    key: string,
    contentType: string,
    sizeBytes?: number
  ): Promise<PresignedUpload> {
    keyPath(this.root, key);
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 1) {
      throw new Error("a local-disk upload needs its size up front");
    }
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS;
    const g: LocalGrant = { op: "put", key, exp, ct: contentType, n: sizeBytes as number };
    return { uploadUrl: grantUrl(await this.secret(), g) };
  }

  async presignDownload(key: string, ttlSeconds = DOWNLOAD_URL_TTL_SECONDS): Promise<string> {
    keyPath(this.root, key);
    const exp = Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, MAX_TTL_SECONDS);
    return grantUrl(await this.secret(), { op: "get", key, exp, ct: "", n: 0 });
  }

  // The content type isn't stored: serving goes by the file's extension.
  async putObject(key: string, bytes: Uint8Array, _contentType?: string): Promise<void> {
    const final = keyPath(this.root, key);
    await mkdir(dirname(final), { recursive: true });
    // Write beside, then rename: a crash mid-write leaves a dot-file the
    // listing ignores, never a truncated file under the real key.
    const part = join(dirname(final), `.${randomBytes(8).toString("hex")}.part`);
    try {
      await writeFile(part, bytes, { flag: "wx" });
      await rename(part, final);
    } catch (err) {
      await rm(part, { force: true }).catch(() => {});
      throw err;
    }
  }

  async getObject(key: string): Promise<Response> {
    const p = keyPath(this.root, key);
    try {
      const s = await stat(p);
      if (!s.isFile()) return text(404, "not found");
      return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
        headers: { "content-length": String(s.size), "content-type": guessContentType(key) },
      });
    } catch {
      return text(404, "not found");
    }
  }

  async deleteObject(key: string): Promise<void> {
    const p = keyPath(this.root, key);
    await rm(p, { force: true });
    // Tidy the per-attachment folder when it empties. Never the root or an
    // owner folder: only a folder this key's own depth created.
    if (key.split("/").length > 2) await rmdir(dirname(p)).catch(() => {});
  }

  listObjects(prefix: string): Promise<{ key: string; sizeBytes: number }[]> {
    return listFiles(this.root, prefix);
  }

  // ── The two verbs /files/local/<key> answers ─────────────────────────────

  /** GET: the bytes, for a valid download grant only. */
  async serveGet(request: Request, key: string, q: URLSearchParams): Promise<Response> {
    const { grant, sig } = grantFromRequest("get", key, q);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!isSafeKey(key) || !grantIsValid(await this.secret(), grant, sig, nowSec)) {
      return text(403, "This file link is invalid or has expired. Open the file again from Ledgr.");
    }
    const p = keyPath(this.root, key);
    let size: number;
    try {
      const s = await stat(p);
      if (!s.isFile()) throw new Error("not a file");
      size = s.size;
    } catch {
      // Say what happened: the row exists (the gate found it), the bytes don't.
      return text(
        404,
        "This file is listed in Ledgr, but its bytes are missing from this computer's files folder."
      );
    }
    const type = guessContentType(key);
    const headers: Record<string, string> = {
      "content-type": type,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(p))}`,
      "x-content-type-options": "nosniff",
    };
    // Chrome will not render a PDF under a sandbox CSP, and its viewer does not
    // run the document's script in this origin anyway. Everything else is
    // sandboxed WITHOUT allow-same-origin: an HTML page runs as a live page,
    // but as an opaque origin that can't see anything of Ledgr's.
    if (type !== "application/pdf") headers["content-security-policy"] = SANDBOX_CSP;

    const range = parseRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    const body =
      request.method === "HEAD" || size === 0
        ? null
        : (Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream);
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  /** PUT: store the bytes, for a valid upload grant only, streamed to disk. */
  async servePut(request: Request, key: string, q: URLSearchParams): Promise<Response> {
    const { grant, sig } = grantFromRequest("put", key, q);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!isSafeKey(key) || !grantIsValid(await this.secret(), grant, sig, nowSec)) {
      return text(403, "This upload link is invalid or has expired. Start the upload again.");
    }
    // R2 signs the Content-Type header and refuses a mismatch; so do we.
    if ((request.headers.get("content-type") ?? "") !== grant.ct) {
      return text(403, "The Content-Type header must match the one this upload link was made for.");
    }
    const lengthHeader = request.headers.get("content-length");
    const declared = lengthHeader === null ? null : Number(lengthHeader);
    if (declared !== null && !(declared <= grant.n)) {
      return text(413, "This file is larger than the size its upload link was made for.");
    }
    if (!request.body) return text(400, "No file bytes arrived.");

    const final = keyPath(this.root, key);
    await mkdir(dirname(final), { recursive: true });
    const part = join(dirname(final), `.${randomBytes(8).toString("hex")}.part`);
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > grant.n) cb(new TooLarge());
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(request.body as unknown as NodeReadableStream),
        limit,
        createWriteStream(part, { flags: "wx" })
      );
    } catch (err) {
      await rm(part, { force: true }).catch(() => {});
      if (err instanceof TooLarge) {
        return text(413, "This file is larger than the size its upload link was made for.");
      }
      throw err;
    }
    // A body shorter than its own Content-Length was cut off in transit.
    if (declared !== null && received !== declared) {
      await rm(part, { force: true }).catch(() => {});
      return text(400, "The upload arrived incomplete. Try it again.");
    }
    await rename(part, final);
    return new Response(null, { status: 200 });
  }
}
