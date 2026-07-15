import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkoutUser } from "../chatgpt-auth";
import { getRoutineList } from "../../lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Routines",
  description: "Your rolling A–D workout routine library.",
};

export default async function RoutinesPage() {
  const user = await requireWorkoutUser("/routines");
  const routines = await getRoutineList(user.email);

  return (
    <main className="page routines-page">
      <section className="page-intro">
        <p className="eyebrow">Your program</p>
        <h1>Routines</h1>
        <p className="lede">Four focused sessions in a rolling sequence. Open any routine to review its exercises, tune the prescription, or start a fresh workout.</p>
      </section>

      <section className="routine-list" aria-label="Workout routines">
        {routines.map((routine, index) => (
          <Link className="routine-row" href={`/routines/${routine.code}`} key={routine.code}>
            <span className="routine-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="routine-code">{routine.code}</span>
            <span className="routine-copy">
              <strong>{routine.focus}</strong>
              <span>{routine.summary}</span>
            </span>
            <span className="routine-stats" aria-label={`${routine.exerciseCount} exercises, ${routine.setCount} sets, about ${routine.durationMin} minutes`}>
              <span><b>{routine.exerciseCount}</b> exercises</span>
              <span><b>{routine.setCount}</b> sets</span>
              <span><b>{routine.durationMin}</b> min</span>
            </span>
            <span className="row-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <footer className="sequence-note">
        <span>Rolling sequence</span>
        <strong>A → B → C → D → repeat</strong>
        <span>The sequence does not reset on Monday.</span>
      </footer>
    </main>
  );
}
