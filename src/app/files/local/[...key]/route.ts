// GET/PUT /files/local/<storageKey>?exp=…&sig=… — the local-disk stand-in for
// R2's signed URLs (src/lib/storage/local.ts). The signature IS the credential,
// exactly as it is for a presigned R2 URL, so this route checks no session: a
// GET only works for a URL the /files/<id> gate signed after deciding who may
// read, and a PUT only for the one key, type and size the upload was reserved
// for.
//
// Outside the proxy's matcher (src/proxy.ts) on purpose. With the proxy in
// front, Next buffers each request body for it and silently cuts it at 10MB,
// which would truncate every large upload.
//
// Only answers when this install's storage IS the local disk. An install that
// has since switched to R2 signs no local URLs, so it serves none either.
import { NextResponse } from "next/server";
import { getStorage, LocalDiskProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string[] }> };

async function handle(request: Request, context: Context, op: "get" | "put") {
  const storage = getStorage();
  if (!(storage instanceof LocalDiskProvider)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { key } = await context.params;
  const q = new URL(request.url).searchParams;
  const joined = key.join("/");
  return op === "get" ? storage.serveGet(request, joined, q) : storage.servePut(request, joined, q);
}

export function GET(request: Request, context: Context) {
  return handle(request, context, "get");
}

export function PUT(request: Request, context: Context) {
  return handle(request, context, "put");
}
