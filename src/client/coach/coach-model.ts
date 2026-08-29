import type {
  CoachMessageRun,
  CoachMessageRunActivity,
  CoachMessageRunError,
  CoachMessageRunPhase,
  CoachMessageRunStatus,
} from "../../contracts/api";

export type {
  CoachMessageRun,
  CoachMessageRunActivity,
  CoachMessageRunError,
  CoachMessageRunPhase,
  CoachMessageRunStatus,
};

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

export type PlanReviewSection = {
  key: string;
  title: string;
  summary: string;
  preview: string | null;
  details: string[];
};

export type PlanReviewPresentation = {
  metadata: string | null;
  detailCount: number;
  sections: PlanReviewSection[];
};

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
  latestRun: CoachMessageRun | null;
};

export type ModelSelection = Pick<CoachProfile, "model" | "reasoningEffort">;

export type SendMessageResponse = {
  thread: AssistantThread;
  userMessage: AssistantMessage;
  run: CoachMessageRun;
  plans: ChangePlan[];
};

export type CoachRunResponse = {
  run: CoachMessageRun;
  assistantMessage: AssistantMessage | null;
  plans: ChangePlan[];
};

export type CoachRunConnection = "connected" | "paused" | "reconnecting" | "failed";

export type CoachRunPresentation = {
  title: string;
  detail: string;
  active: boolean;
  retryable: boolean;
};

export type CoachMessageAttempt = {
  key: string;
  requestFingerprint: string;
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

type MutablePlanReviewSection = PlanReviewSection & {
  action: "added" | "removed" | null;
  setLabels: Set<string>;
};

const exercisePlacementPattern = /^(.* \(position \d+\)) · (.+)$/u;
const exerciseActionPattern = /^(Add|Remove) exercise: (.* \(position \d+\)) (?:—|-) /u;
const setChangePattern = /^(?:(?:Add|Remove) set|Set) (\d+)\b/u;

export function planReviewPresentation(plan: ChangePlan): PlanReviewPresentation {
  const sections: MutablePlanReviewSection[] = [];
  const sectionsByKey = new Map<string, MutablePlanReviewSection>();

  for (const rawChange of plan.diff) {
    const change = readablePlanDiff(rawChange);
    const actionMatch = exerciseActionPattern.exec(change);
    const placementMatch = exercisePlacementPattern.exec(change);

    if (actionMatch) {
      const action = actionMatch[1] === "Add" ? "added" : "removed";
      const section = ensureReviewSection(sections, sectionsByKey, {
        key: `placement:${actionMatch[2]!}`,
        title: actionMatch[2]!,
      });
      section.action = action;
      section.details.push(change);
      continue;
    }

    if (placementMatch) {
      const placement = placementMatch[1]!;
      const detail = placementMatch[2]!;
      const section = ensureReviewSection(sections, sectionsByKey, {
        key: `placement:${placement}`,
        title: placement,
      });
      section.details.push(change);
      const setMatch = setChangePattern.exec(detail);
      if (setMatch) section.setLabels.add(`Set ${setMatch[1]!}`);
      if (!section.preview && isCompactPlanPreview(detail)) section.preview = detail;
      continue;
    }

    const key = plan.kind === "exercise"
      ? "exercise"
      : isRoutinePlanDetail(change)
        ? "routine"
        : "other";
    const section = ensureReviewSection(sections, sectionsByKey, {
      key,
      title: key === "exercise"
        ? "Exercise details"
        : key === "routine"
          ? "Routine"
          : "Other details",
    });
    section.details.push(change);
    if (!section.preview && isCompactPlanPreview(change)) section.preview = change;
  }

  return {
    metadata: plan.kind === "routine" ? routinePlanMetadata(plan) : null,
    detailCount: plan.diff.length,
    sections: sections.map(({ action, setLabels, ...section }) => ({
      ...section,
      summary: reviewSectionSummary(action, setLabels.size, section.details.length),
    })),
  };
}

function ensureReviewSection(
  sections: MutablePlanReviewSection[],
  sectionsByKey: Map<string, MutablePlanReviewSection>,
  input: Pick<PlanReviewSection, "key" | "title">,
) {
  const existing = sectionsByKey.get(input.key);
  if (existing) return existing;
  const section: MutablePlanReviewSection = {
    ...input,
    summary: "",
    preview: null,
    details: [],
    action: null,
    setLabels: new Set(),
  };
  sections.push(section);
  sectionsByKey.set(section.key, section);
  return section;
}

function isRoutinePlanDetail(change: string) {
  return /^(?:Create routine with code|Routine name:|Routine summary:|Estimated duration:)/u.test(change);
}

function isCompactPlanPreview(change: string) {
  return change.length <= 140 && !/^(?:Instructions|Notes|Routine summary):/u.test(change);
}

function routinePlanMetadata(plan: RoutineChangePlan) {
  const exerciseCount = plan.proposedRoutine.exercises.length;
  return `${plan.proposedRoutine.focus} · ${plan.proposedRoutine.durationMin} min · ${exerciseCount} ${
    exerciseCount === 1 ? "exercise" : "exercises"
  }`;
}

function reviewSectionSummary(
  action: MutablePlanReviewSection["action"],
  setCount: number,
  detailCount: number,
) {
  if (action) {
    const label = action === "added" ? "Added" : "Removed";
    return setCount ? `${label} · ${countLabel(setCount, "set")}` : label;
  }
  if (setCount) return `${countLabel(setCount, "set")} · ${countLabel(detailCount, "change")}`;
  return countLabel(detailCount, "change");
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
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

const activeCoachRunStatuses = new Set<CoachMessageRunStatus>([
  "starting",
  "queued",
  "in_progress",
]);

const coachRunRetryDelaysMs = [2_000, 4_000, 8_000, 15_000] as const;

const coachRunPhaseCopy: Record<CoachMessageRunPhase, Pick<CoachRunPresentation, "title" | "detail">> = {
  planning: {
    title: "Planning the next steps",
    detail: "Coach is deciding what information is needed for your request.",
  },
  checking: {
    title: "Checking your training data",
    detail: "Coach is reviewing the relevant routines, exercises, or workout history.",
  },
  recovering: {
    title: "Resuming your request",
    detail: "Coach is continuing from the last saved step.",
  },
  synthesizing: {
    title: "Preparing your answer",
    detail: "Coach has the needed information and is putting the response together.",
  },
  review_ready: {
    title: "Preparing your review",
    detail: "Coach is finalizing the proposed changes. Nothing changes until you approve them.",
  },
};

export function coachRunIsActive(status: CoachMessageRunStatus) {
  return activeCoachRunStatuses.has(status);
}

export function coachRunPollDelay(run: CoachMessageRun) {
  const requested = Number.isFinite(run.pollAfterMs) && run.pollAfterMs > 0
    ? run.pollAfterMs
    : 1_500;
  return Math.min(10_000, Math.max(750, requested));
}

export function coachRunRetryDelay(failureCount: number) {
  const index = Math.min(
    coachRunRetryDelaysMs.length - 1,
    Math.max(0, Math.floor(failureCount) - 1),
  );
  return coachRunRetryDelaysMs[index]!;
}

export function coachRunCanRetry(run: CoachMessageRun) {
  return run.status === "expired" || (run.status === "failed" && Boolean(run.error?.retryable));
}

export function coachMessageAttemptKey(
  currentAttempt: CoachMessageAttempt | null,
  requestFingerprint: string,
  newAttempt: boolean,
  createKey: () => string,
) {
  return !newAttempt && currentAttempt?.requestFingerprint === requestFingerprint
    ? currentAttempt.key
    : createKey();
}

export function coachRunPresentation(
  run: CoachMessageRun,
  connection: CoachRunConnection,
): CoachRunPresentation {
  const active = coachRunIsActive(run.status);
  if (active && connection === "reconnecting") {
    return {
      title: "Coach is still working",
      detail: "The connection dropped temporarily. Your request is saved and we will check again automatically.",
      active: true,
      retryable: false,
    };
  }
  if (active && connection === "paused") {
    return {
      title: "Progress checks are paused",
      detail: "Your request is saved. We will check again when you return.",
      active: true,
      retryable: false,
    };
  }
  if (connection === "failed") {
    return {
      title: "We couldn't check Coach's progress",
      detail: "Your request is saved and may still be running. Check again to reconnect.",
      active,
      retryable: false,
    };
  }
  if (run.status === "failed") {
    return {
      title: "Coach couldn't finish this request",
      detail: run.error?.message ?? "No changes were made. You can try this request again.",
      active: false,
      retryable: Boolean(run.error?.retryable),
    };
  }
  if (run.status === "expired") {
    return {
      title: "This Coach request expired",
      detail: run.error?.message ?? "No changes were made. Try again to start a fresh request.",
      active: false,
      retryable: true,
    };
  }
  if (run.status === "succeeded") {
    return {
      title: "Coach finished",
      detail: "The response and any proposed changes are ready below.",
      active: false,
      retryable: false,
    };
  }
  if (run.status === "starting" || run.status === "queued") {
    return {
      title: "Coach is getting started",
      detail: "Your request is saved. If more checks are needed, Coach will resume when you return.",
      active: true,
      retryable: false,
    };
  }
  return {
    ...coachRunPhaseCopy[run.phase],
    active: true,
    retryable: false,
  };
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
    ],
    plans: payload.plans,
    profile: { ...current.profile, ...selection },
    latestRun: payload.run,
  };
}

export function bootstrapWithRunResponse(
  current: CoachBootstrap | null,
  activeThreadId: string,
  payload: CoachRunResponse,
) {
  if (!current || current.thread.id !== activeThreadId || payload.run.threadId !== activeThreadId) {
    return current;
  }
  const messages = payload.assistantMessage
    ? [
        ...current.messages.filter((message) => message.id !== payload.assistantMessage!.id),
        payload.assistantMessage,
      ]
    : current.messages;
  return {
    ...current,
    messages,
    plans: payload.plans,
    latestRun: payload.run,
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

export function reconcileFailedSend(
  before: CoachBootstrap,
  refreshed: CoachBootstrap,
  content: string,
): "running" | "completed" | "partial" | "none" {
  if (before.thread.id !== refreshed.thread.id) return "none";

  const existingMessageIds = new Set(before.messages.map((message) => message.id));
  const newMessages = refreshed.messages.filter((message) => !existingMessageIds.has(message.id));
  const matchingUserIndex = newMessages.findIndex((message) => (
    message.role === "user" && message.content === content
  ));
  if (matchingUserIndex < 0) return "none";

  const matchingUserMessage = newMessages[matchingUserIndex]!;
  if (
    refreshed.latestRun?.userMessageId === matchingUserMessage.id
    && coachRunIsActive(refreshed.latestRun.status)
  ) {
    return "running";
  }

  const hasAssistantResponse = newMessages
    .slice(matchingUserIndex + 1)
    .some((message) => message.role === "assistant");
  if (hasAssistantResponse) return "completed";

  const existingPlanIds = new Set(before.plans.map((plan) => plan.id));
  const hasNewStagedPlan = reviewablePlans(refreshed.plans)
    .some((plan) => !existingPlanIds.has(plan.id));
  return hasNewStagedPlan ? "partial" : "none";
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
