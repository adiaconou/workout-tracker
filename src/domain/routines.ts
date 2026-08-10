import type { ExerciseMuscle, MuscleGroup } from "./entities";

export type CanonicalExercise = {
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
  loadType: "external" | "bodyweight" | "assistance" | "added";
};

export type CanonicalRoutine = {
  code: "A" | "B" | "C" | "D";
  focus: string;
  summary: string;
  durationMin: number;
  exercises: CanonicalExercise[];
};

export type LegacyRoutineExerciseMuscleTemplate = {
  name: string;
  muscles: ExerciseMuscle[];
};

const primary = (muscleGroup: MuscleGroup, weight = 1): ExerciseMuscle => ({
  muscleGroup,
  role: "primary",
  weight,
});

const secondary = (muscleGroup: MuscleGroup, weight: number): ExerciseMuscle => ({
  muscleGroup,
  role: "secondary",
  weight,
});

// Exact-name templates for exercises seeded by the historical A-D routines.
// They remain separate from the home-gym catalog because these rows have no
// stable default template key in older databases.
export const legacyRoutineExerciseMuscleTemplates: LegacyRoutineExerciseMuscleTemplate[] = [
  { name: "Strict pull-up", muscles: [primary("back"), secondary("biceps", 0.45), secondary("grip", 0.25)] },
  { name: "Barbell bench press", muscles: [primary("chest"), secondary("triceps", 0.6), secondary("shoulders", 0.45)] },
  { name: "Chest-supported dumbbell row", muscles: [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.25)] },
  { name: "Neutral-grip dumbbell chest press", muscles: [primary("chest"), secondary("triceps", 0.5), secondary("shoulders", 0.35)] },
  { name: "Weighted plank", muscles: [primary("core")] },
  { name: "Cable triceps pressdown", muscles: [primary("triceps")] },
  { name: "Assisted pull-up", muscles: [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.25)] },
  { name: "Barbell overhead press", muscles: [primary("shoulders"), secondary("triceps", 0.55)] },
  { name: "Incline dumbbell press", muscles: [primary("chest"), secondary("shoulders", 0.6), secondary("triceps", 0.4)] },
  { name: "One-arm dumbbell row", muscles: [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.25)] },
  { name: "Dumbbell lateral raise", muscles: [primary("shoulders")] },
  { name: "Barbell or dumbbell curl", muscles: [primary("biceps")] },
  { name: "Hanging knee raise", muscles: [primary("core"), secondary("grip", 0.3)] },
  { name: "Kettlebell swing", muscles: [primary("glutes"), secondary("hamstrings", 0.7), secondary("core", 0.3), secondary("grip", 0.3)] },
  { name: "Double-dumbbell front squat", muscles: [primary("quads"), secondary("glutes", 0.7), secondary("core", 0.3)] },
  { name: "Dumbbell Romanian deadlift", muscles: [primary("hamstrings"), primary("glutes", 0.8), secondary("grip", 0.35)] },
  { name: "Rear-foot-elevated dumbbell split squat", muscles: [primary("quads", 0.8), primary("glutes"), secondary("hamstrings", 0.3)] },
  { name: "Reverse crunch", muscles: [primary("core")] },
  { name: "Side plank", muscles: [primary("core"), secondary("shoulders", 0.25)] },
  { name: "Strict pull-up EMOM", muscles: [primary("back"), secondary("biceps", 0.5), secondary("grip", 0.3)] },
  { name: "Bodyweight or weighted dip", muscles: [primary("chest"), primary("triceps", 0.8), secondary("shoulders", 0.5)] },
  { name: "Lat pulldown", muscles: [primary("back"), secondary("biceps", 0.4), secondary("grip", 0.2)] },
  { name: "Seated cable row", muscles: [primary("back"), secondary("biceps", 0.4), secondary("grip", 0.2)] },
  { name: "Cable rear-delt fly", muscles: [primary("shoulders"), secondary("back", 0.35)] },
  { name: "Barbell curl", muscles: [primary("biceps")] },
  { name: "Kneeling cable crunch", muscles: [primary("core")] },
  { name: "Dumbbell curl", muscles: [primary("biceps")] },
  { name: "Seated cable crunch", muscles: [primary("core")] },
];

export const canonicalRoutines: CanonicalRoutine[] = [
  {
    code: "A",
    focus: "Pull-up and pressing strength",
    summary: "Strict pull-ups first, heavy bench press, balanced chest and back volume, plus core and triceps.",
    durationMin: 60,
    exercises: [
      { name: "Strict pull-up", warmup: "1×6 scapular; 1×3 assisted", warmupSets: 2, regularSets: 5, failureSets: 0, dropSets: 0, target: "2 reps", rest: "3 min", effort: "≈2 RIR", purpose: "Direct pull-up strength practice", loadType: "bodyweight" },
      { name: "Barbell bench press", warmup: "Bar×10; 50%×5; 70%×3", warmupSets: 3, regularSets: 4, failureSets: 0, dropSets: 0, target: "5–7 reps", rest: "3 min", effort: "1–2 RIR", purpose: "Main heavy chest, shoulder, and triceps lift", loadType: "external" },
      { name: "Chest-supported dumbbell row", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "6–10 reps", rest: "2 min", effort: "1–2 RIR", purpose: "Builds lats and upper back without lower-back fatigue", loadType: "external" },
      { name: "Neutral-grip dumbbell chest press", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "2 min", effort: "1–2 RIR", purpose: "Adds chest and triceps volume", loadType: "external" },
      { name: "Weighted plank", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "30–45 sec", rest: "1 min", effort: "Controlled hold", purpose: "Builds trunk stiffness and core strength", loadType: "external" },
      { name: "Cable triceps pressdown", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 0, dropSets: 0, target: "10–15 reps", rest: "1 min", effort: "1–2 RIR", purpose: "Direct triceps work to support pressing", loadType: "external" },
    ],
  },
  {
    code: "B",
    focus: "Pull-up volume and upper-body muscle",
    summary: "Assisted pull-ups, shoulders, upper chest, back, arms, and abs.",
    durationMin: 60,
    exercises: [
      { name: "Assisted pull-up", warmup: "1 easy set×5", warmupSets: 1, regularSets: 4, failureSets: 0, dropSets: 0, target: "6–8 reps", rest: "2 min", effort: "≈2 RIR", purpose: "Builds pull-up-specific volume and endurance", loadType: "assistance" },
      { name: "Barbell overhead press", warmup: "Bar×10; light×5", warmupSets: 2, regularSets: 3, failureSets: 0, dropSets: 0, target: "6–8 reps", rest: "2.5 min", effort: "1–2 RIR", purpose: "Builds shoulder and triceps strength", loadType: "external" },
      { name: "Incline dumbbell press", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "2 min", effort: "1–2 RIR", purpose: "Emphasizes upper chest and front delts", loadType: "external" },
      { name: "One-arm dumbbell row", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–12/side", rest: "90 sec after both", effort: "1–2 RIR", purpose: "Builds lats and upper back one side at a time", loadType: "external" },
      { name: "Dumbbell lateral raise", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 1, dropSets: 1, target: "12–15 regular; 12–20 failure; 8–12 drop", rest: "1 min; no rest before drop", effort: "Final set to technical failure", purpose: "Builds shoulder width with limited failure and drop work", loadType: "external" },
      { name: "Barbell or dumbbell curl", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "1 min", effort: "1–2 RIR", purpose: "Strengthens biceps for pull-ups and arm development", loadType: "external" },
      { name: "Hanging knee raise", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–15 reps", rest: "1 min", effort: "Controlled reps", purpose: "Trains abs, hanging comfort, and grip", loadType: "bodyweight" },
    ],
  },
  {
    code: "C",
    focus: "Dumbbell leg strength and core",
    summary: "A focused lower-body session using dumbbells and kettlebells, finished with direct core work.",
    durationMin: 60,
    exercises: [
      { name: "Kettlebell swing", warmup: "1 light set×10", warmupSets: 1, regularSets: 4, failureSets: 0, dropSets: 0, target: "8 reps", rest: "90 sec", effort: "Fast, crisp reps", purpose: "Trains explosive hip extension", loadType: "external" },
      { name: "Double-dumbbell front squat", warmup: "Light DBs×8; moderate DBs×5", warmupSets: 2, regularSets: 4, failureSets: 0, dropSets: 0, target: "6–10 reps", rest: "3 min", effort: "1–2 RIR", purpose: "Primary quad and glute strength exercise", loadType: "external" },
      { name: "Dumbbell Romanian deadlift", warmup: "1 light set×8", warmupSets: 1, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "2.5 min", effort: "1–2 RIR", purpose: "Builds hamstrings, glutes, and hip hinge", loadType: "external" },
      { name: "Rear-foot-elevated dumbbell split squat", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 0, dropSets: 0, target: "8–10/leg", rest: "2 min after both", effort: "1–2 RIR", purpose: "Builds single-leg strength and stability", loadType: "external" },
      { name: "Reverse crunch", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "10–15 reps", rest: "1 min", effort: "Controlled reps", purpose: "Trains abdominal and pelvic control", loadType: "bodyweight" },
      { name: "Side plank", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "30–45 sec/side", rest: "1 min after both", effort: "Controlled hold", purpose: "Builds oblique and lateral-core strength", loadType: "bodyweight" },
    ],
  },
  {
    code: "D",
    focus: "Pull-up density, back, arms, and core",
    summary: "EMOM pull-up singles for repeatability, followed by a complete upper-body and core session.",
    durationMin: 60,
    exercises: [
      { name: "Strict pull-up EMOM", warmup: "1×6 scapular; 1×3 assisted", warmupSets: 2, regularSets: 10, failureSets: 0, dropSets: 0, target: "1 rep/round", rest: "Start every minute", effort: "All reps crisp", purpose: "Improves pull-up technique and repeatability", loadType: "bodyweight" },
      { name: "Bodyweight or weighted dip", warmup: "1 easy set×5", warmupSets: 1, regularSets: 3, failureSets: 0, dropSets: 0, target: "6–10 reps", rest: "2 min", effort: "1–2 RIR", purpose: "Builds chest, shoulder, and triceps strength", loadType: "added" },
      { name: "Lat pulldown", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "2 min", effort: "1–2 RIR", purpose: "Adds loadable vertical-pulling volume", loadType: "external" },
      { name: "Seated cable row", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "10–12 reps", rest: "90 sec", effort: "1–2 RIR", purpose: "Adds upper-back and lat volume", loadType: "external" },
      { name: "Cable rear-delt fly", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 1, dropSets: 0, target: "15–20 regular; 15–25 failure", rest: "1 min", effort: "Final set to technical failure", purpose: "Balances pressing and develops rear shoulders", loadType: "external" },
      { name: "Barbell curl", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 0, dropSets: 0, target: "8–12 reps", rest: "Superset", effort: "1–2 RIR", purpose: "Direct biceps work before pressdowns", loadType: "external" },
      { name: "Cable triceps pressdown", warmup: "None", warmupSets: 0, regularSets: 2, failureSets: 0, dropSets: 0, target: "10–15 reps", rest: "90 sec after both", effort: "1–2 RIR", purpose: "Direct triceps work in an arm superset", loadType: "external" },
      { name: "Kneeling cable crunch", warmup: "None", warmupSets: 0, regularSets: 3, failureSets: 0, dropSets: 0, target: "10–15 reps", rest: "1 min", effort: "Controlled reps", purpose: "Progressively loadable abdominal work", loadType: "external" },
    ],
  },
];
