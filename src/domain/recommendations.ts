export type RoutineCode = "A" | "B" | "C" | "D";
export type RoutineIdentifier = string;
export type AvailabilityStatus = "recommended" | "available" | "caution" | "unavailable";

export type RecentCompletedSet = {
  routineCode: RoutineIdentifier;
  exerciseOrder: number;
  setType: "warmup" | "regular" | "failure" | "drop" | "emom" | string;
  performedAt: string;
  actualRir?: number | null;
  muscles?: MuscleWeights;
};

export type RecentCompletedSession = {
  routineCode: RoutineIdentifier;
  completedAt: string;
};

export type RoutineRecommendation = {
  code: RoutineIdentifier;
  availability: AvailabilityStatus;
  availabilityLabel: string;
  availabilityReason: string;
  equipmentCompatible: boolean;
  missingEquipment: string[];
  goalReason: string;
  isNextInSequence: boolean;
};

export type RecommendationResult = {
  recommendedRoutineCode: RoutineIdentifier | null;
  recommendationKind: "routine" | "recovery" | "equipment_setup" | "no_plan";
  nextInSequence: RoutineIdentifier | null;
  summary: string;
  routines: RoutineRecommendation[];
};

export type RoutineEquipmentCompatibility = Partial<Record<string, {
  compatible: boolean;
  missingEquipment: string[];
}>>;

export type MuscleGroup = "back" | "chest" | "shoulders" | "biceps" | "triceps" | "quads" | "hamstrings" | "glutes" | "calves" | "core" | "grip";
export type MuscleWeights = Partial<Record<MuscleGroup, number>>;
export type RoutineProfiles = Partial<Record<string, MuscleWeights>>;

const CANONICAL_ROUTINE_ORDER: RoutineCode[] = ["A", "B", "C", "D"];

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
  calves: "calves",
  core: "core",
  grip: "grip",
};

const GOAL_BASE: Record<RoutineCode, number> = { A: 14, B: 12, C: 11, D: 13 };
// This is a product-level, logged-work signal, not a medical recovery claim.
// Keep advisory overlap bounded so an older session cannot linger as a warning.
const RECOVERY_LOOKBACK_HOURS = 48;

export function isCanonicalRoutineCode(code: string): code is RoutineCode {
  return CANONICAL_ROUTINE_ORDER.includes(code as RoutineCode);
}

function uniqueRoutineCodes(codes: readonly string[]) {
  return [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
}

function fallbackMuscles(set: RecentCompletedSet) {
  return isCanonicalRoutineCode(set.routineCode)
    ? EXERCISE_MUSCLES[set.routineCode][set.exerciseOrder] ?? {}
    : {};
}

function hoursBetween(now: Date, value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function timeDecay(hours: number) {
  if (hours < 24) return 1;
  if (hours < 36) return 0.7;
  return 0.45;
}

function setEffortFactor(set: RecentCompletedSet) {
  if (set.setType === "warmup") return 0.25;
  if (set.setType === "failure" || set.setType === "drop") return 1.25;
  if (set.actualRir === null || set.actualRir === undefined || !Number.isFinite(set.actualRir)) {
    return 1;
  }
  if (set.actualRir <= 0) return 1.25;
  if (set.actualRir <= 1) return 1.15;
  if (set.actualRir >= 4) return 0.75;
  return 1;
}

function listMuscles(groups: MuscleGroup[]) {
  const labels = groups.map((group) => MUSCLE_LABELS[group]);
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function formatAge(hours: number) {
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.max(1, Math.round(hours / 24))}d`;
}

function defaultGoalReason(code: RoutineIdentifier) {
  if (code === "A") return "Builds pull-up strength and heavy pressing strength.";
  if (code === "B") return "Adds pull-up volume and upper-body muscle work.";
  if (code === "C") return "Keeps lower-body strength and core work from falling behind.";
  if (code === "D") return "Builds pull-up density, back, arms, and repeatable technique.";
  return "Adds variety while keeping your active routines in rotation.";
}

export function buildRoutineRecommendations(
  sessions: RecentCompletedSession[],
  completedSets: RecentCompletedSet[],
  now = new Date(),
  configuredProfiles?: RoutineProfiles,
  equipmentCompatibility?: RoutineEquipmentCompatibility,
  activeRoutineCodes: readonly string[] = CANONICAL_ROUTINE_ORDER,
): RecommendationResult {
  const routineOrder = uniqueRoutineCodes(activeRoutineCodes);
  if (!routineOrder.length) {
    return {
      recommendedRoutineCode: null,
      recommendationKind: "no_plan",
      nextInSequence: null,
      summary: "No active routines are available to assess. Add or reactivate a routine to continue your plan.",
      routines: [],
    };
  }
  const canonicalPlanOrder = routineOrder.filter(isCanonicalRoutineCode);
  const planOrder = canonicalPlanOrder.length ? canonicalPlanOrder : routineOrder;
  const planCodes = new Set(planOrder);
  const validSessions = sessions
    .filter((session) => planCodes.has(session.routineCode) && Number.isFinite(new Date(session.completedAt).getTime()))
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  const recentSets = completedSets.filter((set) =>
    hoursBetween(now, set.performedAt) < RECOVERY_LOOKBACK_HOURS);
  const recoveryLoad: Partial<Record<MuscleGroup, number>> = {};

  for (const set of recentSets) {
    const muscles = set.muscles ?? fallbackMuscles(set);
    const factor = setEffortFactor(set) * timeDecay(hoursBetween(now, set.performedAt));
    for (const [muscle, weight] of Object.entries(muscles) as Array<[MuscleGroup, number]>) {
      recoveryLoad[muscle] = (recoveryLoad[muscle] ?? 0) + weight * factor;
    }
  }

  const recentCycle = validSessions.slice(0, 8);
  const completionCounts = Object.fromEntries(planOrder.map((code) => [code, 0])) as Record<string, number>;
  const lastCompletion = new Map<string, string>();
  for (const session of recentCycle) {
    completionCounts[session.routineCode] += 1;
    if (!lastCompletion.has(session.routineCode)) lastCompletion.set(session.routineCode, session.completedAt);
  }
  const nextInSequence = [...planOrder].sort((a, b) => {
    const countDifference = completionCounts[a] - completionCounts[b];
    if (countDifference !== 0) return countDifference;
    const lastA = lastCompletion.has(a) ? new Date(lastCompletion.get(a)!).getTime() : 0;
    const lastB = lastCompletion.has(b) ? new Date(lastCompletion.get(b)!).getTime() : 0;
    const recencyDifference = lastA - lastB;
    return recencyDifference || planOrder.indexOf(a) - planOrder.indexOf(b);
  })[0]!;
  const maxCount = Math.max(0, ...Object.values(completionCounts));
  const lowerBodyDue = !validSessions.slice(0, 3).some((session) => session.routineCode === "C");

  const draft = routineOrder.map((code) => {
    const equipment = equipmentCompatibility?.[code] ?? {
      compatible: true,
      missingEquipment: [],
    };
    const profile = configuredProfiles?.[code]
      ?? (isCanonicalRoutineCode(code) ? ROUTINE_PROFILES[code] : {});
    const profileEntries = (Object.entries(profile) as Array<[MuscleGroup, number]>)
      .filter(([, value]) => Number.isFinite(value) && value > 0);
    const profileTotal = profileEntries.reduce((sum, [, value]) => sum + value, 0);
    const muscleOverlap = profileEntries
      .map(([muscle, profileWeight]) => {
        const recoveryRatio = Math.min(1, (recoveryLoad[muscle] ?? 0) / 6);
        return { muscle, contribution: (profileWeight / profileTotal) * recoveryRatio };
      })
      .sort((a, b) => b.contribution - a.contribution);
    const overlapScore = muscleOverlap.reduce((sum, item) => sum + item.contribution, 0);
    const overlappingMuscles = muscleOverlap
      .filter((item) => item.contribution > 0)
      .slice(0, 3)
      .map((item) => item.muscle);
    const relevantSets = recentSets
      .filter((set) => {
        const setMuscles = set.muscles ?? fallbackMuscles(set);
        return overlappingMuscles.some((muscle) => Boolean(setMuscles[muscle]));
      })
      .map((set) => ({ set, hours: hoursBetween(now, set.performedAt) }))
      .sort((a, b) => a.hours - b.hours);
    const newestRelevant = relevantSets[0];
    const newestRelevantHours = newestRelevant?.hours ?? Number.POSITIVE_INFINITY;
    const overlapLevel = overlapScore >= 0.48 ? "high" : overlapScore >= 0.2 ? "moderate" : "low";

    let availability: AvailabilityStatus = "available";
    if (!equipment.compatible) availability = "unavailable";
    else if (!profileTotal || overlapLevel !== "low") availability = "caution";

    const availabilityLabel = availability === "unavailable"
      ? "Unavailable"
      : availability === "caution"
        ? "Use caution"
        : "Available";
    const availabilityReason = availability === "unavailable"
      ? equipment.missingEquipment.length
        ? `Needs ${equipment.missingEquipment.join(" + ")} from your Training setup.`
        : "Required equipment is not available in your Training setup."
      : !profileTotal
        ? "Muscle metadata is missing, so recovery overlap cannot be assessed yet."
        : availability === "caution"
          ? `Routine ${newestRelevant!.set.routineCode} trained ${listMuscles(overlappingMuscles)} ${formatAge(newestRelevantHours)} ago. ${overlapLevel === "high" ? "High" : "Moderate"} overlap is still logged for this routine.`
          : recentSets.length
            ? "Lower overlap with completed sets logged in the past 48 hours."
            : "No completed sets are logged in the past 48 hours. Use how you feel and your warm-up to judge readiness.";

    const lastCompletedAt = lastCompletion.get(code);
    const overdueBonus = lastCompletedAt ? Math.min(18, hoursBetween(now, lastCompletedAt) / 24) : 18;
    const balanceBonus = (maxCount - (completionCounts[code] ?? 0)) * 8;
    const sequenceBonus = code === nextInSequence ? 45 : 0;
    const lowerBodyBonus = code === "C" && lowerBodyDue ? 16 : 0;
    const postLegPullupBonus = code !== "C" && validSessions[0]?.routineCode === "C" ? 6 : 0;
    const goalBase = isCanonicalRoutineCode(code) ? GOAL_BASE[code] : 10;
    const goalScore = goalBase + overdueBonus + balanceBonus + sequenceBonus + lowerBodyBonus + postLegPullupBonus;

    return {
      code,
      availability,
      availabilityLabel,
      availabilityReason,
      equipmentCompatible: equipment.compatible,
      missingEquipment: equipment.missingEquipment,
      goalReason: code === nextInSequence
        ? "Most due in your rolling plan and aligned with its goal balance."
        : defaultGoalReason(code),
      isNextInSequence: code === nextInSequence,
      isPlanRoutine: planCodes.has(code),
      goalScore,
    };
  });

  const candidates = draft.filter((routine) =>
    routine.isPlanRoutine && routine.availability === "available");
  const recommended = [...candidates].sort((a, b) => b.goalScore - a.goalScore)[0];

  const routines = draft.map(({ goalScore: _goalScore, isPlanRoutine: _isPlanRoutine, ...routine }) =>
    routine.code === recommended?.code
      ? { ...routine, availability: "recommended" as const, availabilityLabel: "Recommended" }
      : routine);

  const hasCompatiblePlanRoutine = draft.some((routine) =>
    routine.isPlanRoutine && routine.equipmentCompatible);
  let recommendationKind: RecommendationResult["recommendationKind"] = hasCompatiblePlanRoutine
    ? "recovery"
    : "equipment_setup";
  let summary = hasCompatiblePlanRoutine
    ? "Every equipment-compatible rolling-plan routine needs caution because of recent muscle overlap or missing muscle tags. Consider rest or a lighter session; this is not a medical readiness assessment."
    : "Your rolling-plan routines use equipment outside your Training setup. Ask Coach to adapt them or update the equipment you selected.";
  if (recommended) {
    recommendationKind = "routine";
    if (!validSessions.length && !recentSets.length) {
      summary = `Routine ${recommended.code} is the best equipment-compatible starting point in your rolling plan. No recent completed sets are logged, so use how you feel and your warm-up to judge readiness.`;
    } else if (!recentSets.length) {
      summary = `Routine ${recommended.code} best preserves the rolling plan. No completed sets are logged in the past 48 hours, which is not evidence of recovery; use how you feel and your warm-up to decide.`;
    } else if (recommended.code === nextInSequence) {
      summary = "It keeps your rolling plan balanced and has lower overlap with recently logged sets.";
    } else if (recommended.code === "C" && lowerBodyDue) {
      summary = "Lower-body work is due and has lower overlap with your recently logged work.";
    } else if (recommended.code !== "C") {
      summary = "It advances your upper-body goal with lower overlap against recently logged sets.";
    } else {
      summary = "It is the highest-scoring fit for balanced progress with lower recent logged overlap.";
    }
  }

  return {
    recommendedRoutineCode: recommended?.code ?? null,
    recommendationKind,
    nextInSequence,
    summary,
    routines,
  };
}
