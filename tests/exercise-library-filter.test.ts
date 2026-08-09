import assert from "node:assert/strict";
import test from "node:test";
import type { Exercise } from "../src/domain/entities";
import {
  exerciseBodyAreaAliases,
  filterExerciseLibrary,
} from "../src/client/routines/exercise-library-filter";

function exercise(overrides: Partial<Exercise> & Pick<Exercise, "id" | "name">): Exercise {
  const { id, name, ...rest } = overrides;
  return {
    id,
    ownerEmail: "owner@example.com",
    name,
    normalizedName: name.trim().toLowerCase(),
    equipment: "none",
    movementPattern: "other",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "",
    muscles: [],
    isFavorite: false,
    isActive: true,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...rest,
  };
}

const hammerCurl = exercise({
  id: "hammer-curl",
  name: "Hammer Curl",
  equipment: "adjustable_dumbbell",
  movementPattern: "elbow_flexion",
  trackingType: "reps",
  sideMode: "per_side",
  muscles: [
    { muscleGroup: "biceps", role: "primary", weight: 1 },
    { muscleGroup: "grip", role: "secondary", weight: 0.5 },
  ],
  isFavorite: true,
});

const tricepsPressdown = exercise({
  id: "triceps-pressdown",
  name: "Triceps Pressdown",
  equipment: "cable",
  movementPattern: "elbow_extension",
  trackingType: "reps",
  sideMode: "bilateral",
  muscles: [{ muscleGroup: "triceps", role: "primary", weight: 1 }],
});

const chestPress = exercise({
  id: "chest-press",
  name: "Chest Press",
  equipment: "barbell",
  movementPattern: "horizontal_push",
  trackingType: "reps",
  sideMode: "bilateral",
  muscles: [
    { muscleGroup: "chest", role: "primary", weight: 1 },
    { muscleGroup: "triceps", role: "secondary", weight: 0.5 },
  ],
  isFavorite: true,
});

const gobletSquat = exercise({
  id: "goblet-squat",
  name: "Goblet Squat",
  equipment: "dumbbell",
  movementPattern: "squat",
  trackingType: "reps",
  sideMode: "bilateral",
  muscles: [
    { muscleGroup: "quads", role: "primary", weight: 1 },
    { muscleGroup: "glutes", role: "secondary", weight: 0.6 },
  ],
  isFavorite: true,
});

const romanianDeadlift = exercise({
  id: "romanian-deadlift",
  name: "Romanian Deadlift",
  equipment: "barbell",
  movementPattern: "hip_hinge",
  trackingType: "reps",
  sideMode: "per_leg",
  muscles: [
    { muscleGroup: "hamstrings", role: "primary", weight: 1 },
    { muscleGroup: "glutes", role: "primary", weight: 0.8 },
    { muscleGroup: "grip", role: "secondary", weight: 0.4 },
  ],
});

const sidePlank = exercise({
  id: "side-plank",
  name: "Side Plank",
  equipment: "bodyweight",
  movementPattern: "anti_rotation",
  trackingType: "duration",
  sideMode: "left_right",
  muscles: [
    { muscleGroup: "core", role: "primary", weight: 1 },
    { muscleGroup: "shoulders", role: "secondary", weight: 0.4 },
  ],
});

const library = [
  tricepsPressdown,
  sidePlank,
  romanianDeadlift,
  hammerCurl,
  gobletSquat,
  chestPress,
];

function ids(matches: ReturnType<typeof filterExerciseLibrary>) {
  return matches.map((match) => match.exercise.id);
}

test("exports the exact friendly body-area taxonomy", () => {
  assert.deepEqual(exerciseBodyAreaAliases, {
    arms: ["biceps", "triceps", "grip"],
    legs: ["quads", "hamstrings", "glutes", "calves"],
    "upper body": ["chest", "back", "shoulders", "biceps", "triceps", "grip"],
  });
});

test("returns every exercise without criteria, ranking favorites and then names without mutating input", () => {
  const originalOrder = library.map((item) => item.id);
  const matches = filterExerciseLibrary(library);

  assert.deepEqual(ids(matches), [
    "chest-press",
    "goblet-squat",
    "hammer-curl",
    "romanian-deadlift",
    "side-plank",
    "triceps-pressdown",
  ]);
  assert.ok(matches.every((match) => match.reasons.length === 0));
  assert.deepEqual(library.map((item) => item.id), originalOrder);
});

test("normalizes case, accents, punctuation, underscores, hyphens, and whitespace across searchable properties", () => {
  const accented = exercise({
    id: "developpe",
    name: "Développé incliné",
    normalizedName: "developpe incline",
    equipment: "Smith-machine",
    movementPattern: "incline_press",
    trackingType: "rounds",
    sideMode: "left_right",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
    isFavorite: true,
  });
  const matches = filterExerciseLibrary([hammerCurl, accented], {
    query: "  DEVELOPPE... smith_machine incline-press ROUNDS left/right FAVORITES  ",
  });

  assert.deepEqual(ids(matches), ["developpe"]);
  assert.deepEqual(matches[0]!.reasons, [
    { kind: "name", value: "Développé incliné", label: "Name · Développé incliné" },
    { kind: "equipment", value: "Smith-machine", label: "Equipment · Smith-machine" },
    { kind: "movementPattern", value: "incline_press", label: "Movement · Incline press" },
    { kind: "trackingType", value: "rounds", label: "Tracking · Rounds" },
    { kind: "sideMode", value: "left_right", label: "Side mode · Left right" },
    { kind: "favorite", value: "favorite", label: "Favorite" },
  ]);
});

test("treats free-text tokens as AND and deduplicates reasons matched by several tokens", () => {
  const matches = filterExerciseLibrary(library, {
    query: "hammer adjustable dumbbell elbow flexion reps per-side favorite biceps primary",
  });

  assert.deepEqual(ids(matches), ["hammer-curl"]);
  assert.deepEqual(matches[0]!.reasons, [
    { kind: "primaryMuscle", value: "biceps", label: "Primary · Biceps" },
    { kind: "name", value: "Hammer Curl", label: "Name · Hammer Curl" },
    { kind: "equipment", value: "adjustable_dumbbell", label: "Equipment · Adjustable dumbbell" },
    { kind: "movementPattern", value: "elbow_flexion", label: "Movement · Elbow flexion" },
    { kind: "trackingType", value: "reps", label: "Tracking · Reps" },
    { kind: "sideMode", value: "per_side", label: "Side mode · Per side" },
    { kind: "favorite", value: "favorite", label: "Favorite" },
  ]);
  assert.deepEqual(filterExerciseLibrary(library, { query: "hammer cable" }), []);
});

test("expands arms, legs, and upper body aliases while ranking primary above secondary muscle matches", () => {
  assert.deepEqual(ids(filterExerciseLibrary([
    chestPress,
    tricepsPressdown,
    hammerCurl,
  ], { query: "arms" })), [
    "hammer-curl",
    "triceps-pressdown",
    "chest-press",
  ]);

  const triceps = filterExerciseLibrary([chestPress, tricepsPressdown], { query: "triceps" });
  assert.deepEqual(ids(triceps), ["triceps-pressdown", "chest-press"]);
  assert.deepEqual(triceps.map((match) => match.reasons[0]?.kind), [
    "primaryMuscle",
    "secondaryMuscle",
  ]);

  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "legs" })), [
    "goblet-squat",
    "romanian-deadlift",
  ]);
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "upper-body cable" })), [
    "triceps-pressdown",
  ]);
  assert.deepEqual(filterExerciseLibrary(library, { query: "arms duration" }), []);
});

test("applies OR within structured categories and AND across them", () => {
  const matches = filterExerciseLibrary(library, {
    muscles: ["chest", "triceps"],
    muscleRole: "primary",
    equipment: ["BARBELL", "cable"],
    movementPatterns: ["horizontal push", "elbow_extension"],
    trackingTypes: ["reps", "duration"],
    sideModes: ["bilateral", "per_side"],
  });

  assert.deepEqual(ids(matches), ["chest-press", "triceps-pressdown"]);
  assert.deepEqual(matches[0]!.reasons, [
    { kind: "primaryMuscle", value: "chest", label: "Primary · Chest" },
    { kind: "equipment", value: "barbell", label: "Equipment · Barbell" },
    { kind: "movementPattern", value: "horizontal_push", label: "Movement · Horizontal push" },
    { kind: "trackingType", value: "reps", label: "Tracking · Reps" },
    { kind: "sideMode", value: "bilateral", label: "Side mode · Bilateral" },
  ]);
});

test("supports any-involvement, primary-only, and secondary-only muscle filters", () => {
  const anyRole = filterExerciseLibrary([chestPress, tricepsPressdown], {
    muscles: ["triceps"],
    muscleRole: "any",
  });
  assert.deepEqual(ids(anyRole), ["triceps-pressdown", "chest-press"]);
  assert.deepEqual(anyRole.map((match) => match.reasons[0]?.kind), [
    "primaryMuscle",
    "secondaryMuscle",
  ]);

  assert.deepEqual(ids(filterExerciseLibrary([chestPress, tricepsPressdown], {
    muscles: ["triceps"],
    muscleRole: "primary",
  })), ["triceps-pressdown"]);

  assert.deepEqual(ids(filterExerciseLibrary([chestPress, tricepsPressdown], {
    muscles: ["triceps"],
    muscleRole: "secondary",
  })), ["chest-press"]);
});

test("binds free-text muscle role qualifiers to the same muscle tag in either order", () => {
  const mixedRoles = exercise({
    id: "mixed-roles",
    name: "Mixed Roles",
    muscles: [
      { muscleGroup: "biceps", role: "primary", weight: 1 },
      { muscleGroup: "triceps", role: "secondary", weight: 0.5 },
    ],
  });

  assert.deepEqual(filterExerciseLibrary([mixedRoles], { query: "secondary biceps" }), []);
  assert.deepEqual(filterExerciseLibrary([mixedRoles], { query: "biceps secondary" }), []);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "primary biceps" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "biceps primary" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "secondary arms" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "upper body secondary" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "secondary upper body" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "primary" })), ["mixed-roles"]);
  assert.deepEqual(ids(filterExerciseLibrary([mixedRoles], { query: "secondary" })), ["mixed-roles"]);
});

test("recognizes intuitive unilateral and side-mode aliases in free text", () => {
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "legs unilateral" })), [
    "romanian-deadlift",
  ]);
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "hamstrings single leg" })), [
    "romanian-deadlift",
  ]);
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "core alternating sides" })), [
    "side-plank",
  ]);
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "biceps one side" })), [
    "hammer-curl",
  ]);
  assert.deepEqual(ids(filterExerciseLibrary(library, { query: "chest both sides" })), [
    "chest-press",
  ]);
});

test("filters favorites and every non-muscle structured property independently", () => {
  const favoriteMatches = filterExerciseLibrary(library, { favoritesOnly: true });
  assert.deepEqual(ids(favoriteMatches), ["chest-press", "goblet-squat", "hammer-curl"]);
  assert.ok(favoriteMatches.every((match) =>
    match.reasons.some((reason) => reason.kind === "favorite")
  ));

  assert.deepEqual(ids(filterExerciseLibrary(library, {
    equipment: ["bodyweight"],
    movementPatterns: ["anti rotation"],
    trackingTypes: ["duration"],
    sideModes: ["left_right"],
  })), ["side-plank"]);
  assert.deepEqual(filterExerciseLibrary([sidePlank], { favoritesOnly: true }), []);
  assert.deepEqual(filterExerciseLibrary([sidePlank], { equipment: ["cable"] }), []);
  assert.deepEqual(filterExerciseLibrary([sidePlank], { movementPatterns: ["squat"] }), []);
  assert.deepEqual(filterExerciseLibrary([sidePlank], { trackingTypes: ["rounds"] }), []);
  assert.deepEqual(filterExerciseLibrary([sidePlank], { sideModes: ["bilateral"] }), []);
});

test("ignores empty structured selections and handles exercises without muscle tags", () => {
  const untagged = exercise({ id: "untagged", name: "Untyped movement" });
  assert.deepEqual(ids(filterExerciseLibrary([untagged], {
    muscles: [],
    equipment: [],
    movementPatterns: [],
    trackingTypes: [],
    sideModes: [],
  })), ["untagged"]);
  assert.deepEqual(filterExerciseLibrary([untagged], { muscles: ["chest"] }), []);
  assert.deepEqual(filterExerciseLibrary([untagged], { query: "upper body" }), []);
});
