import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { PwaRegister } from "./pwa-register";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#090d14",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    applicationName: "Workout Tracker",
    title: { default: "Workout Tracker", template: "%s · Workout Tracker" },
    description: "A focused, private workout tracker for the rolling A–D strength plan.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Workout Tracker",
    },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      ],
      apple: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
    },
    openGraph: {
      title: "Workout Tracker",
      description: "One set at a time. Build, run, and preserve your rolling A–D plan.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1200, height: 630, alt: "Workout Tracker routines A through D" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Workout Tracker",
      description: "One set at a time. Build, run, and preserve your rolling A–D plan.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
