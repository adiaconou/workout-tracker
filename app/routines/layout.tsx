import Link from "next/link";
import { chatGPTSignOutPath, requireWorkoutUser } from "../chatgpt-auth";
import { InstallAppButton } from "./install-app-button";

export const dynamic = "force-dynamic";

export default async function RoutinesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWorkoutUser("/routines");
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="wordmark" href="/routines" aria-label="Workout Tracker routines">
          <span className="wordmark-mark">WT</span>
          <span>Workout Tracker</span>
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link className="nav-link active" href="/routines" aria-current="page">Routines</Link>
          <InstallAppButton />
          <a className="nav-link" href={chatGPTSignOutPath("/routines")}>Sign out</a>
        </nav>
        <span className="account-label" title={user.email}>{user.displayName}</span>
      </header>
      {children}
    </div>
  );
}
