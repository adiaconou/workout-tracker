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
  model: string | null;
  reasoningEffort: string | null;
  createdAt: string;
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
