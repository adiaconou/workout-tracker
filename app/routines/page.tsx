import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkoutUser } from "../chatgpt-auth";
import { getRoutineList, getRoutineRecommendations } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Routines",
  description: "Your rolling A–D workout routine library.",
};

export default async function RoutinesPage() {
  const user = await requireWorkoutUser("/routines");
  const routines = await getRoutineList(user.email);
  const recommendations = await getRoutineRecommendations(user.email);
  const recommendedRoutine = routines.find((routine) => routine.code === recommendations.recommendedRoutineCode);
  const recommendedGuidance = recommendations.routines.find((routine) => routine.isRecommended);

  return (
    <main className="page routines-page">
      <section className="page-intro">
        <p className="eyebrow">Your program</p>
        <h1>Routines</h1>
        <p className="lede">Choose from the routines your recent training leaves available, with one goal-aligned pick for today. You can still open and start any routine.</p>
      </section>

      <section className={`today-panel${recommendedRoutine ? "" : " recovery-day"}`} aria-labelledby="today-heading">
        <div className="today-copy">
          <p className="eyebrow">Best today</p>
          {recommendedRoutine && recommendedGuidance ? (
            <>
              <div className="today-routine-line">
                <span className="today-routine-code">Routine {recommendedRoutine.code}</span>
                <span className={`availability-badge ${recommendedGuidance.availability}`}>
                  {recommendedGuidance.availabilityLabel}
                </span>
              </div>
              <h2 id="today-heading">{recommendedRoutine.focus}</h2>
              <p className="today-summary">{recommendations.summary}</p>
              <p className="today-reason">{recommendedGuidance.goalReason}</p>
            </>
          ) : (
            <>
              <span className="today-routine-code">Recovery</span>
              <h2 id="today-heading">Take a recovery day</h2>
              <p className="today-summary">{recommendations.summary}</p>
              <p className="today-reason">Availability is an estimate from the sets you logged, not a medical safety assessment.</p>
            </>
          )}
        </div>
        {recommendedRoutine ? (
          <Link className="primary-button today-action" href={`/routines/${recommendedRoutine.code}`}>
            Review Routine {recommendedRoutine.code} <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <p className="today-override">Every routine remains available to review or start manually below.</p>
        )}
      </section>

      <div className="routine-list-heading">
        <p className="eyebrow">All routines</p>
        <p>Availability reflects muscle overlap from completed sets in the past 72 hours.</p>
      </div>

      <section className="routine-list" aria-label="Workout routines">
        {routines.map((routine, index) => {
          const guidance = recommendations.routines.find((item) => item.code === routine.code);
          return (
            <Link className="routine-row" href={`/routines/${routine.code}`} key={routine.code}>
              <span className="routine-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="routine-code">{routine.code}</span>
              <span className="routine-copy">
                <strong>{routine.focus}</strong>
                <span className="routine-summary">{routine.summary}</span>
                {guidance ? (
                  <span className="routine-guidance">
                    {guidance.isRecommended ? <span className="best-badge">Best today</span> : null}
                    <span className={`availability-badge ${guidance.availability}`}>{guidance.availabilityLabel}</span>
                    <span className="guidance-reason">{guidance.availabilityReason}</span>
                  </span>
                ) : null}
              </span>
              <span className="routine-stats" aria-label={`${routine.exerciseCount} exercises, ${routine.setCount} sets, about ${routine.durationMin} minutes`}>
                <span><b>{routine.exerciseCount}</b> exercises</span>
                <span><b>{routine.setCount}</b> sets</span>
                <span><b>{routine.durationMin}</b> min</span>
              </span>
              <span className="row-arrow" aria-hidden="true">→</span>
            </Link>
          );
        })}
      </section>

      <footer className="sequence-note">
        <span>Rolling sequence</span>
        <strong>A → B → C → D → repeat</strong>
        <span>The sequence does not reset on Monday. Recovery guidance never locks a routine.</span>
      </footer>
    </main>
  );
}
