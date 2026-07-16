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
  { href: "/", label: "Dashboards" },
  { href: "/tasks", label: "Tasks" },
  { href: "/notes", label: "Notes" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
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
