"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WorkoutView } from "@/lib/store";

type RecordSetResponse = {
  performanceId: string;
  completedSets: number;
  skippedSets: number;
  nextSetIndex: number;
  restSeconds: number;
  restEndsAt: string | null;
  workoutCompleted: boolean;
  error?: string;
};

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setTypeLabel(type: string) {
  if (type === "emom") return "EMOM round";
  if (type === "warmup") return "Warm-up set";
  if (type === "failure") return "Failure set";
  if (type === "drop") return "Drop set";
  return "Working set";
}

export function ActiveWorkout({ initialWorkout }: { initialWorkout: WorkoutView }) {
  const [currentIndex, setCurrentIndex] = useState(initialWorkout.currentSetIndex);
  const [completedSets, setCompletedSets] = useState(initialWorkout.completedSets);
  const [skippedSets, setSkippedSets] = useState(initialWorkout.skippedSets);
  const initialRestEnd = initialWorkout.restEndsAt && new Date(initialWorkout.restEndsAt).getTime() > Date.now()
    ? initialWorkout.restEndsAt
    : null;
  const [restEndsAt, setRestEndsAt] = useState(initialRestEnd);
  const [restDuration, setRestDuration] = useState(initialWorkout.currentRestSeconds);
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    initialRestEnd ? Math.max(0, Math.ceil((new Date(initialRestEnd).getTime() - Date.now()) / 1000)) : 0,
  );
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);
  const [skippingRest, setSkippingRest] = useState(false);
  const [saveState, setSaveState] = useState<"Saved" | "Save failed" | "">("");
  const [error, setError] = useState("");
  const [workoutCompleted, setWorkoutCompleted] = useState(initialWorkout.status === "Completed");

  const sets = initialWorkout.sets;
  const currentSet = sets[currentIndex];
  const completedOrSkipped = completedSets + skippedSets;
  const progressPercent = initialWorkout.totalSets
    ? Math.min(100, (completedOrSkipped / initialWorkout.totalSets) * 100)
    : 0;
  const exerciseOrders = useMemo(() => Array.from(new Set(sets.map((set) => set.exerciseOrder))), [sets]);
  const exercisePosition = currentSet ? exerciseOrders.indexOf(currentSet.exerciseOrder) + 1 : exerciseOrders.length;

  useEffect(() => {
    if (!currentSet) return;
    const startsAtZero = currentSet.loadType === "bodyweight" || currentSet.loadType === "added";
    setWeight(startsAtZero ? "0" : "");
    setResult("");
    setError("");
    setSaveState("");
  }, [currentIndex, currentSet]);

  useEffect(() => {
    if (!restEndsAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(restEndsAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        setRestEndsAt(null);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([120, 80, 120]);
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [restEndsAt]);

  async function recordSet(status: "Completed" | "Skipped") {
    if (!currentSet || saving) return;
    setSaving(true);
    setError("");
    setSaveState("");
    try {
      const numericWeight = Number(weight);
      const numericResult = Number(result);
      if (status === "Completed" && (!Number.isFinite(numericWeight) || numericWeight < 0)) {
        throw new Error("Enter the weight used for this set.");
      }
      if (status === "Completed" && (!Number.isFinite(numericResult) || numericResult < 0)) {
        throw new Error(`Enter the ${currentSet.targetUnit === "seconds" ? "seconds" : "reps"} completed.`);
      }

      const response = await fetch(`/api/workouts/${initialWorkout.id}/sets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prescribedSetId: currentSet.id,
          status,
          actualWeight: status === "Completed" ? numericWeight : null,
          actualReps: status === "Completed" && currentSet.targetUnit === "reps" ? numericResult : null,
          actualDurationSec: status === "Completed" && currentSet.targetUnit === "seconds" ? numericResult : null,
        }),
      });
      const payload = await response.json() as RecordSetResponse;
      if (!response.ok) throw new Error(payload.error ?? "This set could not be saved.");

      setCompletedSets(payload.completedSets);
      setSkippedSets(payload.skippedSets);
      setSaveState("Saved");
      if (payload.workoutCompleted) {
        setWorkoutCompleted(true);
        setRestEndsAt(null);
      } else {
        setCurrentIndex(payload.nextSetIndex);
        setRestDuration(payload.restSeconds);
        setRestEndsAt(payload.restEndsAt);
        setSecondsRemaining(payload.restSeconds);
      }
    } catch (caught) {
      setSaveState("Save failed");
      setError(caught instanceof Error ? caught.message : "This set could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function skipRest() {
    if (skippingRest) return;
    setSkippingRest(true);
    setError("");
    try {
      const response = await fetch(`/api/workouts/${initialWorkout.id}/rest/skip`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Rest could not be skipped.");
      setRestEndsAt(null);
      setSecondsRemaining(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rest could not be skipped.");
    } finally {
      setSkippingRest(false);
    }
  }

  const loadLabel = currentSet?.loadType === "assistance"
    ? "Assistance used"
    : currentSet?.loadType === "bodyweight" || currentSet?.loadType === "added"
      ? "Added weight"
      : "Weight used";

  return (
    <main className="active-workout-shell">
      <header className="workout-progress-header">
        <div className="workout-progress-topline">
          <Link href={`/routines/${initialWorkout.routineCode}`} className="exit-workout">← Exit workout</Link>
          <span>Routine {initialWorkout.routineCode} · v{initialWorkout.routineVersion}</span>
          <span>{completedOrSkipped} / {initialWorkout.totalSets} sets</span>
        </div>
        <div className="overall-progress-track" role="progressbar" aria-label="Overall workout progress" aria-valuemin={0} aria-valuemax={initialWorkout.totalSets} aria-valuenow={completedOrSkipped}>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </header>

      {workoutCompleted ? (
        <section className="workout-finished">
          <p className="eyebrow">Routine complete</p>
          <h1>Workout saved.</h1>
          <p>{completedSets} sets completed and {skippedSets} skipped. Every set is stored against this routine snapshot.</p>
          <Link className="primary-button" href="/routines">Back to routines <span aria-hidden="true">→</span></Link>
        </section>
      ) : restEndsAt && currentSet ? (
        <section className="rest-stage" aria-live="polite">
          <div className="rest-copy">
            <p className="eyebrow">Rest in progress</p>
            <p className="timer-value" aria-label={`${secondsRemaining} seconds remaining`}>{formatTimer(secondsRemaining)}</p>
            <div className="timer-track" role="progressbar" aria-label="Rest timer" aria-valuemin={0} aria-valuemax={restDuration} aria-valuenow={secondsRemaining}>
              <span style={{ width: `${restDuration ? (secondsRemaining / restDuration) * 100 : 0}%` }} />
            </div>
            <button className="secondary-button skip-rest-button" type="button" onClick={skipRest} disabled={skippingRest}>
              {skippingRest ? "Skipping…" : "Skip rest"}<span aria-hidden="true">→</span>
            </button>
          </div>
          <aside className="next-set-preview">
            <span className="micro-label">Next set</span>
            <h2>{currentSet.exerciseName}</h2>
            <p>{setTypeLabel(currentSet.setType)} {currentSet.typeSetNumber} of {currentSet.typeSetTotal}</p>
            <dl>
              <div><dt>Target</dt><dd>{currentSet.target}</dd></div>
              <div><dt>Effort</dt><dd>{currentSet.effort}</dd></div>
            </dl>
          </aside>
        </section>
      ) : currentSet ? (
        <section className="set-stage">
          <div className="set-context-row">
            <span>Exercise {exercisePosition} of {exerciseOrders.length}</span>
            <span>Set {currentSet.exerciseSetNumber} of {currentSet.exerciseSetTotal}</span>
            <span className={`save-state ${saveState === "Save failed" ? "failed" : ""}`}>{saving ? "Saving" : saveState}</span>
          </div>

          <div className="set-workspace">
            <section className="set-prescription">
              <p className="eyebrow">{setTypeLabel(currentSet.setType)}</p>
              <h1>{currentSet.exerciseName}</h1>
              <p className="set-purpose">{currentSet.purpose}</p>
              <div className="target-block">
                <span className="micro-label">Target</span>
                <strong>{currentSet.target}</strong>
              </div>
              <dl className="set-facts">
                <div><dt>Effort</dt><dd>{currentSet.effort}</dd></div>
                <div><dt>Rest after set</dt><dd>{currentSet.restDisplay}</dd></div>
                <div><dt>Load</dt><dd>{currentSet.loadType.replace("external", "External weight")}</dd></div>
              </dl>
            </section>

            <section className="set-entry" aria-label="Log this set">
              <p className="micro-label">Log actual performance</p>
              <div className="workout-input-grid">
                <label>{loadLabel}<span>lb</span><input type="number" inputMode="decimal" min="0" step="0.5" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="0" /></label>
                <label>{currentSet.targetUnit === "seconds" ? "Time completed" : "Reps completed"}<span>{currentSet.targetUnit === "seconds" ? "sec" : "reps"}</span><input type="number" inputMode="numeric" min="0" step="1" value={result} onChange={(event) => setResult(event.target.value)} placeholder="0" /></label>
              </div>
              {error && <p className="set-error" role="alert">{error}</p>}
              <button className="primary-button log-set-button" type="button" onClick={() => recordSet("Completed")} disabled={saving}>
                {saving ? "Saving set…" : "Complete set"}<span aria-hidden="true">→</span>
              </button>
              <button className="skip-set-button" type="button" onClick={() => recordSet("Skipped")} disabled={saving}>Skip this set</button>
            </section>
          </div>
        </section>
      ) : null}
    </main>
  );
}
