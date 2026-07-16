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
      <body style={{ margin: 0, font: "14px/1.5 system-ui, sans-serif", color: "#111" }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav
            style={{
              width: 180,
              flexShrink: 0,
              borderRight: "1px solid #e5e5e5",
              padding: "1rem",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "1rem" }}>Ledgr</div>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  display: "block",
                  padding: "0.35rem 0",
                  color: "#222",
                  textDecoration: "none",
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
      </body>
    </html>
  );
}
