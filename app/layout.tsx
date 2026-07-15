import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    title: { default: "Workout Tracker", template: "%s · Workout Tracker" },
    description: "A focused, private workout tracker for the rolling A–D strength plan.",
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
      <body>{children}</body>
    </html>
  );
}
