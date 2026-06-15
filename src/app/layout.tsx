import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/nav/Nav";
import PwaRegister from "@/components/pwa/PwaRegister";
import { AppAuthProvider } from "@/lib/auth/provider";
import { resolveOwner } from "@/lib/owner";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  // that clears the nav bar (v5). Best-effort: signed-out / pre-DB renders fall
  // back to the defaults. Mobile always keeps the bottom bar (pb-24); the nav
  // position only reflows the desktop padding.
  let accent = DEFAULT_SETTINGS.highlightColor;
  let navPosition = DEFAULT_SETTINGS.navPosition;
  try {
    const owner = await resolveOwner();
    if (owner) {
      const s = await getSettings(owner.id);
      accent = s.highlightColor;
      navPosition = s.navPosition;
    }
  } catch {
    /* defaults */
  }
  const navPad: Record<typeof navPosition, string> = {
    bottom: "pb-24",
    top: "pb-24 sm:pb-0 sm:pt-24",
    left: "pb-24 sm:pb-0 sm:pl-28",
    right: "pb-24 sm:pb-0 sm:pr-28",
  };
  return (
    <AppAuthProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body
          className={`min-h-full flex flex-col ${navPad[navPosition]}`}
          style={{ "--accent": accent } as CSSProperties}
        >
          {children}
          <Nav />
          {modal}
          <PwaRegister />
        </body>
      </html>
    </AppAuthProvider>
  );
}
