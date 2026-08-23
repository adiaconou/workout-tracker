export type CoachProfile = {
  model: string;
  reasoningEffort: string;
};

export type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  activities?: CoachToolActivity[];
  model: string | null;
  reasoningEffort: string | null;
  createdAt: string;
};

export type CoachToolActivity = {
  name: string;
  status: "succeeded" | "failed";
};

export type CoachToolActivityRow = {
  key: string;
  label: string;
  tone: "success" | "error";
};

type ChangePlanBase = {
  id: string;
  summary: string;
  rationale: string;
  diff: string[];
  status: "pending" | "applying" | "applied" | "rejected" | "stale";
};

export type RoutineChangePlan = ChangePlanBase & {
  kind: "routine";
  action: "create" | "update";
  routineCode: string;
  proposedRoutine: {
    focus: string;
    durationMin: number;
    exercises: unknown[];
  };
};

export type ExerciseChangePlan = ChangePlanBase & {
  kind: "exercise";
  action: "create" | "update" | "archive";
  exerciseName: string;
};

export type ChangePlan = RoutineChangePlan | ExerciseChangePlan;

export type ModelOption = {
  id: string;
  label: string;
  created: number;
  reasoningEfforts: string[];
};

export type CoachBootstrap = {
  profile: CoachProfile;
  threads: AssistantThread[];
  thread: AssistantThread;
  messages: AssistantMessage[];
  plans: ChangePlan[];
  models: ModelOption[];
  modelConfiguration: {
    configured: boolean;
    source: "live" | "fallback";
    defaultModel: string;
  };
};

export type ModelSelection = Pick<CoachProfile, "model" | "reasoningEffort">;

export type SendMessageResponse = {
  thread: AssistantThread;
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
  plans: ChangePlan[];
};

export type PlanApplyResponse =
  | { plan: RoutineChangePlan; published: boolean }
  | { plan: ExerciseChangePlan };

export type PlanActionFeedback = {
  planId: string;
  message: string;
  tone: "success" | "error";
};

const coachToolActivityLabels: Record<string, readonly [string, string]> = {
  get_coaching_context: ["Reviewed your routines and training context", "Couldn’t review your training context"],
  get_routine: ["Checked the current routine", "Couldn’t check the current routine"],
  list_routine_versions: ["Reviewed saved routine versions", "Couldn’t review saved routine versions"],
  search_exercises: ["Searched available exercises", "Couldn’t search available exercises"],
  get_exercise: ["Checked an exercise", "Couldn’t check an exercise"],
  get_workout_history: ["Reviewed recent workouts", "Couldn’t review recent workouts"],
  get_active_workout: ["Checked for an active workout", "Couldn’t check for an active workout"],
  propose_new_routine: ["Prepared a new routine for review", "Couldn’t prepare the new routine"],
  propose_routine_change: ["Prepared a routine change for review", "Couldn’t prepare the routine change"],
  propose_exercise_change: ["Prepared an exercise-library change for review", "Couldn’t prepare the exercise-library change"],
};

const legacyDiffLabels: Readonly<Record<string, string>> = {
  position: "Position",
  type: "Set type",
  "target type": "Target type",
  "target minimum": "Minimum target",
  "target maximum": "Maximum target",
  "display target": "Displayed target",
  "rir minimum": "Minimum RIR",
  "rir maximum": "Maximum RIR",
  "rest seconds": "Rest after set",
  "rest rule": "Rest timing",
  "load instruction": "Load guidance",
  "side mode": "Side mode",
  "superset group": "Superset group",
  instructions: "Instructions",
  tempo: "Tempo",
  notes: "Notes",
};

const legacyDiffOptionLabels: Readonly<Record<string, string>> = {
  warmup: "Warm-up",
  regular: "Regular",
  failure: "Failure",
  drop: "Drop",
  emom: "EMOM",
  test: "Test",
  reps: "Reps",
  duration: "Duration",
  rounds: "Rounds",
  standard: "Standard",
  after_both_sides: "After both sides",
  no_rest_before_drop: "No rest before drop",
  after_superset: "After superset",
  bilateral: "Bilateral",
  per_side: "Per side",
  per_leg: "Per leg",
  left_right: "Left / right",
  external: "External",
  bodyweight: "Bodyweight",
  added: "Added",
  assistance: "Assistance",
};

const legacyKeyPattern = Object.keys(legacyDiffLabels)
  .sort((left, right) => right.length - left.length)
  .join("|");

export function readablePlanDiff(change: string) {
  if (
    change.includes("→")
    || change.includes("—")
    || /^(?:Create routine with code|Add exercise:|Remove exercise:)/u.test(change)
  ) {
    return change;
  }
  if (!isLegacyPlanDiff(change)) return change;

  let readable = decodeLegacyJsonStrings(change)
    .replace(/ -> /gu, " → ")
    .replace(/^Create routine code /u, "Create routine with code ")
    .replace(/ · (add|remove) set: position=(\d+);?\s*/giu, (_match, action: string, position: string) => (
      ` · ${action[0]!.toUpperCase()}${action.slice(1).toLowerCase()} set ${position} — `
    ))
    .replace(/^Remove (.+) placement at position (\d+): position=\2;?\s*/iu, "Remove exercise: $1 (position $2) — ")
    .replace(/^Add (.+): position=(\d+);?\s*/iu, "Add exercise: $1 (position $2) — ")
    .replace(/(.+?) placement at position (\d+)/giu, "$1 (position $2)")
    .replace(/ · exercise position:/giu, " · Position:")
    .replace(/ · exercise instructions:/giu, " · Instructions:")
    .replace(/ · exercise notes:/giu, " · Notes:")
    .replace(/ · exercise:/giu, " · Exercise name:")
    .replace(/ · superset group:/giu, " · Superset group:")
    .replace(/ · set (\d+) · ([^:]+):/giu, (match, position: string, label: string) => {
      const readableLabel = legacyDiffLabels[label.toLowerCase()];
      return readableLabel ? ` · Set ${position} · ${readableLabel}:` : match;
    })
    .replace(new RegExp(`(^|[:;—]\\s)(${legacyKeyPattern})=`, "giu"), (_match, prefix: string, label: string) => (
      `${prefix}${legacyDiffLabels[label.toLowerCase()]!}: `
    ))
    .replace(/Estimated duration \(minutes\):/giu, "Estimated duration:")
    .replace(/; movement:/giu, "; Movement:")
    .replace(/; loading:/giu, "; Loading:")
    .replace(/; side mode:/giu, "; Side mode:");

  readable = readable.replace(
    /\b(Set type|Target type|Rest timing|Side mode|Tracking|Loading): ([^;]+)/giu,
    (_match, label: string, values: string) => `${label}: ${values.replace(
      /\b(warmup|regular|failure|drop|emom|test|reps|duration|rounds|standard|after_both_sides|no_rest_before_drop|after_superset|bilateral|per_side|per_leg|left_right|external|bodyweight|added|assistance)\b/gu,
      (value) => legacyDiffOptionLabels[value]!,
    )}`,
  );
  return readable
    .replace(/([.!?]);/gu, ";")
    .replace(/(:\s)none(?=\s→|[;.]|$)/gu, "$1Not set")
    .replace(/(→\s)none(?=[;.]|$)/gu, "$1Not set");
}

function isLegacyPlanDiff(change: string) {
  return / -> |(?:^|[:;]\s)(?:position|type|target type|target minimum|target maximum|display target|RIR minimum|RIR maximum|rest seconds|rest rule|load instruction|side mode|superset group|instructions|tempo|notes)=/iu.test(change)
    || /\b(?:after_both_sides|no_rest_before_drop|after_superset|per_side|per_leg|left_right)\b/u.test(change)
    || /^(?:Create routine code|Add "|Archive "|Remove ")/u.test(change)
    || /(?:Instructions|Routine name|Routine summary): (?:none|")/iu.test(change)
    || /^Equipment: .*; movement:|^Tracking: .*; loading:/iu.test(change);
}

function decodeLegacyJsonStrings(change: string) {
  return change.replace(/("(?:\\.|[^"\\])*")(\.)?/gu, (_match, token: string, trailingPeriod: string | undefined) => {
    try {
      const parsed = JSON.parse(token) as string;
      const readable = parsed || "None";
      return readable + (trailingPeriod && !/[.!?]$/u.test(readable) ? trailingPeriod : "");
    } catch {
      return token + (trailingPeriod ?? "");
    }
  });
}

export function coachToolActivityRows(activities: readonly CoachToolActivity[] | undefined) {
  const seen = new Set<string>();
  const rows: CoachToolActivityRow[] = [];
  for (const activity of activities ?? []) {
    const key = `${activity.name}:${activity.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const labels = coachToolActivityLabels[activity.name];
    const succeeded = activity.status === "succeeded";
    rows.push({
      key,
      label: labels?.[succeeded ? 0 : 1]
        ?? (succeeded ? "Completed a coaching step" : "A coaching step failed"),
      tone: succeeded ? "success" : "error",
    });
  }
  return rows;
}

export function selectionFromProfile(profile: CoachProfile): ModelSelection {
  return { model: profile.model, reasoningEffort: profile.reasoningEffort };
}

export function selectedModelOption(
  models: readonly ModelOption[] | undefined,
  modelId: string | undefined,
) {
  return models?.find((model) => model.id === modelId) ?? models?.[0] ?? null;
}

export function modelSelectionForOption(
  selection: ModelSelection,
  model: ModelOption,
): ModelSelection {
  const reasoningEffort = model.reasoningEfforts.includes(selection.reasoningEffort)
    ? selection.reasoningEffort
    : model.reasoningEfforts.includes("medium")
      ? "medium"
      : "auto";
  return { model: model.id, reasoningEffort };
}

export function refreshedModelSelection(
  models: readonly ModelOption[],
  defaultModel: string,
  selection: ModelSelection,
): ModelSelection {
  const model = models.some((option) => option.id === selection.model)
    ? selection.model
    : defaultModel;
  const option = models.find((candidate) => candidate.id === model);
  const reasoningEffort = option?.reasoningEfforts.includes(selection.reasoningEffort)
    ? selection.reasoningEffort
    : "auto";
  return { model, reasoningEffort };
}

export function bootstrapWithProfile(
  current: CoachBootstrap | null,
  profile: CoachProfile,
) {
  return current
    ? { ...current, profile: { ...current.profile, ...profile } }
    : current;
}

export function bootstrapWithPreservedActivities(
  current: CoachBootstrap | null,
  payload: CoachBootstrap,
) {
  if (!current || current.thread.id !== payload.thread.id) return payload;
  const activitiesByMessageId = new Map(current.messages
    .filter((message) => message.activities?.length)
    .map((message) => [message.id, message.activities]));
  return {
    ...payload,
    messages: payload.messages.map((message) => ({
      ...message,
      activities: message.activities ?? activitiesByMessageId.get(message.id),
    })),
  };
}

export function modelSaveFailure(
  previous: ModelSelection,
  caught: unknown,
) {
  return {
    selection: previous,
    error: caught instanceof Error
      ? caught.message
      : "The model setting could not be saved.",
  };
}

export function optimisticUserMessage(input: {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
}): AssistantMessage {
  return {
    ...input,
    role: "user",
    model: null,
    reasoningEffort: null,
  };
}

export function bootstrapWithOptimisticMessage(
  current: CoachBootstrap | null,
  message: AssistantMessage,
) {
  return current
    ? { ...current, messages: [...current.messages, message] }
    : current;
}

export function bootstrapWithSendResponse(
  current: CoachBootstrap | null,
  activeThreadId: string,
  optimisticMessageId: string,
  payload: SendMessageResponse,
  selection: ModelSelection,
) {
  if (!current || current.thread.id !== activeThreadId) return current;
  return {
    ...current,
    thread: payload.thread,
    threads: current.threads.map((thread) => (
      thread.id === payload.thread.id ? payload.thread : thread
    )),
    messages: [
      ...current.messages.filter((message) => message.id !== optimisticMessageId),
      payload.userMessage,
      payload.assistantMessage,
    ],
    plans: payload.plans,
    profile: { ...current.profile, ...selection },
  };
}

export function bootstrapWithoutOptimisticMessage(
  current: CoachBootstrap | null,
  optimisticMessageId: string,
) {
  return current
    ? {
      ...current,
      messages: current.messages.filter((message) => message.id !== optimisticMessageId),
    }
    : current;
}

export function sendFailureState(content: string, caught: unknown) {
  return {
    composer: content,
    error: caught instanceof Error ? caught.message : "The coach could not respond.",
  };
}

export function reviewablePlans(plans: readonly ChangePlan[] | undefined) {
  return plans?.filter((plan) => (
    plan.status === "pending"
    || (plan.kind === "routine" && plan.action === "create" && plan.status === "applying")
  )) ?? [];
}

export function bootstrapWithAppliedPlan(
  current: CoachBootstrap | null,
  activeThreadId: string,
  plan: ChangePlan,
) {
  if (!current || current.thread.id !== activeThreadId) return current;
  return {
    ...current,
    plans: current.plans.map((candidate) => candidate.id === plan.id ? plan : candidate),
  };
}

export function bootstrapWithoutPlan(
  current: CoachBootstrap | null,
  activeThreadId: string,
  planId: string,
) {
  if (!current || current.thread.id !== activeThreadId) return current;
  return { ...current, plans: current.plans.filter((plan) => plan.id !== planId) };
}

export function planApplyBusyLabel(plan: ChangePlan, publish: boolean) {
  if (plan.kind === "exercise") {
    return plan.action === "create"
      ? "Adding to library…"
      : plan.action === "archive"
        ? "Archiving exercise…"
        : "Updating exercise…";
  }
  if (plan.action === "create") return "Creating routine…";
  return publish ? "Applying & publishing…" : "Saving draft…";
}

export function planApplySuccess(plan: ChangePlan, publish: boolean): PlanActionFeedback {
  if (plan.kind === "exercise") {
    const action = plan.action === "create"
      ? "added to your exercise library"
      : plan.action === "archive"
        ? "archived"
        : "updated";
    return { planId: plan.id, message: `${plan.exerciseName} ${action}.`, tone: "success" };
  }
  const message = plan.action === "create"
    ? `Routine ${plan.routineCode} created and published.`
    : publish
      ? `Routine ${plan.routineCode} updated and published.`
      : `Draft saved for routine ${plan.routineCode}.`;
  return { planId: plan.id, message, tone: "success" };
}

export function planApplyFailure(plan: ChangePlan, caught: unknown): PlanActionFeedback {
  const target = plan.kind === "routine"
    ? `Routine ${plan.routineCode}`
    : plan.exerciseName;
  return {
    planId: plan.id,
    message: caught instanceof Error ? caught.message : `${target} could not be changed.`,
    tone: "error",
  };
}

export function beginPlanAction(
  planId: string,
  action: "apply" | "reject",
  publish: boolean,
) {
  return {
    busyKey: `${planId}:${action}:${publish}`,
    body: action === "apply" ? { publish } : {},
  };
}
