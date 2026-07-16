export const metadata = { title: "Ledgr" };

// Content-Security-Policy for the packaged desktop app. Everything is served
// from the app:// origin (self); data-fetch is over the IPC bridge, not the
// network, so no remote connect-src is needed. Silences Electron's no-CSP
// warning. 'unsafe-inline' covers Next's inline bootstrap/styles in the export.
const CSP =
  "default-src 'self' app:; " +
  "script-src 'self' app: 'unsafe-inline'; " +
  "style-src 'self' app: 'unsafe-inline'; " +
  "img-src 'self' app: data: blob:; " +
  "font-src 'self' app: data:; " +
  "connect-src 'self' app:;";

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
      <body>{children}</body>
    </html>
  );
}
