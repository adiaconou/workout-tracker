import { muscleGroups } from "../../domain/entities";
import { routineEditOperationSchema } from "./routine-edit";

const routineSetSchema = {
  type: "object",
  properties: {
    sourceRoutineSetId: { type: ["string", "null"], description: "Current set ID, or null only for a newly added set." },
    position: { type: "integer", minimum: 1 },
    setType: { type: "string", enum: ["warmup", "regular", "failure", "drop", "emom", "test"] },
    targetType: { type: "string", enum: ["reps", "duration", "rounds"] },
    targetMin: { type: ["number", "null"] },
    targetMax: { type: ["number", "null"] },
    targetDisplay: { type: "string" },
    targetRirMin: { type: ["number", "null"] },
    targetRirMax: { type: ["number", "null"] },
    restAfterSec: { type: "integer", minimum: 0 },
    restRule: { type: "string", enum: ["standard", "after_both_sides", "no_rest_before_drop", "emom", "after_superset"] },
    loadInstruction: { type: "string" },
    sideMode: { type: "string", enum: ["bilateral", "per_side", "per_leg", "left_right"] },
    tempo: { type: ["string", "null"] },
    notes: { type: "string" },
  },
  required: [
    "sourceRoutineSetId", "position", "setType", "targetType", "targetMin", "targetMax", "targetDisplay",
    "targetRirMin", "targetRirMax", "restAfterSec", "restRule", "loadInstruction",
    "sideMode", "tempo", "notes",
  ],
  additionalProperties: false,
} as const;

const newRoutineSetSchema = {
  ...routineSetSchema,
  properties: {
    ...routineSetSchema.properties,
    sourceRoutineSetId: { type: "null", description: "Always null because this set does not exist yet." },
  },
} as const;

const routineExerciseSchema = {
  type: "object",
  properties: {
    sourceRoutineExerciseId: { type: ["string", "null"], description: "Current routine placement ID, or null only for a newly added exercise." },
    exerciseId: { type: "string" },
    position: { type: "integer", minimum: 1 },
    supersetGroup: { type: ["string", "null"] },
    instructions: { type: "string" },
    notes: { type: "string" },
    sets: { type: "array", minItems: 1, items: routineSetSchema },
  },
  required: ["sourceRoutineExerciseId", "exerciseId", "position", "supersetGroup", "instructions", "notes", "sets"],
  additionalProperties: false,
} as const;

const newRoutineExerciseSchema = {
  ...routineExerciseSchema,
  properties: {
    ...routineExerciseSchema.properties,
    sourceRoutineExerciseId: { type: "null", description: "Always null because this routine placement does not exist yet." },
    sets: { type: "array", minItems: 1, items: newRoutineSetSchema },
  },
} as const;

const routineProposalSchema = {
  type: "object",
  properties: {
    focus: { type: "string" },
    summary: { type: "string" },
    durationMin: { type: "integer", minimum: 5, maximum: 300 },
    exercises: { type: "array", minItems: 1, items: routineExerciseSchema },
  },
  required: ["focus", "summary", "durationMin", "exercises"],
  additionalProperties: false,
} as const;

const newRoutineProposalSchema = {
  ...routineProposalSchema,
  properties: {
    ...routineProposalSchema.properties,
    exercises: { type: "array", minItems: 1, items: newRoutineExerciseSchema },
  },
} as const;

const proposedExerciseSchema = {
  type: ["object", "null"],
  properties: {
    name: { type: "string" },
    equipment: { type: "string" },
    movementPattern: { type: "string" },
    trackingType: { type: "string", enum: ["reps", "duration", "rounds"] },
    defaultLoadType: { type: "string", enum: ["external", "bodyweight", "added", "assistance"] },
    sideMode: { type: "string", enum: ["bilateral", "per_side", "per_leg", "left_right"] },
    instructions: { type: "string" },
    muscles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          muscleGroup: { type: "string", enum: [...muscleGroups] },
          role: { type: "string", enum: ["primary", "secondary"] },
          weight: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        },
        required: ["muscleGroup", "role", "weight"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "name", "equipment", "movementPattern", "trackingType", "defaultLoadType",
    "sideMode", "instructions", "muscles",
  ],
  additionalProperties: false,
} as const;

export const coachTools = [
  functionTool("get_coaching_context", "Get routine summaries, recent workout history, active workout, and readiness check-ins. Follow nextOffset for additional routine summaries.", objectSchema({ offset: { type: ["integer", "null"], minimum: 0 } }, ["offset"])),
  functionTool("get_routine", "Get a current prescription. Exercises are paginated: follow hasMore/nextOffset before submitting a complete replacement. For small edits use stable IDs with propose_routine_edit.", objectSchema({ routineId: { type: "string", description: "Routine code or ID." }, offset: { type: ["integer", "null"], minimum: 0 } }, ["routineId", "offset"])),
  functionTool("get_routines", "Read selected current routine prescriptions together. Follow nextOffset if hasMore; individual oversized routines can be fetched with get_routine.", objectSchema({ routineIds: { type: "array", minItems: 1, maxItems: 7, items: { type: "string" } }, offset: { type: ["integer", "null"], minimum: 0 } }, ["routineIds", "offset"])),
  functionTool("list_routine_versions", "List summaries of saved versions for one routine. These are version metadata, not complete prescriptions.", objectSchema({ routineId: { type: "string", description: "Routine code or ID." }, offset: { type: ["integer", "null"], minimum: 0 } }, ["routineId", "offset"])),
  functionTool("search_exercises", "Search active exercises supported by the user's selected equipment for substitutions or additions. Use muscleGroup and movementPattern when the user's wording is anatomical or may not appear in an exercise name.", objectSchema({
    query: { type: ["string", "null"] },
    muscleGroup: { type: ["string", "null"], enum: [...muscleGroups, null] },
    movementPattern: { type: ["string", "null"] },
    includeArchived: { type: "boolean" },
    limit: { type: ["integer", "null"], minimum: 1, maximum: 25 },
    offset: { type: ["integer", "null"], minimum: 0 },
  }, ["query", "muscleGroup", "movementPattern", "includeArchived", "limit", "offset"])),
  functionTool("get_exercise", "Get one exact exercise-library record, including its current fields, muscles, active state, and updated timestamp.", objectSchema({
    exerciseId: { type: "string" },
  }, ["exerciseId"])),
  functionTool("get_workout_history", "Get recent workout history and aggregate performance totals.", objectSchema({
    limit: { type: "integer", minimum: 1, maximum: 30 },
    routineCode: { type: ["string", "null"] },
    from: { type: ["string", "null"], description: "Inclusive ISO date/time; null for all history." },
    to: { type: ["string", "null"], description: "Exclusive ISO date/time; null for no end." },
    offset: { type: ["integer", "null"], minimum: 0 },
  }, ["limit", "routineCode", "from", "to", "offset"])),
  functionTool("get_exercise_progress", "Get recorded exercise progress, defaulting to the last 90 days and 12 sessions. Points are the best eligible working sets, not every set; use get_workout_details for reps, RIR and all sets. Never infer missing performance.", objectSchema({ exerciseId: { type: "string" }, from: { type: ["string", "null"] }, limit: { type: ["integer", "null"], minimum: 1, maximum: 30 }, unit: { type: ["string", "null"], enum: ["lb", "kg", null] } }, ["exerciseId", "from", "limit", "unit"])),
  functionTool("get_workout_details", "Get actual sets for a recorded workout, including loads, units, reps, RIR and unilateral results. Follow exercise nextOffset when hasMore.", objectSchema({ workoutId: { type: "string" }, offset: { type: ["integer", "null"], minimum: 0 } }, ["workoutId", "offset"])),
  functionTool("get_plan", "Read the exact proposal and its authoritative status in this conversation before discussing or revising it. Follow nextOffset for every exercise in a routine proposal.", objectSchema({ planId: { type: "string" }, offset: { type: ["integer", "null"], minimum: 0 } }, ["planId", "offset"])),
  functionTool("search_thread_history", "Find older messages in this conversation when the summary or recent context is insufficient. Empty query browses history. Does not search other chats.", objectSchema({ query: { type: "string" }, limit: { type: ["integer", "null"], minimum: 1, maximum: 20 }, offset: { type: ["integer", "null"], minimum: 0 } }, ["query", "limit", "offset"])),
  functionTool("get_active_workout", "Get the workout currently in progress, if any.", emptySchema()),
  functionTool("propose_new_routine", "Stage a pending review card for a brand-new routine the user clearly requested. Inspect current routines and the equipment-filtered exercise library first, use only returned exercise IDs, and target the user's session duration. Prior chat approval is not required. This stores only the proposal and cannot create or publish the routine. The user must choose Create routine in the UI.", objectSchema({
    routineCode: { type: "string", minLength: 1, maxLength: 20, description: "A short unique label for the new routine." },
    proposedRoutine: newRoutineProposalSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["routineCode", "proposedRoutine", "summary", "rationale"])),
  functionTool("propose_routine_change", "Stage a pending review card for a routine change the user clearly requested. Call after reading the current routine; prior chat approval is not required. This stores only the proposal and cannot create or publish a routine version or change the current routine. The user must choose Apply & publish or Save as draft in the UI.", objectSchema({
    routineId: { type: "string" },
    baseVersionId: { type: "string" },
    proposedRoutine: routineProposalSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["routineId", "baseVersionId", "proposedRoutine", "summary", "rationale"])),
  functionTool("propose_routine_edit", "Stage a small requested edit using current placement/set IDs. The server preserves every untouched field. Read the current routine first. Target type/rest rule stay unchanged. Incompatible exercise replacements require a complete prescription. Nothing is applied until the user reviews the card.", objectSchema({
    routineId: { type: "string" }, baseVersionId: { type: "string" },
    operations: { type: "array", minItems: 1, maxItems: 50, items: routineEditOperationSchema },
    summary: { type: "string" }, rationale: { type: "string" },
  }, ["routineId", "baseVersionId", "operations", "summary", "rationale"])),
  functionTool("propose_routine_changes", "Stage 2-7 requested routine proposals together after reading current routines and available exercises. Every item is validated before any is staged. Each card is applied or dismissed independently. Stop using tools after staging.", objectSchema({ proposals: {
    type: "array", minItems: 2, maxItems: 7, items: objectSchema({
      action: { type: "string", enum: ["create", "update"] },
      routineId: { type: ["string", "null"] }, routineCode: { type: ["string", "null"] },
      baseVersionId: { type: ["string", "null"] }, proposedRoutine: routineProposalSchema,
      summary: { type: "string" }, rationale: { type: "string" },
    }, ["action", "routineId", "routineCode", "baseVersionId", "proposedRoutine", "summary", "rationale"]),
  } }, ["proposals"])),
  functionTool("propose_exercise_change", "Stage a pending review card for an exercise-library change the user clearly requested. Inspect the exact target or search the proposed name first, and keep created or changed equipment within the user's selected equipment. Prior chat approval is not required. This stores only the proposal and cannot create, update, or archive an exercise. The user must choose the action in the UI.", objectSchema({
    action: { type: "string", enum: ["create", "update", "archive"] },
    exerciseId: { type: ["string", "null"], description: "Null only when creating an exercise." },
    baseUpdatedAt: { type: ["string", "null"], description: "The exact current updatedAt value, or null when creating." },
    proposedExercise: proposedExerciseSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["action", "exerciseId", "baseUpdatedAt", "proposedExercise", "summary", "rationale"])),
];

function functionTool(name: string, description: string, parameters: unknown) {
  return { type: "function", name, description, parameters, strict: true };
}

function emptySchema() {
  return { type: "object", properties: {}, required: [], additionalProperties: false };
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}
