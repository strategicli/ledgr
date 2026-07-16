import "./globals.css";
import Link from "next/link";

export const metadata = { title: "Ledgr" };

// Content-Security-Policy for the packaged desktop app. Everything is served
// from the app:// origin (self); data-fetch is over the IPC bridge, not the
// network. Silences Electron's no-CSP warning.
const CSP =
  "default-src 'self' app:; " +
  "script-src 'self' app: 'unsafe-inline'; " +
  "style-src 'self' app: 'unsafe-inline'; " +
  "img-src 'self' app: data: blob:; " +
  "font-src 'self' app: data:; " +
  "connect-src 'self' app:;";

// Minimal desktop nav shell. The cloud app has the full configurable NavShell;
// the desktop uses a simple fixed rail for now (nav slots + styling are a later
// pass). Links use the Next client router (static export navigates client-side).
const NAV = [
  { href: "/today", label: "Today" },
  { href: "/", label: "Dashboards" },
  { href: "/tasks", label: "Tasks" },
  { href: "/notes", label: "Notes" },
  { href: "/inbox", label: "Inbox" },
  { href: "/list?type=event", label: "Events" },
  { href: "/list?type=person", label: "People" },
  { href: "/views", label: "Views" },
  { href: "/search", label: "Search" },
];

// Route raw `fetch("/api/...")` through the IPC bridge so the shared cloud
// client components (the Tiptap editor, field/property editors, …) work on the
// desktop with no per-component changes (ADR-139). Non-/api fetches pass through.
// Installed as an inline head script so it patches window.fetch before any
// component runs. Cloud is unaffected (no window.__ledgrDesktop there).
const FETCH_SHIM = `(function () {
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : (input && input.url);
      var bridge = window.__ledgrDesktop;
      if (bridge && typeof url === "string" && url.indexOf("/api/") === 0) {
        var method = (init && init.method) || "GET";
        var body;
        if (init && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch (e) {} }
        return bridge.request({ method: method, path: url, body: body }).then(function (r) {
          return new Response(r.data == null ? null : JSON.stringify(r.data), {
            status: r.status,
            headers: { "Content-Type": "application/json" },
          });
        });
      }
    } catch (e) {}
    return orig(input, init);
  };
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <script dangerouslySetInnerHTML={{ __html: FETCH_SHIM }} />
      </head>
      <body>
        <div className="flex min-h-screen">
          <nav className="w-44 flex-shrink-0 border-r border-neutral-800 p-4">
            <div className="mb-4 font-bold tracking-tight text-neutral-100">Ledgr</div>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="block py-1.5 text-neutral-300 no-underline hover:text-neutral-100"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
