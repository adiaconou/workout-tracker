import type { Metadata } from "next";
import { getEntityServices } from "@/application/services";
import { requireWorkoutUser } from "../chatgpt-auth";
import { ExerciseLibrary } from "./exercise-library";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exercise Library",
  description: "Browse the exercises available to your workout routines.",
};

export default async function ExerciseLibraryPage() {
  const user = await requireWorkoutUser("/exercises");
  const exercises = await getEntityServices().exercises.list(user.email);

  return (
    <main className="page exercise-library-page">
      <section className="library-intro">
        <div>
          <p className="eyebrow">Movement catalog</p>
          <h1>Exercise Library</h1>
        </div>
        <p className="library-intro-copy">
          {exercises.length} active {exercises.length === 1 ? "exercise" : "exercises"}
        </p>
      </section>

      <ExerciseLibrary exercises={exercises} />
    </main>
  );
}
