import Link from "next/link";
import type { ChatGPTUser } from "./chatgpt-auth";
import { chatGPTSignOutPath } from "./chatgpt-auth";
import { InstallAppButton } from "./routines/install-app-button";

type AppSection = "routines" | "exercises";

export function AppHeader({
  activeSection,
  user,
}: {
  activeSection: AppSection;
  user: ChatGPTUser;
}) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/routines" aria-label="Workout Tracker routines">
        <span className="wordmark-mark">WT</span>
        <span>Workout Tracker</span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        <Link
          className={`nav-link${activeSection === "routines" ? " active" : ""}`}
          href="/routines"
          aria-current={activeSection === "routines" ? "page" : undefined}
        >
          Routines
        </Link>
        <Link
          className={`nav-link${activeSection === "exercises" ? " active" : ""}`}
          href="/exercises"
          aria-current={activeSection === "exercises" ? "page" : undefined}
        >
          Exercises
        </Link>
        <InstallAppButton />
        <a className="nav-link sign-out-link" href={chatGPTSignOutPath(`/${activeSection}`)}>Sign out</a>
      </nav>
      <span className="account-label" title={user.email}>{user.displayName}</span>
    </header>
  );
}
