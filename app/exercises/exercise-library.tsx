"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Exercise } from "@/domain/entities";

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function matchesQuery(exercise: Exercise, query: string) {
  const searchableText = [
    exercise.name,
    exercise.equipment,
    exercise.movementPattern,
    exercise.trackingType,
    exercise.defaultLoadType,
    exercise.sideMode,
    ...exercise.muscles.map((muscle) => muscle.muscleGroup),
  ].join(" ").replaceAll("_", " ").toLowerCase();

  return searchableText.includes(query);
}

export function ExerciseLibrary({ exercises }: { exercises: Exercise[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredExercises = useMemo(
    () => normalizedQuery ? exercises.filter((exercise) => matchesQuery(exercise, normalizedQuery)) : exercises,
    [exercises, normalizedQuery],
  );

  return (
    <>
      <section className="library-toolbar" aria-label="Exercise library controls">
        <div className={`library-search${query ? " has-clear" : ""}`} role="search">
          <label className="sr-only" htmlFor="exercise-search">Filter exercises</label>
          <input
            id="exercise-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter exercises"
            autoComplete="off"
          />
          {query ? <button type="button" onClick={() => setQuery("")}>Clear</button> : null}
        </div>
        <output className="library-filter-count" htmlFor="exercise-search" aria-live="polite">
          {normalizedQuery ? `${filteredExercises.length} of ${exercises.length}` : `${exercises.length} total`}
        </output>
      </section>

      {filteredExercises.length ? (
        <section className="exercise-library-list" aria-label="Exercises">
          <div className="exercise-library-head" aria-hidden="true">
            <span>#</span>
            <span>Exercise</span>
            <span>Movement</span>
            <span>Muscles</span>
            <span>Tracking</span>
            <span />
          </div>
          {filteredExercises.map((exercise, index) => {
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
          <strong>{exercises.length ? "No exercises found" : "No exercises yet"}</strong>
          <p>{exercises.length ? "Keep typing or clear the filter to see all exercises." : "Exercises will appear here when they are added to your catalog."}</p>
          {exercises.length ? <button className="secondary-button compact" type="button" onClick={() => setQuery("")}>Clear filter</button> : null}
        </section>
      )}
    </>
  );
}
