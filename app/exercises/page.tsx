import type { Metadata } from "next";
import Link from "next/link";
import { getEntityServices } from "@/application/services";
import { requireWorkoutUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exercise Library",
  description: "Browse the exercises available to your workout routines.",
};

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ExerciseLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await requireWorkoutUser("/exercises");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const exercises = await getEntityServices().exercises.list(user.email, query ? { search: query } : undefined);

  return (
    <main className="page exercise-library-page">
      <section className="library-intro">
        <div>
          <p className="eyebrow">Movement catalog</p>
          <h1>Exercise Library</h1>
        </div>
        <p className="library-intro-copy">
          {query
            ? `${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"} matching “${query}”`
            : `${exercises.length} active ${exercises.length === 1 ? "exercise" : "exercises"}`}
        </p>
      </section>

      <section className="library-toolbar" aria-label="Exercise library controls">
        <form className="library-search" action="/exercises" method="get" role="search">
          <label className="sr-only" htmlFor="exercise-search">Search exercises</label>
          <input
            id="exercise-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search exercises"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>
        {query ? <Link className="clear-search" href="/exercises">Clear search</Link> : null}
      </section>

      {exercises.length ? (
        <section className="exercise-library-list" aria-label="Exercises">
          <div className="exercise-library-head" aria-hidden="true">
            <span>#</span>
            <span>Exercise</span>
            <span>Movement</span>
            <span>Muscles</span>
            <span>Tracking</span>
            <span />
          </div>
          {exercises.map((exercise, index) => {
            const primaryMuscles = exercise.muscles.filter((muscle) => muscle.role === "primary");
            const shownMuscles = (primaryMuscles.length ? primaryMuscles : exercise.muscles).slice(0, 3);
            const hiddenMuscleCount = Math.max(0, exercise.muscles.length - shownMuscles.length);

            return (
              <Link
                className="exercise-library-row"
                href={`/exercises/${encodeURIComponent(exercise.id)}`}
                key={exercise.id}
              >
                <span className="exercise-library-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="exercise-library-name">
                  <strong>{exercise.name}</strong>
                  <small>{label(exercise.equipment)}</small>
                </span>
                <span className="exercise-library-movement">{label(exercise.movementPattern)}</span>
                <span className="exercise-library-muscles">
                  {shownMuscles.length ? shownMuscles.map((muscle) => (
                    <span className="muscle-chip" key={muscle.muscleGroup}>{label(muscle.muscleGroup)}</span>
                  )) : <span className="metadata-empty">Not tagged</span>}
                  {hiddenMuscleCount ? <span className="muscle-count">+{hiddenMuscleCount}</span> : null}
                </span>
                <span className="exercise-library-tracking">{label(exercise.trackingType)}</span>
                <span className="row-arrow" aria-hidden="true">→</span>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="library-empty">
          <strong>No exercises found</strong>
          <p>{query ? "Try a different exercise name." : "Exercises will appear here when they are added to your catalog."}</p>
          {query ? <Link className="secondary-button compact" href="/exercises">View all exercises</Link> : null}
        </section>
      )}
    </main>
  );
}
