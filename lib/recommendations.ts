export type RoutineCode = "A" | "B" | "C" | "D";
export type AvailabilityStatus = "available" | "caution" | "recovering";

export type RecentCompletedSet = {
  routineCode: RoutineCode;
  exerciseOrder: number;
  setType: "warmup" | "regular" | "failure" | "drop" | "emom" | string;
  performedAt: string;
  muscles?: MuscleWeights;
};

export type RecentCompletedSession = {
  routineCode: RoutineCode;
  completedAt: string;
};

export type RoutineRecommendation = {
  code: RoutineCode;
  availability: AvailabilityStatus;
  availabilityLabel: string;
  availabilityReason: string;
  goalReason: string;
  isRecommended: boolean;
  isNextInSequence: boolean;
};

export type RecommendationResult = {
  recommendedRoutineCode: RoutineCode | null;
  nextInSequence: RoutineCode;
  summary: string;
  routines: RoutineRecommendation[];
};

export type MuscleGroup = "back" | "chest" | "shoulders" | "biceps" | "triceps" | "quads" | "hamstrings" | "glutes" | "core" | "grip";
export type MuscleWeights = Partial<Record<MuscleGroup, number>>;
export type RoutineProfiles = Partial<Record<RoutineCode, MuscleWeights>>;

const ROUTINE_ORDER: RoutineCode[] = ["A", "B", "C", "D"];

export const EXERCISE_MUSCLES: Record<RoutineCode, Record<number, MuscleWeights>> = {
  A: {
    1: { back: 1, biceps: 0.45, grip: 0.25 },
    2: { chest: 1, triceps: 0.6, shoulders: 0.45 },
    3: { back: 1, biceps: 0.5 },
    4: { chest: 1, triceps: 0.5, shoulders: 0.35 },
    5: { core: 1 },
    6: { triceps: 1 },
  },
  B: {
    1: { back: 1, biceps: 0.5, grip: 0.25 },
    2: { shoulders: 1, triceps: 0.55 },
    3: { chest: 1, shoulders: 0.6, triceps: 0.4 },
    4: { back: 1, biceps: 0.5 },
    5: { shoulders: 1 },
    6: { biceps: 1 },
    7: { core: 1, grip: 0.3 },
  },
  C: {
    1: { glutes: 1, hamstrings: 0.7, core: 0.3 },
    2: { quads: 1, glutes: 0.7, core: 0.3 },
    3: { hamstrings: 1, glutes: 0.8 },
    4: { quads: 0.8, glutes: 1, hamstrings: 0.3 },
    5: { core: 1 },
    6: { core: 1 },
  },
  D: {
    1: { back: 1, biceps: 0.5, grip: 0.3 },
    2: { chest: 1, triceps: 0.8, shoulders: 0.5 },
    3: { back: 1, biceps: 0.4 },
    4: { back: 1, biceps: 0.4 },
    5: { shoulders: 1, back: 0.35 },
    6: { biceps: 1 },
    7: { triceps: 1 },
    8: { core: 1 },
  },
};

const ROUTINE_PROFILES: Record<RoutineCode, MuscleWeights> = {
  A: { back: 8, chest: 7, shoulders: 3, biceps: 3, triceps: 5, core: 3, grip: 1 },
  B: { back: 7, chest: 3, shoulders: 7, biceps: 5, triceps: 3, core: 3, grip: 1 },
  C: { quads: 6, hamstrings: 6, glutes: 10, core: 6 },
  D: { back: 16, chest: 3, shoulders: 5, biceps: 8, triceps: 5, core: 3, grip: 3 },
};

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  back: "upper back and lats",
  chest: "chest",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  core: "core",
  grip: "grip",
};

const GOAL_BASE: Record<RoutineCode, number> = { A: 14, B: 12, C: 11, D: 13 };

function hoursBetween(now: Date, value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function timeDecay(hours: number) {
  if (hours < 24) return 1;
  if (hours < 36) return 0.7;
  if (hours < 48) return 0.45;
  if (hours < 72) return 0.18;
  return 0;
}

function setEffortFactor(setType: string) {
  if (setType === "warmup") return 0.25;
  if (setType === "failure" || setType === "drop") return 1.25;
  return 1;
}

function nextRoutine(code?: RoutineCode): RoutineCode {
  if (!code) return "A";
  return ROUTINE_ORDER[(ROUTINE_ORDER.indexOf(code) + 1) % ROUTINE_ORDER.length];
}

function listMuscles(groups: MuscleGroup[]) {
  const labels = groups.map((group) => MUSCLE_LABELS[group]);
  if (labels.length <= 1) return labels[0] ?? "the same muscles";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function formatAge(hours: number) {
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.max(1, Math.round(hours / 24))}d`;
}

function defaultGoalReason(code: RoutineCode) {
  if (code === "A") return "Builds pull-up strength and heavy pressing strength.";
  if (code === "B") return "Adds pull-up volume and upper-body muscle work.";
  if (code === "C") return "Keeps lower-body strength and core work from falling behind.";
  return "Builds pull-up density, back, arms, and repeatable technique.";
}

export function buildRoutineRecommendations(
  sessions: RecentCompletedSession[],
  completedSets: RecentCompletedSet[],
  now = new Date(),
  configuredProfiles?: RoutineProfiles,
): RecommendationResult {
  const validSessions = sessions
    .filter((session) => ROUTINE_ORDER.includes(session.routineCode) && Number.isFinite(new Date(session.completedAt).getTime()))
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  const recentSets = completedSets.filter((set) => hoursBetween(now, set.performedAt) < 72);
  const recoveryLoad: Partial<Record<MuscleGroup, number>> = {};

  for (const set of recentSets) {
    const muscles = set.muscles ?? EXERCISE_MUSCLES[set.routineCode]?.[set.exerciseOrder] ?? {};
    const factor = setEffortFactor(set.setType) * timeDecay(hoursBetween(now, set.performedAt));
    for (const [muscle, weight] of Object.entries(muscles) as Array<[MuscleGroup, number]>) {
      recoveryLoad[muscle] = (recoveryLoad[muscle] ?? 0) + weight * factor;
    }
  }

  const nextInSequence = nextRoutine(validSessions[0]?.routineCode);
  const recentCycle = validSessions.slice(0, 8);
  const completionCounts = Object.fromEntries(ROUTINE_ORDER.map((code) => [code, 0])) as Record<RoutineCode, number>;
  const lastCompletion = new Map<RoutineCode, string>();
  for (const session of recentCycle) {
    completionCounts[session.routineCode] += 1;
    if (!lastCompletion.has(session.routineCode)) lastCompletion.set(session.routineCode, session.completedAt);
  }
  const maxCount = Math.max(...Object.values(completionCounts));
  const lowerBodyDue = !validSessions.slice(0, 3).some((session) => session.routineCode === "C");

  const draft = ROUTINE_ORDER.map((code) => {
    const profile = configuredProfiles?.[code] ?? ROUTINE_PROFILES[code];
    const profileTotal = Object.values(profile).reduce((sum, value) => sum + (value ?? 0), 0);
    const muscleOverlap = (Object.entries(profile) as Array<[MuscleGroup, number]>)
      .map(([muscle, profileWeight]) => {
        const recoveryRatio = Math.min(1, (recoveryLoad[muscle] ?? 0) / 6);
        return { muscle, contribution: (profileWeight / profileTotal) * recoveryRatio };
      })
      .sort((a, b) => b.contribution - a.contribution);
    const overlapScore = muscleOverlap.reduce((sum, item) => sum + item.contribution, 0);
    const overlappingMuscles = muscleOverlap.filter((item) => item.contribution >= 0.025).slice(0, 3).map((item) => item.muscle);
    const relevantSetAges = recentSets
      .filter((set) => {
        const setMuscles = set.muscles ?? EXERCISE_MUSCLES[set.routineCode]?.[set.exerciseOrder] ?? {};
        return overlappingMuscles.some((muscle) => Boolean(setMuscles[muscle]));
      })
      .map((set) => hoursBetween(now, set.performedAt));
    const newestRelevantHours = relevantSetAges.length ? Math.min(...relevantSetAges) : Number.POSITIVE_INFINITY;

    let availability: AvailabilityStatus = "available";
    if (overlapScore >= 0.48 && newestRelevantHours < 30) availability = "recovering";
    else if (overlapScore >= 0.2) availability = "caution";

    const availabilityLabel = availability === "available"
      ? "Available"
      : availability === "caution"
        ? "Available with caution"
        : "Recovering";
    const availabilityReason = availability === "available"
      ? recentSets.length
        ? "Low overlap with your completed sets from the past 72 hours."
        : "No completed sets in the past 72 hours."
      : `${listMuscles(overlappingMuscles)} were trained ${formatAge(newestRelevantHours)} ago.`;

    const lastCompletedAt = lastCompletion.get(code);
    const overdueBonus = lastCompletedAt ? Math.min(18, hoursBetween(now, lastCompletedAt) / 24) : 18;
    const balanceBonus = (maxCount - completionCounts[code]) * 8;
    const sequenceBonus = code === nextInSequence ? 45 : 0;
    const lowerBodyBonus = code === "C" && lowerBodyDue ? 16 : 0;
    const postLegPullupBonus = code !== "C" && validSessions[0]?.routineCode === "C" ? 6 : 0;
    const goalScore = GOAL_BASE[code] + overdueBonus + balanceBonus + sequenceBonus + lowerBodyBonus + postLegPullupBonus;

    return {
      code,
      availability,
      availabilityLabel,
      availabilityReason,
      goalReason: code === nextInSequence
        ? "Next in your rolling sequence and aligned with the plan's goal balance."
        : defaultGoalReason(code),
      isRecommended: false,
      isNextInSequence: code === nextInSequence,
      goalScore,
    };
  });

  const availableCandidates = draft.filter((routine) => routine.availability === "available");
  const candidates = availableCandidates.length
    ? availableCandidates
    : draft.filter((routine) => routine.availability === "caution");
  const recommended = [...candidates].sort((a, b) => b.goalScore - a.goalScore)[0];

  const routines = draft.map(({ goalScore: _goalScore, ...routine }) => ({
    ...routine,
    isRecommended: routine.code === recommended?.code,
  }));

  let summary = "Recovery is the best goal-aligned choice today; every routine has substantial recent overlap.";
  if (recommended) {
    if (!validSessions.length) summary = "Start with pull-up strength and pressing, then continue the rolling plan.";
    else if (recommended.code === nextInSequence) summary = "It keeps your rolling plan balanced and is sufficiently recovered.";
    else if (recommended.code === "C" && lowerBodyDue) summary = "Lower-body work is due and avoids your recent upper-body fatigue.";
    else if (recommended.code !== "C") summary = "It moves your pull-up goal forward using muscles that are available today.";
    else summary = "It is the strongest available fit for balanced progress today.";
  }

  return {
    recommendedRoutineCode: recommended?.code ?? null,
    nextInSequence,
    summary,
    routines,
  };
}
