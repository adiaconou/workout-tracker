import {
  muscleGroups,
  type Exercise,
  type MuscleGroup,
  type RoutineVersionInput,
} from "../../domain/entities";
import { validateRoutineVersionInput } from "../../domain/routines/validation";

export const programExperienceLevels = ["beginner", "intermediate", "advanced"] as const;

export type ProgramExperienceLevel = (typeof programExperienceLevels)[number];

export type ProgramGenerationRequest = {
  name: string;
  goal: string;
  selectedMuscleGroups: MuscleGroup[];
  trainingDaysPerWeek: number;
  routineCount: number;
  targetDurationMin: number;
  experienceLevel: ProgramExperienceLevel;
  avoid: string;
  limitations: string;
  preferences: string;
};

export type GeneratedRoutineProgram = {
  name: string;
  summary: string;
  warnings: string[];
  routines: Array<{
    code: string;
    rationale: string;
    version: RoutineVersionInput;
  }>;
};

type GeneratedProgramContext = {
  request: ProgramGenerationRequest;
  availableExercises: ReadonlyArray<Pick<Exercise, "id" | "muscles">>;
  existingRoutineCodes: readonly string[];
};

const requestFields = new Set([
  "name",
  "goal",
  "selectedMuscleGroups",
  "trainingDaysPerWeek",
  "routineCount",
  "targetDurationMin",
  "experienceLevel",
  "avoid",
  "limitations",
  "preferences",
]);

const setSchema = {
  type: "object",
  properties: {
    position: { type: "integer", minimum: 1 },
    setType: { type: "string", enum: ["warmup", "regular", "failure", "drop", "emom", "test"] },
    targetType: { type: "string", enum: ["reps", "duration", "rounds"] },
    targetMin: { type: ["number", "null"], minimum: 0 },
    targetMax: { type: ["number", "null"], minimum: 0 },
    targetDisplay: { type: "string" },
    targetRirMin: { type: ["number", "null"], minimum: 0 },
    targetRirMax: { type: ["number", "null"], minimum: 0 },
    restAfterSec: { type: "integer", minimum: 0 },
    restRule: {
      type: "string",
      enum: ["standard", "after_both_sides", "no_rest_before_drop", "emom", "after_superset"],
    },
    loadInstruction: { type: "string" },
    sideMode: { type: "string", enum: ["bilateral", "per_side", "per_leg", "left_right"] },
    tempo: { type: ["string", "null"] },
    notes: { type: "string" },
  },
  required: [
    "position", "setType", "targetType", "targetMin", "targetMax", "targetDisplay",
    "targetRirMin", "targetRirMax", "restAfterSec", "restRule", "loadInstruction",
    "sideMode", "tempo", "notes",
  ],
  additionalProperties: false,
} as const;

export function normalizeProgramGenerationRequest(input: unknown): ProgramGenerationRequest {
  const record = requiredRecord(input, "Program generation details are required.");
  const unsupportedField = Object.keys(record).find((field) => !requestFields.has(field));
  if (unsupportedField) {
    throw new Error(`Program generation field \"${unsupportedField}\" is unsupported.`);
  }
  const trainingDaysPerWeek = requiredInteger(
    record.trainingDaysPerWeek,
    "Training days",
    1,
    7,
  );
  const routineCount = requiredInteger(record.routineCount, "Routine count", 1, 7);
  if (routineCount > trainingDaysPerWeek) {
    throw new Error("Routine count cannot exceed training days per week.");
  }
  const experienceLevel = requiredString(record.experienceLevel, "Experience level", 20);
  if (!programExperienceLevels.includes(experienceLevel as ProgramExperienceLevel)) {
    throw new Error("Experience level must be beginner, intermediate, or advanced.");
  }
  return {
    name: optionalString(record.name, "Program name", 80),
    goal: requiredString(record.goal, "Program goal", 500),
    selectedMuscleGroups: normalizeSelectedMuscles(record.selectedMuscleGroups),
    trainingDaysPerWeek,
    routineCount,
    targetDurationMin: requiredInteger(record.targetDurationMin, "Target duration", 10, 300),
    experienceLevel: experienceLevel as ProgramExperienceLevel,
    avoid: optionalString(record.avoid, "Movements to avoid", 1_000),
    limitations: optionalString(record.limitations, "Limitations", 1_000),
    preferences: optionalString(record.preferences, "Preferences", 1_000),
  };
}

export function buildProgramGenerationTool(
  availableExerciseIds: readonly string[],
  routineCount: number,
  targetDurationMin: number,
) {
  const exerciseSchema = {
    type: "object",
    properties: {
      exerciseId: { type: "string", enum: [...availableExerciseIds] },
      position: { type: "integer", minimum: 1 },
      supersetGroup: { type: ["string", "null"] },
      instructions: { type: "string" },
      notes: { type: "string" },
      sets: { type: "array", minItems: 1, items: setSchema },
    },
    required: ["exerciseId", "position", "supersetGroup", "instructions", "notes", "sets"],
    additionalProperties: false,
  } as const;
  const routineVersionSchema = {
    type: "object",
    properties: {
      focus: { type: "string" },
      summary: { type: "string" },
      durationMin: { type: "integer", const: targetDurationMin },
      exercises: { type: "array", minItems: 1, items: exerciseSchema },
    },
    required: ["focus", "summary", "durationMin", "exercises"],
    additionalProperties: false,
  } as const;
  return {
    type: "function",
    name: "return_routine_program",
    description: "Return the complete routine program for user review. This does not save or publish anything.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 80 },
        summary: { type: "string", maxLength: 500 },
        warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
        routines: {
          type: "array",
          minItems: routineCount,
          maxItems: routineCount,
          items: {
            type: "object",
            properties: {
              code: { type: "string", minLength: 1, maxLength: 20, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" },
              rationale: { type: "string", maxLength: 500 },
              version: routineVersionSchema,
            },
            required: ["code", "rationale", "version"],
            additionalProperties: false,
          },
        },
      },
      required: ["name", "summary", "warnings", "routines"],
      additionalProperties: false,
    },
  } as const;
}

export function generatedProgramFromResponse(
  response: unknown,
  context: GeneratedProgramContext,
): GeneratedRoutineProgram {
  const envelope = requiredRecord(response, "The model returned an invalid response.");
  if (envelope.status !== "completed") {
    const responseError = errorMessageFromResponse(envelope);
    throw new Error(responseError);
  }
  if (!Array.isArray(envelope.output)) {
    throw new Error("The model returned no program output.");
  }
  const calls = envelope.output.filter((item) => (
    isRecord(item)
    && item.type === "function_call"
    && item.name === "return_routine_program"
  ));
  if (calls.length !== 1) {
    throw new Error("The model must return exactly one routine program.");
  }
  const argumentsJson = calls[0]!.arguments;
  if (typeof argumentsJson !== "string") {
    throw new Error("The model returned invalid routine program arguments.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error("The model returned malformed routine program JSON.");
  }
  return validateGeneratedProgram(parsed, context);
}

export function validateGeneratedProgram(
  input: unknown,
  context: GeneratedProgramContext,
): GeneratedRoutineProgram {
  const program = requiredRecord(input, "The generated program is invalid.");
  requireOnlyFields(program, ["name", "summary", "warnings", "routines"], "Generated program");
  if (!Array.isArray(program.warnings) || program.warnings.length > 10) {
    throw new Error("Program warnings must be a list with no more than 10 entries.");
  }
  const warnings = program.warnings.map((warning) => requiredString(warning, "Program warning", 300));
  if (!Array.isArray(program.routines) || program.routines.length !== context.request.routineCount) {
    throw new Error(`The generated program must contain exactly ${context.request.routineCount} routines.`);
  }
  const unavailableCodes = new Set(
    context.existingRoutineCodes.map((code) => code.trim().toUpperCase()),
  );
  const availableExerciseById = new Map(
    context.availableExercises.map((exercise) => [exercise.id, exercise]),
  );
  const coveredMuscles = new Set<MuscleGroup>();
  const generatedCodes = new Set<string>();
  const routines = program.routines.map((candidate) => {
    const routine = requiredRecord(candidate, "Each generated routine must be an object.");
    requireOnlyFields(routine, ["code", "rationale", "version"], "Generated routine");
    const code = requiredString(routine.code, "Routine code", 20).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/u.test(code)) {
      throw new Error("Routine codes may use only letters, numbers, hyphens, and underscores.");
    }
    if (unavailableCodes.has(code)) {
      throw new Error(`Routine code ${code} already exists.`);
    }
    if (generatedCodes.has(code)) {
      throw new Error("Generated routine codes must be unique.");
    }
    generatedCodes.add(code);
    const version = validateRoutineVersionInput(routine.version as RoutineVersionInput);
    if (version.durationMin !== context.request.targetDurationMin) {
      throw new Error(`Every generated routine must target ${context.request.targetDurationMin} minutes.`);
    }
    for (const exercise of version.exercises) {
      const availableExercise = availableExerciseById.get(exercise.exerciseId);
      if (!availableExercise) {
        throw new Error(`Exercise ${exercise.exerciseId} is not available for this program.`);
      }
      for (const muscle of availableExercise.muscles) coveredMuscles.add(muscle.muscleGroup);
    }
    return {
      code,
      rationale: requiredString(routine.rationale, "Routine rationale", 500),
      version,
    };
  });
  const uncoveredMuscles = context.request.selectedMuscleGroups.filter(
    (muscle) => !coveredMuscles.has(muscle),
  );
  if (uncoveredMuscles.length) {
    throw new Error(
      `The generated program does not cover requested muscle groups: ${uncoveredMuscles.join(", ")}.`,
    );
  }
  return {
    name: requiredString(program.name, "Program name", 80),
    summary: requiredString(program.summary, "Program summary", 500),
    warnings,
    routines,
  };
}

export function unavailableSelectedMuscleGroups(
  selectedMuscleGroups: readonly MuscleGroup[],
  availableExercises: ReadonlyArray<Pick<Exercise, "muscles">>,
) {
  const availableMuscles = new Set(
    availableExercises.flatMap((exercise) => (
      exercise.muscles.map((muscle) => muscle.muscleGroup)
    )),
  );
  return selectedMuscleGroups.filter((muscle) => !availableMuscles.has(muscle));
}

export function exerciseGenerationContext(exercises: readonly Exercise[]) {
  return exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    equipment: exercise.equipment,
    movementPattern: exercise.movementPattern,
    trackingType: exercise.trackingType,
    defaultLoadType: exercise.defaultLoadType,
    sideMode: exercise.sideMode,
    instructions: exercise.instructions,
    muscles: exercise.muscles,
  }));
}

function normalizeSelectedMuscles(value: unknown): MuscleGroup[] {
  if (!Array.isArray(value)) {
    throw new Error("Selected muscle groups must be a list.");
  }
  const selected = new Set(value.map((muscle) => {
    if (typeof muscle !== "string" || !muscleGroups.includes(muscle as MuscleGroup)) {
      throw new Error("A selected muscle group is invalid.");
    }
    return muscle as MuscleGroup;
  }));
  return muscleGroups.filter((muscle) => selected.has(muscle));
}

function requiredInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requiredString(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function optionalString(value: unknown, label: string, maximum: number) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireOnlyFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  label: string,
) {
  const allowed = new Set(allowedFields);
  const unsupported = Object.keys(record).find((field) => !allowed.has(field));
  if (unsupported) throw new Error(`${label} field \"${unsupported}\" is unsupported.`);
}

function errorMessageFromResponse(response: Record<string, unknown>) {
  if (isRecord(response.error) && typeof response.error.message === "string") {
    return response.error.message;
  }
  if (
    response.status === "incomplete"
    && isRecord(response.incomplete_details)
    && response.incomplete_details.reason === "max_output_tokens"
  ) {
    return "The model ran out of response capacity before completing the routine program.";
  }
  return `The model response ended with status ${String(response.status)}.`;
}
