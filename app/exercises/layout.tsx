import { AppHeader } from "../app-header";
import { requireWorkoutUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ExercisesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWorkoutUser("/exercises");

  return (
    <div className="app-shell">
      <AppHeader activeSection="exercises" user={user} />
      {children}
    </div>
  );
}
