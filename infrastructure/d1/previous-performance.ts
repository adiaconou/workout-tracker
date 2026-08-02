export type PreviousExerciseSet = {
  setNumber: number;
  setType: string;
  targetType?: string;
  actualWeight: number | null;
  actualReps: number | null;
  actualDurationSec: number | null;
  weightUnit: string;
  status: string;
};

export type PreviousExercisePerformance = {
  workoutId: string;
  performedAt: string;
  sets: PreviousExerciseSet[];
};

export async function getPreviousPerformanceByExercise(
  d1: D1Database,
  ownerEmail: string,
  sessionId: string,
  sessionStartedAt: string,
) {
  const rows = await d1.prepare(`
    SELECT current_exercise.position AS currentExerciseOrder,
      prior_session.id AS workoutId, prior_session.started_at AS performedAt,
      prior_set.set_type AS setType, prior_set.planned_target_type AS targetType,
      prior_set.actual_weight AS actualWeight,
      prior_set.actual_reps AS actualReps,
      prior_set.actual_duration_sec AS actualDurationSec,
      prior_set.weight_unit AS weightUnit, prior_set.status
    FROM workout_exercises current_exercise
    INNER JOIN workout_exercises prior_exercise
      ON prior_exercise.exercise_id = current_exercise.exercise_id
      AND prior_exercise.workout_id <> current_exercise.workout_id
      AND (
        (
          current_exercise.source_routine_exercise_id IS NOT NULL
          AND prior_exercise.source_routine_exercise_id = current_exercise.source_routine_exercise_id
        )
        OR (
          SELECT COUNT(*) FROM workout_exercises current_sibling
          WHERE current_sibling.workout_id = current_exercise.workout_id
            AND current_sibling.exercise_id = current_exercise.exercise_id
            AND current_sibling.position <= current_exercise.position
        ) = (
          SELECT COUNT(*) FROM workout_exercises prior_sibling
          WHERE prior_sibling.workout_id = prior_exercise.workout_id
            AND prior_sibling.exercise_id = prior_exercise.exercise_id
            AND prior_sibling.position <= prior_exercise.position
        )
      )
    INNER JOIN workout_sessions prior_session
      ON prior_session.id = prior_exercise.workout_id
      AND prior_session.owner_email = prior_exercise.owner_email
    INNER JOIN workout_sets prior_set
      ON prior_set.workout_exercise_id = prior_exercise.id
      AND prior_set.status IN ('completed', 'skipped')
    WHERE current_exercise.workout_id = ? AND current_exercise.owner_email = ?
      AND prior_session.started_at < ?
      AND prior_session.id = (
        SELECT candidate_session.id
        FROM workout_exercises candidate_exercise
        INNER JOIN workout_sessions candidate_session
          ON candidate_session.id = candidate_exercise.workout_id
          AND candidate_session.owner_email = candidate_exercise.owner_email
        WHERE candidate_exercise.owner_email = current_exercise.owner_email
          AND candidate_exercise.exercise_id = current_exercise.exercise_id
          AND candidate_exercise.workout_id <> ?
          AND candidate_session.started_at < ?
          AND (
            (
              current_exercise.source_routine_exercise_id IS NOT NULL
              AND candidate_exercise.source_routine_exercise_id = current_exercise.source_routine_exercise_id
            )
            OR (
              SELECT COUNT(*) FROM workout_exercises current_sibling
              WHERE current_sibling.workout_id = current_exercise.workout_id
                AND current_sibling.exercise_id = current_exercise.exercise_id
                AND current_sibling.position <= current_exercise.position
            ) = (
              SELECT COUNT(*) FROM workout_exercises candidate_sibling
              WHERE candidate_sibling.workout_id = candidate_exercise.workout_id
                AND candidate_sibling.exercise_id = candidate_exercise.exercise_id
                AND candidate_sibling.position <= candidate_exercise.position
            )
          )
          AND EXISTS (
            SELECT 1 FROM workout_sets completed_set
            WHERE completed_set.workout_exercise_id = candidate_exercise.id
              AND completed_set.status = 'completed'
          )
        ORDER BY candidate_session.started_at DESC
        LIMIT 1
      )
    ORDER BY current_exercise.position, prior_set.position
  `).bind(
    sessionId,
    ownerEmail,
    sessionStartedAt,
    sessionId,
    sessionStartedAt,
  ).all<{
    currentExerciseOrder: number;
    workoutId: string;
    performedAt: string;
    setType: string;
    targetType: string;
    actualWeight: number | null;
    actualReps: number | null;
    actualDurationSec: number | null;
    weightUnit: string;
    status: string;
  }>();

  const history: Record<number, PreviousExercisePerformance> = {};
  for (const row of rows.results) {
    const exerciseOrder = Number(row.currentExerciseOrder);
    const performance = history[exerciseOrder] ?? {
      workoutId: row.workoutId,
      performedAt: row.performedAt,
      sets: [],
    };
    performance.sets.push({
      setNumber: performance.sets.length + 1,
      setType: row.setType,
      targetType: row.targetType,
      actualWeight: row.actualWeight === null ? null : Number(row.actualWeight),
      actualReps: row.actualReps === null ? null : Number(row.actualReps),
      actualDurationSec:
        row.actualDurationSec === null ? null : Number(row.actualDurationSec),
      weightUnit: row.weightUnit,
      status: row.status,
    });
    history[exerciseOrder] = performance;
  }
  return history;
}
