import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/owner";
import { captureSharedUrlOrText } from "@/lib/capture/share";
import { createInboxTranscript } from "@/lib/meetings/transcripts";

// PWA share target (slice 16; web clipper mobile half ADR-100; transcript-file
// share path). The manifest points Android's share sheet here as a POST
// multipart target so the app appears for BOTH a shared URL/text (unchanged)
// AND a shared text file. A POST navigation can't be served by a page, so this
// is a route handler that branches on what arrived and 303-redirects to a GET
// landing page:
//
//   • a shared .txt/.md file → captured as an inbox `transcript` (text never
//     lost), then on to /capture/transcript/{id} to pick the meeting.
//   • a shared URL/text → the existing capture (link/unmarked into the inbox),
//     then on to /items/{id}.
//
// Middleware keeps the route signed-in-only; the installed PWA's Clerk cookie
// rides the POST so the owner is resolved here. iOS has no share-target support
// and stays on the in-app upload/paste paths (PRD §4.5).
export const dynamic = "force-dynamic";

// The form field name the manifest declares for the shared file.
const FILE_FIELD = "transcript";

function str(v: FormDataEntryValue | null): string | undefined {
  return typeof v === "string" ? v.trim() || undefined : undefined;
}

// Filename → a sensible transcript name: drop the extension, tidy separators.
function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base || "Transcript";
}

export async function POST(request: Request) {
  const owner = await resolveOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", request.url), 303);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  // A shared file wins: a recording app's transcript export is the whole point.
  const file = form.get(FILE_FIELD);
  if (file && typeof file !== "string" && file.size > 0) {
    const text = await file.text();
    if (text.trim()) {
      const transcript = await createInboxTranscript(owner.id, {
        title: titleFromFilename(file.name || "Transcript"),
        text,
      });
      return NextResponse.redirect(
        new URL(`/capture/transcript/${transcript.id}`, request.url),
        303
      );
    }
  }

  // Otherwise a shared URL/text — the existing quick-capture / web-clipper path.
  const itemId = await captureSharedUrlOrText(owner.id, {
    title: str(form.get("title")),
    text: str(form.get("text")),
    url: str(form.get("url")),
  });
  return NextResponse.redirect(new URL(itemId ? `/items/${itemId}` : "/", request.url), 303);
}

// A stray GET (a bookmark to the old page, a manual hit) has nothing to capture;
// send it home rather than 405. Real shares always arrive as the POST above.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}
