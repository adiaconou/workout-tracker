"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Routine, RoutineExercise } from "../../../lib/store";

function setLabel(exercise: RoutineExercise) {
  const parts = [
    exercise.warmupSets ? `${exercise.warmupSets} warm-up` : null,
    exercise.regularSets ? `${exercise.regularSets} regular` : null,
    exercise.failureSets ? `${exercise.failureSets} failure` : null,
    exercise.dropSets ? `${exercise.dropSets} drop` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function RoutineEditor({ initialRoutine }: { initialRoutine: Routine }) {
  const router = useRouter();
  const [routine, setRoutine] = useState(initialRoutine);
  const [draft, setDraft] = useState(initialRoutine);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalSets = routine.exercises.reduce(
    (sum, exercise) => sum + exercise.warmupSets + exercise.regularSets + exercise.failureSets + exercise.dropSets,
    0,
  );

  function updateRoutineField(field: "focus" | "summary" | "durationMin", value: string | number) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateExercise(index: number, field: keyof RoutineExercise, value: string | number) {
    setDraft((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? { ...exercise, [field]: value } : exercise,
      ),
    }));
  }

  async function saveRoutine() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/routines/${routine.code}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json() as { routine?: Routine; error?: string };
      if (!response.ok || !payload.routine) throw new Error(payload.error ?? "The routine could not be saved.");
      setRoutine(payload.routine);
      setDraft(payload.routine);
      setEditing(false);
      setMessage(`Routine ${payload.routine.code} saved as version ${payload.routine.version}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The routine could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function startWorkout() {
    setStarting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ routineId: routine.code }),
      });
      const payload = await response.json() as {
        created?: boolean;
        session?: { id: string; routineCode: string };
        error?: string;
      };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "The workout could not be started.");
      router.push(`/workouts/${payload.session.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The workout could not be started.");
    } finally {
      setStarting(false);
    }
  }

  function cancelEditing() {
    setDraft(routine);
    setEditing(false);
    setError("");
  }

  return (
    <>
      <section className="detail-hero">
        <div className="detail-title-block">
          <p className="eyebrow">Routine {routine.code} · Version {routine.version}</p>
          {editing ? (
            <>
              <label className="field-label" htmlFor="routine-focus">Routine name</label>
              <input id="routine-focus" className="text-input title-input" value={draft.focus} onChange={(event) => updateRoutineField("focus", event.target.value)} />
              <label className="field-label" htmlFor="routine-summary">Summary</label>
              <textarea id="routine-summary" className="text-input summary-input" value={draft.summary} onChange={(event) => updateRoutineField("summary", event.target.value)} />
            </>
          ) : (
            <>
              <h1>{routine.focus}</h1>
              <p className="lede">{routine.summary}</p>
            </>
          )}
        </div>

        <div className="detail-actions">
          <div className="hero-stats">
            <span><b>{routine.exercises.length}</b> exercises</span>
            <span><b>{totalSets}</b> total sets</span>
            {editing ? (
              <label className="duration-field">Minutes <input type="number" min="15" max="180" value={draft.durationMin} onChange={(event) => updateRoutineField("durationMin", Number(event.target.value))} /></label>
            ) : <span><b>{routine.durationMin}</b> minutes</span>}
          </div>
          <button className="primary-button" type="button" onClick={startWorkout} disabled={starting || editing}>
            {starting ? "Creating workout…" : "Start workout"}<span aria-hidden="true">→</span>
          </button>
          <p className="action-note">Creates a durable workout instance from version {routine.version}.</p>
        </div>
      </section>

      <div className="feedback-region" aria-live="polite">
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error-message">{error}</p>}
      </div>

      <section className="exercise-section">
        <div className="section-heading-row">
          <div><p className="eyebrow">Prescription</p><h2>Exercises</h2></div>
          {editing ? (
            <div className="edit-actions">
              <button className="secondary-button" type="button" onClick={cancelEditing} disabled={saving}>Cancel</button>
              <button className="primary-button compact" type="button" onClick={saveRoutine} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          ) : (
            <button className="secondary-button" type="button" onClick={() => { setEditing(true); setMessage(""); }}>Edit routine</button>
          )}
        </div>

        <div className="exercise-list">
          {(editing ? draft : routine).exercises.map((exercise, index) => (
            <article className={`exercise-item ${editing ? "editing" : ""}`} key={exercise.id}>
              <div className="exercise-order">{String(index + 1).padStart(2, "0")}</div>
              {editing ? (
                <div className="exercise-edit-grid">
                  <label className="field wide">Exercise name<input className="text-input" value={exercise.name} onChange={(event) => updateExercise(index, "name", event.target.value)} /></label>
                  <label className="field wide">Warm-up prescription<input className="text-input" value={exercise.warmup} onChange={(event) => updateExercise(index, "warmup", event.target.value)} /></label>
                  <div className="set-count-grid">
                    {(["warmupSets", "regularSets", "failureSets", "dropSets"] as const).map((field) => (
                      <label className="field" key={field}>{field.replace("Sets", " sets").replace(/^./, (letter) => letter.toUpperCase())}<input className="number-input" type="number" min="0" max="20" value={exercise[field]} onChange={(event) => updateExercise(index, field, Number(event.target.value))} /></label>
                    ))}
                  </div>
                  <label className="field">Target<input className="text-input" value={exercise.target} onChange={(event) => updateExercise(index, "target", event.target.value)} /></label>
                  <label className="field">Rest<input className="text-input" value={exercise.rest} onChange={(event) => updateExercise(index, "rest", event.target.value)} /></label>
                  <label className="field">Effort<input className="text-input" value={exercise.effort} onChange={(event) => updateExercise(index, "effort", event.target.value)} /></label>
                  <label className="field">Load type<select className="text-input" value={exercise.loadType} onChange={(event) => updateExercise(index, "loadType", event.target.value)}><option value="external">External weight</option><option value="bodyweight">Bodyweight</option><option value="added">Added weight</option><option value="assistance">Assistance</option></select></label>
                  <label className="field wide">Why it is included<textarea className="text-input" value={exercise.purpose} onChange={(event) => updateExercise(index, "purpose", event.target.value)} /></label>
                </div>
              ) : (
                <>
                  <div className="exercise-main">
                    <h3>{exercise.name}</h3>
                    <p>{exercise.purpose}</p>
                    <span className="set-summary">{setLabel(exercise)}</span>
                  </div>
                  <dl className="exercise-prescription">
                    <div><dt>Target</dt><dd>{exercise.target}</dd></div>
                    <div><dt>Rest</dt><dd>{exercise.rest}</dd></div>
                    <div><dt>Effort</dt><dd>{exercise.effort}</dd></div>
                    <div><dt>Warm-up</dt><dd>{exercise.warmup}</dd></div>
                  </dl>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      <p className="safety-note">Stop or modify an exercise if pain develops. Routine edits affect future workouts only; every started workout keeps its original snapshot.</p>
    </>
  );
}
