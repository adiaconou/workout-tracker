import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPlanAction,
  bootstrapWithOptimisticMessage,
  bootstrapWithProfile,
  bootstrapWithSendResponse,
  bootstrapWithoutOptimisticMessage,
  modelSaveFailure,
  modelSelectionForOption,
  optimisticUserMessage,
  refreshedModelSelection,
  reviewablePlans,
  selectedModelOption,
  selectionFromProfile,
  sendFailureState,
  type AssistantMessage,
  type AssistantThread,
  type ChangePlan,
  type CoachBootstrap,
  type ModelOption,
} from "../src/client/coach/coach-model";

const thread: AssistantThread = {
  id: "thread-1",
  title: "First thread",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const otherThread: AssistantThread = {
  ...thread,
  id: "thread-2",
  title: "Other thread",
};

const modelA: ModelOption = {
  id: "model-a",
  label: "Model A",
  created: 1,
  reasoningEfforts: ["auto", "medium", "high"],
};

const modelB: ModelOption = {
  id: "model-b",
  label: "Model B",
  created: 2,
  reasoningEfforts: ["auto"],
};

function message(
  id: string,
  role: AssistantMessage["role"] = "user",
): AssistantMessage {
  return {
    id,
    threadId: thread.id,
    role,
    content: `${role}-${id}`,
    model: role === "assistant" ? modelA.id : null,
    reasoningEffort: role === "assistant" ? "medium" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function plan(
  id: string,
  overrides: Partial<ChangePlan> = {},
): ChangePlan {
  return {
    id,
    kind: "exercise",
    action: "update",
    exerciseName: "Squat",
    summary: "Change squat",
    rationale: "Progress",
    diff: ["More reps"],
    status: "pending",
    ...overrides,
  } as ChangePlan;
}

function bootstrap(overrides: Partial<CoachBootstrap> = {}): CoachBootstrap {
  return {
    profile: { model: modelA.id, reasoningEffort: "medium" },
    threads: [thread, otherThread],
    thread,
    messages: [message("existing")],
    plans: [],
    models: [modelA, modelB],
    modelConfiguration: {
      configured: true,
      source: "live",
      defaultModel: modelA.id,
    },
    ...overrides,
  };
}

test("profile and selected model helpers preserve bootstrap fallback behavior", () => {
  assert.deepEqual(selectionFromProfile({ model: modelA.id, reasoningEffort: "high" }), {
    model: modelA.id,
    reasoningEffort: "high",
  });
  assert.equal(selectedModelOption([modelA, modelB], modelB.id), modelB);
  assert.equal(selectedModelOption([modelA, modelB], "missing"), modelA);
  assert.equal(selectedModelOption([], "missing"), null);
  assert.equal(selectedModelOption(undefined, undefined), null);
});

test("choosing a model preserves effort or falls back to medium then auto", () => {
  assert.deepEqual(modelSelectionForOption(
    { model: modelB.id, reasoningEffort: "high" },
    modelA,
  ), {
    model: modelA.id,
    reasoningEffort: "high",
  });
  assert.deepEqual(modelSelectionForOption(
    { model: modelB.id, reasoningEffort: "unsupported" },
    modelA,
  ), {
    model: modelA.id,
    reasoningEffort: "medium",
  });
  assert.deepEqual(modelSelectionForOption(
    { model: modelA.id, reasoningEffort: "high" },
    modelB,
  ), {
    model: modelB.id,
    reasoningEffort: "auto",
  });
});

test("model refresh keeps available choices and safely falls back", () => {
  assert.deepEqual(refreshedModelSelection(
    [modelA, modelB],
    modelB.id,
    { model: modelA.id, reasoningEffort: "high" },
  ), {
    model: modelA.id,
    reasoningEffort: "high",
  });
  assert.deepEqual(refreshedModelSelection(
    [modelA, modelB],
    modelB.id,
    { model: "retired", reasoningEffort: "high" },
  ), {
    model: modelB.id,
    reasoningEffort: "auto",
  });
  assert.deepEqual(refreshedModelSelection(
    [],
    "fallback-not-listed",
    { model: "retired", reasoningEffort: "medium" },
  ), {
    model: "fallback-not-listed",
    reasoningEffort: "auto",
  });
});

test("model persistence success merges profiles and failure restores selection", () => {
  const current = bootstrap();
  const updated = bootstrapWithProfile(current, {
    model: modelB.id,
    reasoningEffort: "auto",
  });
  assert.deepEqual(updated?.profile, {
    model: modelB.id,
    reasoningEffort: "auto",
  });
  assert.equal(bootstrapWithProfile(null, current.profile), null);

  const previous = { model: modelA.id, reasoningEffort: "medium" };
  assert.deepEqual(modelSaveFailure(previous, new Error("Network down")), {
    selection: previous,
    error: "Network down",
  });
  assert.deepEqual(modelSaveFailure(previous, "unknown"), {
    selection: previous,
    error: "The model setting could not be saved.",
  });
});

test("optimistic messages append with exact local metadata", () => {
  const optimistic = optimisticUserMessage({
    id: "local-1",
    threadId: thread.id,
    content: "Help me train",
    createdAt: "2026-08-08T00:00:00.000Z",
  });
  assert.deepEqual(optimistic, {
    id: "local-1",
    threadId: thread.id,
    role: "user",
    content: "Help me train",
    model: null,
    reasoningEffort: null,
    createdAt: "2026-08-08T00:00:00.000Z",
  });
  assert.deepEqual(
    bootstrapWithOptimisticMessage(bootstrap(), optimistic)?.messages.map(({ id }) => id),
    ["existing", "local-1"],
  );
  assert.equal(bootstrapWithOptimisticMessage(null, optimistic), null);
});

test("send success replaces only its optimistic message and active thread", () => {
  const optimistic = message("local-1");
  const current = bootstrap({ messages: [message("existing"), optimistic] });
  const updatedThread = { ...thread, title: "Updated", updatedAt: "2026-08-08T00:00:00.000Z" };
  const userMessage = message("server-user");
  const assistantMessage = message("server-assistant", "assistant");
  const plans = [plan("plan-1")];
  const updated = bootstrapWithSendResponse(
    current,
    thread.id,
    optimistic.id,
    { thread: updatedThread, userMessage, assistantMessage, plans },
    { model: modelB.id, reasoningEffort: "auto" },
  );

  assert.equal(updated?.thread, updatedThread);
  assert.deepEqual(updated?.threads, [updatedThread, otherThread]);
  assert.deepEqual(updated?.messages.map(({ id }) => id), [
    "existing",
    "server-user",
    "server-assistant",
  ]);
  assert.equal(updated?.plans, plans);
  assert.deepEqual(updated?.profile, { model: modelB.id, reasoningEffort: "auto" });
});

test("late send responses cannot replace a different active thread", () => {
  const current = bootstrap();
  const response = {
    thread,
    userMessage: message("server-user"),
    assistantMessage: message("server-assistant", "assistant"),
    plans: [],
  };
  assert.equal(
    bootstrapWithSendResponse(null, thread.id, "local", response, current.profile),
    null,
  );
  assert.equal(
    bootstrapWithSendResponse(current, otherThread.id, "local", response, current.profile),
    current,
  );
});

test("failed sends remove optimistic state and restore the composer", () => {
  const current = bootstrap({ messages: [message("existing"), message("local-1")] });
  assert.deepEqual(
    bootstrapWithoutOptimisticMessage(current, "local-1")?.messages.map(({ id }) => id),
    ["existing"],
  );
  assert.equal(bootstrapWithoutOptimisticMessage(null, "local-1"), null);
  assert.deepEqual(sendFailureState("Try again", new Error("Timed out")), {
    composer: "Try again",
    error: "Timed out",
  });
  assert.deepEqual(sendFailureState("Try again", null), {
    composer: "Try again",
    error: "The coach could not respond.",
  });
});

test("review cards retain pending plans and interrupted routine creation only", () => {
  const plans: ChangePlan[] = [
    plan("pending"),
    plan("exercise-applying", { status: "applying" }),
    plan("routine-update-applying", {
      kind: "routine",
      action: "update",
      routineCode: "A",
      proposedRoutine: { focus: "A", durationMin: 30, exercises: [] },
      status: "applying",
    }),
    plan("routine-create-applying", {
      kind: "routine",
      action: "create",
      routineCode: "B",
      proposedRoutine: { focus: "B", durationMin: 45, exercises: [] },
      status: "applying",
    }),
    plan("routine-create-applied", {
      kind: "routine",
      action: "create",
      routineCode: "C",
      proposedRoutine: { focus: "C", durationMin: 60, exercises: [] },
      status: "applied",
    }),
  ];
  assert.deepEqual(reviewablePlans(plans).map(({ id }) => id), [
    "pending",
    "routine-create-applying",
  ]);
  assert.deepEqual(reviewablePlans(undefined), []);
});

test("plan transitions produce stable busy keys and apply/reject bodies", () => {
  assert.deepEqual(beginPlanAction("plan-1", "apply", true), {
    busyKey: "plan-1:apply:true",
    body: { publish: true },
  });
  assert.deepEqual(beginPlanAction("plan-1", "apply", false), {
    busyKey: "plan-1:apply:false",
    body: { publish: false },
  });
  assert.deepEqual(beginPlanAction("plan-1", "reject", true), {
    busyKey: "plan-1:reject:true",
    body: {},
  });
});
