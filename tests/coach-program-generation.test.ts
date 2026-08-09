import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise, RoutineVersionInput } from "../src/domain/entities";
import {
  buildProgramGenerationTool,
  exerciseGenerationContext,
  generatedProgramFromResponse,
  normalizeProgramGenerationRequest,
  unavailableSelectedMuscleGroups,
  validateGeneratedProgram,
} from "../src/server/coach/program-generation";

const baseRequest = {
  name: "  Strong week  ",
  goal: "  Build useful strength  ",
  selectedMuscleGroups: ["triceps", "chest", "triceps"],
  trainingDaysPerWeek: 3,
  routineCount: 2,
  targetDurationMin: 45,
  experienceLevel: "intermediate",
  avoid: "  jumping  ",
  limitations: "",
  preferences: "  short warmups  ",
};

const routineSet = {
  position: 1,
  setType: "regular" as const,
  targetType: "reps" as const,
  targetMin: 8,
  targetMax: 10,
  targetDisplay: "8-10 reps",
  targetRirMin: 2,
  targetRirMax: 2,
  restAfterSec: 90,
  restRule: "standard" as const,
  loadInstruction: "",
  sideMode: "bilateral" as const,
  tempo: null,
  notes: "",
};

function routineVersion(exerciseId: string, focus: string): RoutineVersionInput {
  return {
    focus,
    summary: `${focus} summary`,
    durationMin: 45,
    exercises: [{
      exerciseId,
      position: 1,
      supersetGroup: null,
      instructions: "Move with control.",
      notes: "",
      sets: [{ ...routineSet }],
    }],
  };
}

function programFixture() {
  return {
    name: "Strong week",
    summary: "Two focused strength sessions.",
    warnings: ["Duration is an estimate."],
    routines: [
      { code: "push-1", rationale: "Train pushing muscles.", version: routineVersion("ex-1", "Push") },
      { code: "pull_2", rationale: "Train pulling muscles.", version: routineVersion("ex-2", "Pull") },
    ],
  };
}

const normalizedRequest = normalizeProgramGenerationRequest(baseRequest);
const validationContext = {
  request: normalizedRequest,
  availableExercises: [
    { id: "ex-1", muscles: [{ muscleGroup: "chest" as const, role: "primary" as const, weight: 1 }] },
    { id: "ex-2", muscles: [{ muscleGroup: "triceps" as const, role: "secondary" as const, weight: 0.5 }] },
  ],
  existingRoutineCodes: ["A"],
};

test("program generation request normalization is strict, bounded, and canonical", () => {
  assert.deepEqual(normalizedRequest, {
    name: "Strong week",
    goal: "Build useful strength",
    selectedMuscleGroups: ["chest", "triceps"],
    trainingDaysPerWeek: 3,
    routineCount: 2,
    targetDurationMin: 45,
    experienceLevel: "intermediate",
    avoid: "jumping",
    limitations: "",
    preferences: "short warmups",
  });
  assert.equal(normalizeProgramGenerationRequest({ ...baseRequest, name: undefined }).name, "");

  const invalid: Array<[unknown, RegExp]> = [
    [null, /details are required/],
    [[], /details are required/],
    [{ ...baseRequest, surprise: true }, /surprise/],
    [{ ...baseRequest, trainingDaysPerWeek: "3" }, /whole number/],
    [{ ...baseRequest, trainingDaysPerWeek: 3.5 }, /whole number/],
    [{ ...baseRequest, trainingDaysPerWeek: 0 }, /whole number/],
    [{ ...baseRequest, trainingDaysPerWeek: 8 }, /whole number/],
    [{ ...baseRequest, routineCount: 4 }, /cannot exceed/],
    [{ ...baseRequest, experienceLevel: "expert" }, /beginner, intermediate, or advanced/],
    [{ ...baseRequest, experienceLevel: 3 }, /must be text/],
    [{ ...baseRequest, goal: " " }, /Program goal is required/],
    [{ ...baseRequest, goal: 3 }, /must be text/],
    [{ ...baseRequest, goal: "x".repeat(501) }, /500 characters/],
    [{ ...baseRequest, name: 3 }, /Program name must be text/],
    [{ ...baseRequest, name: "x".repeat(81) }, /80 characters/],
    [{ ...baseRequest, selectedMuscleGroups: "chest" }, /must be a list/],
    [{ ...baseRequest, selectedMuscleGroups: [3] }, /invalid/],
    [{ ...baseRequest, selectedMuscleGroups: ["forearms"] }, /invalid/],
    [{ ...baseRequest, avoid: "x".repeat(1_001) }, /1000 characters/],
  ];
  for (const [input, message] of invalid) {
    assert.throws(() => normalizeProgramGenerationRequest(input), message);
  }
});

test("program generation tool forces one exact, strict program shape", () => {
  const tool = buildProgramGenerationTool(["ex-1", "ex-2"], 2, 45);
  assert.equal(tool.type, "function");
  assert.equal(tool.name, "return_routine_program");
  assert.equal(tool.strict, true);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.equal(tool.parameters.properties.routines.minItems, 2);
  assert.equal(tool.parameters.properties.routines.maxItems, 2);
  const version = tool.parameters.properties.routines.items.properties.version;
  assert.equal(version.properties.durationMin.const, 45);
  assert.deepEqual(
    version.properties.exercises.items.properties.exerciseId.enum,
    ["ex-1", "ex-2"],
  );
  assert.equal(version.properties.exercises.items.additionalProperties, false);
  assert.equal(
    version.properties.exercises.items.properties.sets.items.additionalProperties,
    false,
  );
});

test("generated program validation normalizes codes and enforces domain and library boundaries", () => {
  const valid = validateGeneratedProgram(programFixture(), validationContext);
  assert.deepEqual(valid.routines.map((routine) => routine.code), ["PUSH-1", "PULL_2"]);
  assert.equal(valid.routines[0]!.version.focus, "Push");

  const invalidPrograms: Array<[unknown, RegExp]> = [
    [null, /generated program is invalid/i],
    [{ ...programFixture(), extra: true }, /field.*extra/i],
    [{ ...programFixture(), warnings: "none" }, /warnings must be a list/i],
    [{ ...programFixture(), warnings: Array.from({ length: 11 }, () => "warning") }, /no more than 10/i],
    [{ ...programFixture(), warnings: [3] }, /warning must be text/i],
    [{ ...programFixture(), routines: "two" }, /exactly 2/i],
    [{ ...programFixture(), routines: [programFixture().routines[0]] }, /exactly 2/i],
    [{ ...programFixture(), routines: [null, programFixture().routines[1]] }, /must be an object/i],
    [{
      ...programFixture(),
      routines: [{ ...programFixture().routines[0], extra: true }, programFixture().routines[1]],
    }, /field.*extra/i],
    [{
      ...programFixture(),
      routines: [{ ...programFixture().routines[0], code: "bad code" }, programFixture().routines[1]],
    }, /letters, numbers/i],
    [{
      ...programFixture(),
      routines: [{ ...programFixture().routines[0], code: "a" }, programFixture().routines[1]],
    }, /already exists/i],
    [{
      ...programFixture(),
      routines: [programFixture().routines[0], { ...programFixture().routines[1], code: "PUSH-1" }],
    }, /must be unique/i],
    [{
      ...programFixture(),
      routines: [{
        ...programFixture().routines[0],
        version: { ...programFixture().routines[0].version, durationMin: 30 },
      }, programFixture().routines[1]],
    }, /target 45 minutes/i],
    [{
      ...programFixture(),
      routines: [{
        ...programFixture().routines[0],
        version: routineVersion("not-available", "Push"),
      }, programFixture().routines[1]],
    }, /not available/i],
    [{
      ...programFixture(),
      routines: [{ ...programFixture().routines[0], rationale: " " }, programFixture().routines[1]],
    }, /rationale is required/i],
    [{
      ...programFixture(),
      routines: [
        programFixture().routines[0],
        { ...programFixture().routines[1], version: routineVersion("ex-1", "Push again") },
      ],
    }, /does not cover.*triceps/i],
    [{
      ...programFixture(),
      routines: [{ ...programFixture().routines[0], version: { focus: "" } }, programFixture().routines[1]],
    }, /Routine name is required/i],
    [{ ...programFixture(), name: "" }, /Program name is required/i],
    [{ ...programFixture(), summary: "x".repeat(501) }, /500 characters/i],
  ];
  for (const [input, message] of invalidPrograms) {
    assert.throws(() => validateGeneratedProgram(input, validationContext), message);
  }
});

test("selected muscle preflight counts primary and secondary tags and reports impossible priorities", () => {
  assert.deepEqual(
    unavailableSelectedMuscleGroups(
      ["chest", "triceps", "calves"],
      validationContext.availableExercises,
    ),
    ["calves"],
  );
  assert.deepEqual(unavailableSelectedMuscleGroups([], validationContext.availableExercises), []);
});

test("Responses API program extraction accepts one forced call and explains malformed responses", () => {
  const validArguments = JSON.stringify(programFixture());
  const response = {
    id: "resp-1",
    status: "completed",
    output: [
      null,
      { type: "message", name: "return_routine_program" },
      { type: "function_call", name: "other", arguments: "{}" },
      { type: "function_call", name: "return_routine_program", arguments: validArguments },
    ],
  };
  assert.equal(generatedProgramFromResponse(response, validationContext).name, "Strong week");

  const invalidResponses: Array<[unknown, RegExp]> = [
    [null, /invalid response/i],
    [{ status: "failed", error: { message: "Safety refusal" } }, /Safety refusal/],
    [{
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    }, /ran out of response capacity/i],
    [{ status: "cancelled" }, /status cancelled/i],
    [{ status: "completed" }, /no program output/i],
    [{ status: "completed", output: [] }, /exactly one/i],
    [{
      status: "completed",
      output: [
        { type: "function_call", name: "return_routine_program", arguments: validArguments },
        { type: "function_call", name: "return_routine_program", arguments: validArguments },
      ],
    }, /exactly one/i],
    [{
      status: "completed",
      output: [{ type: "function_call", name: "return_routine_program", arguments: 3 }],
    }, /invalid routine program arguments/i],
    [{
      status: "completed",
      output: [{ type: "function_call", name: "return_routine_program", arguments: "{" }],
    }, /malformed routine program JSON/i],
  ];
  for (const [input, message] of invalidResponses) {
    assert.throws(() => generatedProgramFromResponse(input, validationContext), message);
  }
});

test("exercise generation context exposes only fields needed to prescribe library exercises", () => {
  const exercise: Exercise = {
    id: "ex-1",
    ownerEmail: "owner@example.com",
    name: "Push-up",
    normalizedName: "push-up",
    equipment: "bodyweight",
    movementPattern: "horizontal_push",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    sideMode: "bilateral",
    instructions: "Keep a rigid torso.",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
    isFavorite: true,
    isActive: true,
    createdAt: "created",
    updatedAt: "updated",
  };
  assert.deepEqual(exerciseGenerationContext([exercise]), [{
    id: "ex-1",
    name: "Push-up",
    equipment: "bodyweight",
    movementPattern: "horizontal_push",
    trackingType: "reps",
    defaultLoadType: "bodyweight",
    sideMode: "bilateral",
    instructions: "Keep a rigid torso.",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
  }]);
  assert.deepEqual(exerciseGenerationContext([]), []);
});
