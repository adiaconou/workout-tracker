import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntityServices } from "@/application/services";
import { requireWorkoutUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exercise details",
  description: "Review exercise metadata, muscle groups, and routine usage.",
};

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function ExerciseDetailPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  const user = await requireWorkoutUser(`/exercises/${encodeURIComponent(exerciseId)}`);
  const services = getEntityServices();
  const exercise = await services.exercises.get(user.email, exerciseId);
  if (!exercise) notFound();

  const routines = await services.routines.list(user.email);
  const usedIn = routines.filter((routine) => routine.currentVersion?.exercises.some((item) => item.exerciseId === exercise.id));

  return (
    <main className="page exercise-detail-page">
      <Link className="back-link compact-back-link" href="/exercises">← Exercise Library</Link>

      <section className="exercise-detail-hero">
        <div>
          <p className="eyebrow">Exercise</p>
          <h1>{exercise.name}</h1>
        </div>
        <span className="entity-status">Active</span>
      </section>

      <dl className="exercise-fact-grid">
        <div><dt>Equipment</dt><dd>{label(exercise.equipment)}</dd></div>
        <div><dt>Movement</dt><dd>{label(exercise.movementPattern)}</dd></div>
        <div><dt>Tracks</dt><dd>{label(exercise.trackingType)}</dd></div>
        <div><dt>Loading</dt><dd>{label(exercise.defaultLoadType)}</dd></div>
        <div><dt>Side mode</dt><dd>{label(exercise.sideMode)}</dd></div>
      </dl>

      <section className="exercise-detail-section" aria-labelledby="muscles-heading">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Training effect</p>
            <h2 id="muscles-heading">Muscle groups</h2>
          </div>
          <span>{exercise.muscles.length} tagged</span>
        </div>
        {exercise.muscles.length ? (
          <div className="exercise-muscle-list">
            {exercise.muscles.map((muscle) => (
              <div className="exercise-muscle-row" key={muscle.muscleGroup}>
                <strong>{label(muscle.muscleGroup)}</strong>
                <span>{label(muscle.role)}</span>
              </div>
            ))}
          </div>
        ) : <p className="compact-empty-copy">No muscle groups have been tagged yet.</p>}
      </section>

      <section className="exercise-detail-section" aria-labelledby="routine-usage-heading">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Program usage</p>
            <h2 id="routine-usage-heading">Used in routines</h2>
          </div>
          <span>{usedIn.length} {usedIn.length === 1 ? "routine" : "routines"}</span>
        </div>
        {usedIn.length ? (
          <div className="exercise-routine-links">
            {usedIn.map((routine) => (
              <Link href={`/routines/${routine.code}`} key={routine.id}>
                <span>Routine {routine.code}</span>
                <strong>{routine.currentVersion?.focus}</strong>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        ) : <p className="compact-empty-copy">This exercise is not used in an active routine.</p>}
      </section>

      <section className="exercise-detail-section instruction-section" aria-labelledby="instructions-heading">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Notes</p>
            <h2 id="instructions-heading">Instructions</h2>
          </div>
        </div>
        <p className={exercise.instructions ? "instruction-copy" : "compact-empty-copy"}>
          {exercise.instructions || "No exercise-level instructions have been added yet."}
        </p>
      </section>
    </main>
  );
}
