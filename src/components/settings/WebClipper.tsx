// "Save from the web" (web clipper) setup on User Settings (ADR-122). The
// clipper itself shipped with ADR-100, but its setup lived buried at the bottom
// of Build → AI & MCP next to MCP tokens, where nobody looking to "save a web
// page" would find it. This is its findable home: one place to drag the desktop
// bookmarklet and read the mobile share-sheet steps. It's a set-up-once surface
// (drag the bookmarklet once; install the PWA once), so User Settings — reached
// from both Work and Build — fits better than a daily-nav slot. The interactive
// drag/token logic stays in ClipperSetup; this wrapper supplies the framing,
// the token breadcrumb, and the mobile walkthrough.
import ClipperSetup from "@/components/build/ClipperSetup";

export default function WebClipper({
  origin,
  hasApiToken,
}: {
  origin: string;
  hasApiToken: boolean;
}) {
  return (
    <section className="mt-10 border-t border-neutral-800 pt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Save from the web
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Clip a web page&rsquo;s readable content into your Inbox, from desktop or
        your phone. The article saves as a link item carrying its text, so you
        keep the substance even if the original moves or disappears.
      </p>

      {/* Token breadcrumb: the clipper rides the same api-scoped token as the
          HTTP API, which is generated over in AI & MCP. */}
      <div className="mt-3 flex items-start gap-2.5">
        <span
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
            hasApiToken ? "bg-emerald-500" : "bg-amber-500"
          }`}
          aria-hidden
        />
        <p className="text-sm text-neutral-400">
          {hasApiToken
            ? "An api token is configured. Paste it below to build your bookmarklet."
            : "You'll need an api-scoped token first, then paste it below."}{" "}
          <a
            href="/build/claude"
            className="text-[var(--accent)] hover:underline"
          >
            Manage tokens in AI &amp; MCP →
          </a>
        </p>
      </div>

      {/* Desktop: the draggable bookmarklet. */}
      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        On desktop
      </h3>
      <ClipperSetup origin={origin} />

      {/* Mobile: the PWA share target. The share sheet only hands us the URL,
          so Ledgr re-fetches the page server-side to pull its content — which
          works for public pages and degrades to link + title for the rest. */}
      <h3 className="mt-7 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        On mobile
      </h3>
      <ol className="mt-2 ml-4 list-decimal space-y-1.5 text-sm text-neutral-400">
        <li>
          Open Ledgr in your phone&rsquo;s browser and add it to your home
          screen (iPhone: Share → Add to Home Screen; Android: browser menu →
          Install app / Add to Home screen).
        </li>
        <li>
          From any app, tap Share and choose Ledgr. The page lands in your
          Inbox.
        </li>
      </ol>
      <p className="mt-2 text-xs text-neutral-600">
        Public pages capture their full readable content; pages behind a login
        or paywall save the link and title.
      </p>
    </section>
  );
}
