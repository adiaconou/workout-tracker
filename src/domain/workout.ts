import type {
  LoadType,
  RestRule,
  RoutineSetType,
  SideMode,
  TargetType,
} from "./entities";

export type WorkoutPrescriptionExercise = {
  id: string;
  exerciseId: string;
  exerciseOrder: number;
  name: string;
  warmup: string;
  warmupSets: number;
  regularSets: number;
  failureSets: number;
  dropSets: number;
  target: string;
  rest: string;
  effort: string;
  purpose: string;
  loadType: string;
  weightUnit: string;
};

export type WorkoutPrescription = {
  code: string;
  version: number;
  focus: string;
  summary: string;
  durationMin: number;
  updatedAt: string;
  exercises: WorkoutPrescriptionExercise[];
};

export type SetType = RoutineSetType;

export type NormalizedWorkoutSetSnapshot = {
  sourceRoutineSetId: string;
  position: number;
  setType: RoutineSetType;
  targetType: TargetType;
  targetMin: number | null;
  targetMax: number | null;
  targetDisplay: string;
  targetRirMin: number | null;
  targetRirMax: number | null;
  restAfterSec: number;
  restRule: RestRule;
  loadInstruction: string;
  sideMode: SideMode;
  tempo: string | null;
  notes: string;
};

export type NormalizedWorkoutExerciseSnapshot = {
  sourceRoutineExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  supersetGroup: string | null;
  instructions: string;
  notes: string;
  loadType: LoadType;
  sideMode: SideMode;
  weightUnit: string;
  sets: NormalizedWorkoutSetSnapshot[];
};

export type NormalizedWorkoutPrescription = {
  schemaVersion: 1;
  routineId: string;
  routineVersionId: string;
  routineVersionNumber: number;
  exercises: NormalizedWorkoutExerciseSnapshot[];
};

type RoutineWithNormalizedPrescription = WorkoutPrescription & {
  normalizedPrescription?: NormalizedWorkoutPrescription;
};

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
  targetUnit: "reps" | "seconds" | "rounds";
  effort: string;
  purpose: string;
  restDisplay: string;
  restSeconds: number;
  restRule: "standard" | "after_both_sides" | "no_rest_before_drop" | "emom" | "after_superset";
  loadType: string;
  weightUnit: string;
  sourceRoutineExerciseId?: string | null;
  sourceRoutineSetId?: string | null;
  targetType?: TargetType;
  targetMin?: number | null;
  targetMax?: number | null;
  targetRirMin?: number | null;
  targetRirMax?: number | null;
  loadInstruction?: string;
  sideMode?: SideMode;
  tempo?: string | null;
  notes?: string;
  exerciseInstructions?: string;
  exerciseNotes?: string;
  supersetGroup?: string | null;
  supersetDisplayGroup?: string | null;
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

function targetFor(exercise: WorkoutPrescriptionExercise, type: SetType, index: number) {
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

function baseType(exercise: WorkoutPrescriptionExercise, requested: Exclude<SetType, "emom">): SetType {
  if (requested === "regular" && exercise.rest.toLowerCase().includes("start every minute")) return "emom";
  return requested;
}

function createExerciseSets(exercise: WorkoutPrescriptionExercise): GuidedSet[] {
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

export function getNormalizedWorkoutPrescription(routine: WorkoutPrescription) {
  const prescription = (routine as RoutineWithNormalizedPrescription).normalizedPrescription;
  if (
    !prescription ||
    prescription.schemaVersion !== 1 ||
    !Array.isArray(prescription.exercises)
  ) {
    return null;
  }
  return prescription;
}

function normalizedTargetUnit(targetType: TargetType): GuidedSet["targetUnit"] {
  if (targetType === "duration") return "seconds";
  if (targetType === "rounds") return "rounds";
  return "reps";
}

function normalizedRestDisplay(seconds: number, rule: RestRule) {
  if (rule === "emom") return "Start every minute";
  if (rule === "after_superset") return "Superset";
  if (rule === "no_rest_before_drop") return "No rest before drop";
  if (!seconds) return "None";
  const base = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
  return rule === "after_both_sides" ? `${base} after both` : base;
}

function normalizedRir(minimum: number | null, maximum: number | null) {
  if (minimum === null && maximum === null) return "";
  if (minimum === null) return `${maximum} RIR`;
  if (maximum === null || maximum === minimum) return `${minimum} RIR`;
  return `${minimum}-${maximum} RIR`;
}

function buildNormalizedGuidedSets(prescription: NormalizedWorkoutPrescription) {
  const exercises = [...prescription.exercises].sort((left, right) => left.position - right.position);
  const setsByExercise = exercises.map((exercise) => {
    const sets = [...exercise.sets].sort((left, right) => left.position - right.position);
    const typeTotals = new Map<RoutineSetType, number>();
    const typeIndexes = new Map<RoutineSetType, number>();
    for (const set of sets) typeTotals.set(set.setType, (typeTotals.get(set.setType) ?? 0) + 1);
    const guidedSets = sets.map((set, setIndex): GuidedSet => {
      const typeSetNumber = (typeIndexes.get(set.setType) ?? 0) + 1;
      typeIndexes.set(set.setType, typeSetNumber);
      return {
        id: set.sourceRoutineSetId,
        globalIndex: -1,
        exerciseId: exercise.exerciseId,
        exerciseOrder: exercise.position,
        exerciseName: exercise.exerciseName,
        exerciseSetNumber: setIndex + 1,
        exerciseSetTotal: sets.length,
        typeSetNumber,
        typeSetTotal: typeTotals.get(set.setType)!,
        setType: set.setType,
        target: set.targetDisplay,
        targetUnit: normalizedTargetUnit(set.targetType),
        effort: normalizedRir(set.targetRirMin, set.targetRirMax) || exercise.instructions,
        purpose: set.notes || exercise.notes,
        restDisplay: normalizedRestDisplay(set.restAfterSec, set.restRule),
        restSeconds: set.restAfterSec,
        restRule: set.restRule,
        loadType: exercise.loadType,
        weightUnit: exercise.weightUnit,
        sourceRoutineExerciseId: exercise.sourceRoutineExerciseId,
        sourceRoutineSetId: set.sourceRoutineSetId,
        targetType: set.targetType,
        targetMin: set.targetMin,
        targetMax: set.targetMax,
        targetRirMin: set.targetRirMin,
        targetRirMax: set.targetRirMax,
        loadInstruction: set.loadInstruction,
        sideMode: set.sideMode,
        tempo: set.tempo,
        notes: set.notes,
        exerciseInstructions: exercise.instructions,
        exerciseNotes: exercise.notes,
        supersetGroup: exercise.supersetGroup,
      };
    });
    return { exercise, guidedSets };
  });

  const result: GuidedSet[] = [];
  const processedGroups = new Set<string>();
  for (const entry of setsByExercise) {
    const group = entry.exercise.supersetGroup?.trim() || null;
    if (!group) {
      result.push(...entry.guidedSets);
      continue;
    }
    if (processedGroups.has(group)) continue;
    processedGroups.add(group);

    const groupEntries = setsByExercise.filter(
      (candidate) => (candidate.exercise.supersetGroup?.trim() || null) === group,
    );
    const rounds = Math.max(0, ...groupEntries.map((candidate) => candidate.guidedSets.length));
    for (let round = 0; round < rounds; round += 1) {
      for (const candidate of groupEntries) {
        const set = candidate.guidedSets[round];
        if (set) result.push(set);
      }
    }
  }
  return result.map((set, globalIndex) => ({ ...set, globalIndex }));
}

export function buildGuidedSets(routine: WorkoutPrescription): GuidedSet[] {
  const normalized = getNormalizedWorkoutPrescription(routine);
  if (normalized) return buildNormalizedGuidedSets(normalized);
  const allExerciseSets = routine.exercises.map((exercise) => createExerciseSets(exercise));
  const result: GuidedSet[] = [];
  const curlIndex = routine.exercises.findIndex((exercise) => exercise.name.toLowerCase() === "barbell curl");
  const pressdownIndex = routine.exercises.findIndex((exercise) => exercise.name.toLowerCase() === "cable triceps pressdown");
  const canInterleaveSuperset = curlIndex >= 0 && pressdownIndex === curlIndex + 1;
  const legacySupersetGroup = "legacy-curl-pressdown";

  allExerciseSets.forEach((sets, exerciseIndex) => {
    if (canInterleaveSuperset && exerciseIndex === curlIndex) {
      const curls = sets;
      const pressdowns = allExerciseSets[pressdownIndex];
      const rounds = Math.max(curls.length, pressdowns.length);
      for (let round = 0; round < rounds; round += 1) {
        if (curls[round]) {
          result.push({ ...curls[round], supersetDisplayGroup: legacySupersetGroup });
        }
        if (pressdowns[round]) {
          result.push({ ...pressdowns[round], supersetDisplayGroup: legacySupersetGroup });
        }
      }
      return;
    }
    if (canInterleaveSuperset && exerciseIndex === pressdownIndex) return;
    result.push(...sets);
  });

  return result.map((set, index) => ({ ...set, globalIndex: index }));
}
