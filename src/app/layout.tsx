import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

// We deliberately do NOT use `next/font/google` here. That loader downloads
// fonts at build time, which fails in restricted build environments (e.g.
// Render) with "Cannot read properties of null (reading '1')". Instead we
// load the same fonts via a standard <link> at runtime. The matching CSS
// variables live in globals.css, so the typography is unchanged.

export const metadata: Metadata = {
  title: "Vessel — Branch Delivery Console",
  description: "Multi-branch 20L jerrycan delivery & payment operations",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0C0C0C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}