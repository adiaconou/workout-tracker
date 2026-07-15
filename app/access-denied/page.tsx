import type { Metadata } from "next";
import { chatGPTSignOutPath } from "../chatgpt-auth";

export const metadata: Metadata = {
  title: "Private tracker",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <main className="access-denied-page">
      <p className="eyebrow">Private tracker</p>
      <h1>This account doesn’t have access.</h1>
      <p>Workout Tracker is restricted to its owner. Sign out and use the ChatGPT account that owns this tracker.</p>
      <a className="primary-button" href={chatGPTSignOutPath("/routines")}>Sign out <span aria-hidden="true">→</span></a>
    </main>
  );
}
