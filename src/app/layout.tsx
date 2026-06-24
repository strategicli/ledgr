import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/nav/Nav";
import PwaRegister from "@/components/pwa/PwaRegister";
import OutboxSync from "@/components/pwa/OutboxSync";
import { AppAuthProvider } from "@/lib/auth/provider";
import { navPadVars } from "@/lib/nav-layout";
import { resolveOwner } from "@/lib/owner";
import { DEFAULT_SETTINGS, getSettings, TEXT_SIZE_PX, UI_SCALE } from "@/lib/settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Wordmark face for the "Ledgr" logo (nav). Bricolage Grotesque is a
// contemporary display grotesque with more character than the UI type; exposed
// as --font-logo so only the logo opts in.
const logoFont = Bricolage_Grotesque({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Ledgr",
  description: "Personal life management: meetings, tasks, notes, and links.",
  // Installed-PWA chrome on iOS (Android reads the manifest, slice 16).
  appleWebApp: {
    capable: true,
    title: "Ledgr",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#191919",
  // Paint under the iOS home indicator; the nav bar pads itself back out
  // with safe-area-inset-bottom.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // Parallel slot for the intercepted item canvas modal (src/app/@modal).
  modal: React.ReactNode;
}>) {
  // The owner's settings drive the app-wide `--accent` var and the body padding
  // that clears the nav (v6). Best-effort: signed-out / pre-DB renders fall back
  // to the defaults. The padding is set as CSS vars (--nav-pt/pb/pl/pr) that
  // globals.css applies; NavShell updates the rail var instantly on collapse.
  let accent = DEFAULT_SETTINGS.highlightColor;
  // The gradient laid over accent *fills*; defaults to the solid so non-gradient
  // accents resolve to a plain color anywhere `--accent-gradient` is used.
  let accentGradient = DEFAULT_SETTINGS.highlightColor;
  let navPosition = DEFAULT_SETTINGS.navPosition;
  let railSize = DEFAULT_SETTINGS.railSize;
  let proseFontSize = TEXT_SIZE_PX[DEFAULT_SETTINGS.textSize];
  // Interface-density scale, resolved per surface. The mobile value mirrors the
  // desktop one unless an explicit mobile level is set. Emitted below as the
  // --ui-scale CSS var, with the mobile value behind a max-width media query.
  let uiScale = UI_SCALE[DEFAULT_SETTINGS.uiDensity];
  let mobileUiScale = uiScale;
  try {
    const owner = await resolveOwner();
    if (owner) {
      const s = await getSettings(owner.id);
      accent = s.highlightColor;
      accentGradient = s.highlightGradient ?? s.highlightColor;
      navPosition = s.navPosition;
      railSize = s.railSize;
      proseFontSize = TEXT_SIZE_PX[s.textSize];
      uiScale = UI_SCALE[s.uiDensity];
      mobileUiScale = UI_SCALE[s.mobileUiDensity ?? s.uiDensity];
    }
  } catch {
    /* defaults */
  }
  // Per-surface interface density. Must set --ui-scale on :root (custom
  // properties inherit down, not up, and the html font-size rule in globals.css
  // reads it); a media query can't live in an inline style, so it goes in a
  // server-rendered <style>. The 639.98px ceiling complements the nav's 640px
  // (sm) desktop breakpoint, so chrome and density switch surfaces together. The
  // values are fixed numbers from UI_SCALE, so there's nothing to escape.
  const uiScaleCss = `:root{--ui-scale:${uiScale}}@media (max-width:639.98px){:root{--ui-scale:${mobileUiScale}}}`;
  return (
    <AppAuthProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} ${logoFont.variable} h-full antialiased`}
      >
        <body
          className="min-h-full flex flex-col"
          style={{ "--accent": accent, "--accent-gradient": accentGradient, "--prose-font-size": proseFontSize, ...navPadVars(navPosition, railSize) } as CSSProperties}
        >
          <style dangerouslySetInnerHTML={{ __html: uiScaleCss }} />
          {children}
          <Nav />
          {modal}
          <PwaRegister />
          <OutboxSync />
        </body>
      </html>
    </AppAuthProvider>
  );
}
