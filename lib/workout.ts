import type { Routine, RoutineExercise } from "./store";

export type SetType = "warmup" | "regular" | "failure" | "drop" | "emom";

export type GuidedSet = {
  id: string;
  globalIndex: number;
  exerciseId: string;
  exerciseOrder: number;
  exerciseName: string;
  exerciseSetNumber: number;
  exerciseSetTotal: number;
  typeSetNumber: number;
  typeSetTotal: number;
  setType: SetType;
  target: string;
  targetUnit: "reps" | "seconds";
  effort: string;
  purpose: string;
  restDisplay: string;
  restSeconds: number;
  restRule: "standard" | "after_both_sides" | "no_rest_before_drop" | "emom" | "after_superset";
  loadType: string;
  weightUnit: string;
};

function parseRestSeconds(rest: string) {
  const normalized = rest.toLowerCase();
  if (normalized.includes("start every minute")) return 60;
  if (normalized.trim() === "superset") return 0;
  const seconds = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*sec/);
  if (seconds) return Math.round(Number(seconds[1]));
  const minutes = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*min/);
  if (minutes) return Math.round(Number(minutes[1]) * 60);
  return 0;
}

function targetFor(exercise: RoutineExercise, type: SetType, index: number) {
  if (type === "warmup") {
    const parts = exercise.warmup.split(";").map((part) => part.trim()).filter(Boolean);
    return parts[index] ?? exercise.warmup;
  }

  const parts = exercise.target.split(";").map((part) => part.trim()).filter(Boolean);
  const namedPart = parts.find((part) => part.toLowerCase().includes(type));
  if (namedPart) return namedPart.replace(new RegExp(`\\s*${type}\\s*`, "i"), "").trim();
  if (type === "regular" && parts.length > 1) return parts[0].replace(/\s*regular\s*/i, "").trim();
  return exercise.target;
}

function baseType(exercise: RoutineExercise, requested: Exclude<SetType, "emom">): SetType {
  if (requested === "regular" && exercise.rest.toLowerCase().includes("start every minute")) return "emom";
  return requested;
}

function createExerciseSets(exercise: RoutineExercise): GuidedSet[] {
  const definitions: Array<{ type: Exclude<SetType, "emom">; count: number }> = [
    { type: "warmup", count: exercise.warmupSets },
    { type: "regular", count: exercise.regularSets },
    { type: "failure", count: exercise.failureSets },
    { type: "drop", count: exercise.dropSets },
  ];
  const total = definitions.reduce((sum, definition) => sum + definition.count, 0);
  let exerciseSetNumber = 0;
  const sets: GuidedSet[] = [];

  for (const definition of definitions) {
    for (let index = 0; index < definition.count; index += 1) {
      exerciseSetNumber += 1;
      const type = baseType(exercise, definition.type);
      let restSeconds = parseRestSeconds(exercise.rest);
      let restRule: GuidedSet["restRule"] = "standard";
      if (exercise.rest.toLowerCase().includes("after both")) restRule = "after_both_sides";
      if (type === "emom") restRule = "emom";
      if (exercise.rest.trim().toLowerCase() === "superset") {
        restSeconds = 0;
        restRule = "after_superset";
      }
      if (definition.type === "failure" && exercise.dropSets > 0) {
        restSeconds = 0;
        restRule = "no_rest_before_drop";
      }

      const target = targetFor(exercise, type, index);
      sets.push({
        id: `${exercise.exerciseOrder}:${type}:${index + 1}`,
        globalIndex: -1,
        exerciseId: exercise.id,
        exerciseOrder: exercise.exerciseOrder,
        exerciseName: exercise.name,
        exerciseSetNumber,
        exerciseSetTotal: total,
        typeSetNumber: index + 1,
        typeSetTotal: definition.count,
        setType: type,
        target,
        targetUnit: /sec/i.test(target) ? "seconds" : "reps",
        effort: exercise.effort,
        purpose: exercise.purpose,
        restDisplay: exercise.rest,
        restSeconds,
        restRule,
        loadType: exercise.loadType,
        weightUnit: exercise.weightUnit,
      });
    }
  }
  return sets;
}

export function buildGuidedSets(routine: Routine): GuidedSet[] {
  const allExerciseSets = routine.exercises.map((exercise) => createExerciseSets(exercise));
  const result: GuidedSet[] = [];
  const curlIndex = routine.exercises.findIndex((exercise) => exercise.name.toLowerCase() === "barbell curl");
  const pressdownIndex = routine.exercises.findIndex((exercise) => exercise.name.toLowerCase() === "cable triceps pressdown");
  const canInterleaveSuperset = curlIndex >= 0 && pressdownIndex === curlIndex + 1;

  allExerciseSets.forEach((sets, exerciseIndex) => {
    if (canInterleaveSuperset && exerciseIndex === curlIndex) {
      const curls = sets;
      const pressdowns = allExerciseSets[pressdownIndex];
      const rounds = Math.max(curls.length, pressdowns.length);
      for (let round = 0; round < rounds; round += 1) {
        if (curls[round]) result.push(curls[round]);
        if (pressdowns[round]) result.push(pressdowns[round]);
      }
      return;
    }
    if (canInterleaveSuperset && exerciseIndex === pressdownIndex) return;
    result.push(...sets);
  });

  return result.map((set, index) => ({ ...set, globalIndex: index }));
}
