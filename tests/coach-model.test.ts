import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPlanAction,
  bootstrapWithAppliedPlan,
  bootstrapWithOptimisticMessage,
  bootstrapWithPreservedActivities,
  bootstrapWithProfile,
  bootstrapWithRunResponse,
  bootstrapWithSendResponse,
  bootstrapWithoutPlan,
  bootstrapWithoutOptimisticMessage,
  coachToolActivityRows,
  coachMessageAttemptKey,
  coachRunCanRetry,
  coachRunIsActive,
  coachRunPollDelay,
  coachRunPresentation,
  coachRunRetryDelay,
  modelSaveFailure,
  modelSelectionForOption,
  optimisticUserMessage,
  planApplyBusyLabel,
  planApplyFailure,
  planApplySuccess,
  planReviewPresentation,
  readablePlanDiff,
  reconcileFailedSend,
  refreshedModelSelection,
  reviewablePlans,
  selectedModelOption,
  selectionFromProfile,
  sendFailureState,
  type AssistantMessage,
  type AssistantThread,
  type ChangePlan,
  type CoachBootstrap,
  type CoachMessageRun,
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
    latestRun: null,
    ...overrides,
  };
}

function run(
  status: CoachMessageRun["status"],
  overrides: Partial<CoachMessageRun> = {},
): CoachMessageRun {
  return {
    id: "run-1",
    threadId: thread.id,
    userMessageId: "server-user",
    status,
    phase: "planning",
    activities: [],
    pollAfterMs: 1_500,
    assistantMessageId: null,
    error: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    expiresAt: "2026-08-09T00:00:00.000Z",
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

test("tool activity becomes concise, deduplicated, human-readable rows", () => {
  assert.deepEqual(coachToolActivityRows(undefined), []);
  assert.deepEqual(coachToolActivityRows([
    { name: "get_routine", status: "succeeded" },
    { name: "get_routine", status: "succeeded" },
    { name: "get_routine", status: "failed" },
    { name: "unknown_read", status: "succeeded" },
    { name: "unknown_write", status: "failed" },
  ]), [
    {
      key: "get_routine:succeeded",
      label: "Checked the current routine",
      tone: "success",
    },
    {
      key: "get_routine:failed",
      label: "Couldn’t check the current routine",
      tone: "error",
    },
    {
      key: "unknown_read:succeeded",
      label: "Completed a coaching step",
      tone: "success",
    },
    {
      key: "unknown_write:failed",
      label: "A coaching step failed",
      tone: "error",
    },
  ]);
});

test("bootstrap refresh preserves current-turn activity without crossing threads", () => {
  const currentAssistant = {
    ...message("assistant-current", "assistant"),
    activities: [{ name: "get_workout_history", status: "succeeded" as const }],
  };
  const current = bootstrap({ messages: [currentAssistant, message("plain", "assistant")] });
  const payload = bootstrap({
    messages: [
      message("assistant-current", "assistant"),
      {
        ...message("server-activity", "assistant"),
        activities: [{ name: "get_routine", status: "succeeded" as const }],
      },
      message("plain", "assistant"),
    ],
  });

  assert.equal(bootstrapWithPreservedActivities(null, payload), payload);
  assert.equal(bootstrapWithPreservedActivities(
    bootstrap({ thread: otherThread }),
    payload,
  ), payload);
  const merged = bootstrapWithPreservedActivities(current, payload);
  assert.deepEqual(merged.messages[0]?.activities, currentAssistant.activities);
  assert.deepEqual(merged.messages[1]?.activities, [{ name: "get_routine", status: "succeeded" }]);
  assert.equal(merged.messages[2]?.activities, undefined);
});

test("legacy stored plan diffs become readable without changing new plan text", () => {
  const readable = [
    "Routine name: Not set → Strength.",
    "Add exercise: Deadlift (position 1) — Superset group: Not set.",
    "A custom summary that already reads naturally.",
  ];
  for (const change of readable) assert.equal(readablePlanDiff(change), change);

  assert.equal(
    readablePlanDiff('Routine summary: none -> "Keep the \\"brace\\" steady.".'),
    'Routine summary: Not set → Keep the "brace" steady.',
  );
  assert.equal(
    readablePlanDiff('Add "Conventional Deadlift": position=1; superset group=none; instructions="Keep the bar close."; notes="".'),
    "Add exercise: Conventional Deadlift (position 1) — Superset group: Not set; Instructions: Keep the bar close; Notes: None.",
  );
  assert.equal(
    readablePlanDiff('"Split Squat" placement at position 2 · set 1 · rest rule: "standard" -> "after_both_sides".'),
    "Split Squat (position 2) · Set 1 · Rest timing: Standard → After both sides.",
  );
  assert.equal(
    readablePlanDiff('Deadlift · add set: position=2; type="regular"; target type="reps".'),
    "Deadlift · Add set 2 — Set type: Regular; Target type: Reps.",
  );
  assert.equal(
    readablePlanDiff("Deadlift · set 2 · custom field: old -> new"),
    "Deadlift · set 2 · custom field: old → new",
  );
  assert.equal(
    readablePlanDiff("Tracking: duration; loading: external; side mode: per_side."),
    "Tracking: Duration; Loading: External; Side mode: Per side.",
  );
  assert.equal(
    readablePlanDiff(String.raw`Instructions: "\x".`),
    String.raw`Instructions: "\x".`,
  );
  assert.equal(
    readablePlanDiff(String.raw`Instructions: "\x"`),
    String.raw`Instructions: "\x"`,
  );
});

test("routine proposal presentation groups modern details by exact placement", () => {
  const diff = [
    "Routine name: Strength → Hypertrophy.",
    "Barbell Bench Press (position 1) · Position: 2 → 1.",
    "Barbell Bench Press (position 1) · Set 1 · Rest after set: 90 seconds → 120 seconds.",
    "Barbell Bench Press (position 1) · Set 2 · Notes: Old cue → New cue.",
    "Cable Row (position 2) · Instructions: Keep the elbows close.",
  ];
  const presentation = planReviewPresentation(plan("routine-modern", {
    kind: "routine",
    action: "update",
    routineCode: "A",
    proposedRoutine: {
      focus: "Hypertrophy",
      durationMin: 60,
      exercises: [{}, {}],
    },
    diff,
  }));

  assert.equal(presentation.metadata, "Hypertrophy · 60 min · 2 exercises");
  assert.equal(presentation.detailCount, diff.length);
  assert.deepEqual(presentation.sections, [
    {
      key: "routine",
      title: "Routine",
      summary: "1 change",
      preview: diff[0],
      details: [diff[0]],
    },
    {
      key: "placement:Barbell Bench Press (position 1)",
      title: "Barbell Bench Press (position 1)",
      summary: "2 sets · 3 changes",
      preview: "Position: 2 → 1.",
      details: diff.slice(1, 4),
    },
    {
      key: "placement:Cable Row (position 2)",
      title: "Cable Row (position 2)",
      summary: "1 change",
      preview: null,
      details: [diff[4]],
    },
  ]);
});

test("proposal presentation distinguishes added, removed, and duplicate-name placements", () => {
  const diff = [
    "Add exercise: Squat (position 1) — Superset group: Not set.",
    "Squat (position 1) · Add set 1 — Target type: Reps.",
    "Remove exercise: Squat (position 2) — Superset group: Not set.",
    "Squat (position 2) · Remove set 1 — Target type: Reps.",
    "Squat (position 2) · Remove set 2 — Target type: Reps.",
    "Add exercise: Farmer Carry (position 3) — Superset group: Not set.",
  ];
  const presentation = planReviewPresentation(plan("routine-structure", {
    kind: "routine",
    action: "update",
    routineCode: "A",
    proposedRoutine: {
      focus: "Strength",
      durationMin: 45,
      exercises: [{}, {}, {}],
    },
    diff,
  }));

  assert.deepEqual(
    presentation.sections.map(({ key, title, summary, preview }) => ({
      key,
      title,
      summary,
      preview,
    })),
    [
      {
        key: "placement:Squat (position 1)",
        title: "Squat (position 1)",
        summary: "Added · 1 set",
        preview: "Add set 1 — Target type: Reps.",
      },
      {
        key: "placement:Squat (position 2)",
        title: "Squat (position 2)",
        summary: "Removed · 2 sets",
        preview: "Remove set 1 — Target type: Reps.",
      },
      {
        key: "placement:Farmer Carry (position 3)",
        title: "Farmer Carry (position 3)",
        summary: "Added",
        preview: null,
      },
    ],
  );
  assert.deepEqual(
    presentation.sections.flatMap(({ details }) => details),
    diff,
  );
});

test("proposal presentation normalizes legacy details and preserves unknown ordering", () => {
  const longUnknown = `Custom detail: ${"x".repeat(150)}`;
  const diff = [
    longUnknown,
    'Routine summary: none -> "Keep the brace steady.".',
    '"Split Squat" placement at position 2 · set 1 · rest rule: "standard" -> "after_both_sides".',
    'Add "Deadlift": position=3; superset group=none; instructions="Stay tight."; notes="".',
  ];
  const normalized = diff.map(readablePlanDiff);
  const presentation = planReviewPresentation(plan("routine-legacy", {
    kind: "routine",
    action: "create",
    routineCode: "LEGACY",
    proposedRoutine: {
      focus: "Strength",
      durationMin: 45,
      exercises: [{}],
    },
    diff,
  }));

  assert.equal(presentation.metadata, "Strength · 45 min · 1 exercise");
  assert.deepEqual(
    presentation.sections.map(({ key, title, summary, preview }) => ({
      key,
      title,
      summary,
      preview,
    })),
    [
      {
        key: "other",
        title: "Other details",
        summary: "1 change",
        preview: null,
      },
      {
        key: "routine",
        title: "Routine",
        summary: "1 change",
        preview: null,
      },
      {
        key: "placement:Split Squat (position 2)",
        title: "Split Squat (position 2)",
        summary: "1 set · 1 change",
        preview: "Set 1 · Rest timing: Standard → After both sides.",
      },
      {
        key: "placement:Deadlift (position 3)",
        title: "Deadlift (position 3)",
        summary: "Added",
        preview: null,
      },
    ],
  );
  assert.deepEqual(
    presentation.sections.flatMap(({ details }) => details),
    normalized,
  );
});

test("exercise and empty proposal presentations remain compact", () => {
  const exerciseDiff = [
    "Archive Old Squat from the exercise library.",
    "Existing routine versions and workout history remain unchanged.",
  ];
  assert.deepEqual(planReviewPresentation(plan("exercise-archive", {
    action: "archive",
    exerciseName: "Old Squat",
    diff: exerciseDiff,
  })), {
    metadata: null,
    detailCount: 2,
    sections: [{
      key: "exercise",
      title: "Exercise details",
      summary: "2 changes",
      preview: exerciseDiff[0],
      details: exerciseDiff,
    }],
  });
  assert.deepEqual(planReviewPresentation(plan("empty", { diff: [] })), {
    metadata: null,
    detailCount: 0,
    sections: [],
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
  const plans = [plan("plan-1")];
  const messageRun = run("queued");
  const updated = bootstrapWithSendResponse(
    current,
    thread.id,
    optimistic.id,
    { thread: updatedThread, userMessage, run: messageRun, plans },
    { model: modelB.id, reasoningEffort: "auto" },
  );

  assert.equal(updated?.thread, updatedThread);
  assert.deepEqual(updated?.threads, [updatedThread, otherThread]);
  assert.deepEqual(updated?.messages.map(({ id }) => id), [
    "existing",
    "server-user",
  ]);
  assert.equal(updated?.plans, plans);
  assert.equal(updated?.latestRun, messageRun);
  assert.deepEqual(updated?.profile, { model: modelB.id, reasoningEffort: "auto" });
});

test("run responses update progress and append a terminal assistant message once", () => {
  const current = bootstrap({ latestRun: run("queued") });
  const activeResponse = { run: run("in_progress"), assistantMessage: null, plans: [plan("active-plan")] };
  const active = bootstrapWithRunResponse(current, thread.id, activeResponse);
  assert.equal(active?.latestRun?.status, "in_progress");
  assert.equal(active?.messages, current.messages);
  assert.deepEqual(active?.plans, activeResponse.plans);

  const assistant = message("server-assistant", "assistant");
  const completedResponse = {
    run: run("succeeded", { assistantMessageId: assistant.id }),
    assistantMessage: assistant,
    plans: [plan("complete-plan")],
  };
  const completed = bootstrapWithRunResponse(active, thread.id, completedResponse);
  assert.deepEqual(completed?.messages.map(({ id }) => id), ["existing", assistant.id]);
  assert.deepEqual(
    bootstrapWithRunResponse(completed, thread.id, completedResponse)?.messages.map(({ id }) => id),
    ["existing", assistant.id],
  );
  assert.equal(bootstrapWithRunResponse(null, thread.id, completedResponse), null);
  assert.equal(bootstrapWithRunResponse(current, otherThread.id, completedResponse), current);
  assert.equal(bootstrapWithRunResponse(current, thread.id, {
    ...completedResponse,
    run: { ...completedResponse.run, threadId: otherThread.id },
  }), current);
});

test("coach run helpers bound polling, retry transport failures, and reuse uncertain sends", () => {
  for (const status of ["starting", "queued", "in_progress"] as const) {
    assert.equal(coachRunIsActive(status), true);
  }
  for (const status of ["succeeded", "failed", "expired"] as const) {
    assert.equal(coachRunIsActive(status), false);
  }

  assert.equal(coachRunPollDelay(run("queued", { pollAfterMs: 2_500 })), 2_500);
  assert.equal(coachRunPollDelay(run("queued", { pollAfterMs: 100 })), 750);
  assert.equal(coachRunPollDelay(run("queued", { pollAfterMs: 20_000 })), 10_000);
  assert.equal(coachRunPollDelay(run("queued", { pollAfterMs: 0 })), 1_500);
  assert.equal(coachRunPollDelay(run("queued", { pollAfterMs: Number.NaN })), 1_500);
  assert.equal(coachRunRetryDelay(0), 2_000);
  assert.equal(coachRunRetryDelay(1), 2_000);
  assert.equal(coachRunRetryDelay(2), 4_000);
  assert.equal(coachRunRetryDelay(3.9), 8_000);
  assert.equal(coachRunRetryDelay(99), 15_000);

  let created = 0;
  const createKey = () => `new-${++created}`;
  const existing = { key: "existing", requestFingerprint: "request-a" };
  assert.equal(coachMessageAttemptKey(existing, "request-a", false, createKey), "existing");
  assert.equal(coachMessageAttemptKey(null, "request-a", false, createKey), "new-1");
  assert.equal(coachMessageAttemptKey(existing, "request-a", true, createKey), "new-2");
  assert.equal(coachMessageAttemptKey(existing, "request-b", false, createKey), "new-3");

  assert.equal(coachRunCanRetry(run("expired")), true);
  assert.equal(coachRunCanRetry(run("failed", {
    error: { code: "timeout", message: "Timed out", retryable: true },
  })), true);
  assert.equal(coachRunCanRetry(run("failed", {
    error: { code: "invalid", message: "Invalid", retryable: false },
  })), false);
  assert.equal(coachRunCanRetry(run("failed")), false);
  assert.equal(coachRunCanRetry(run("queued")), false);
});

test("coach run presentation gives truthful progress, reconnect, and terminal copy", () => {
  for (const phase of ["planning", "checking", "recovering", "synthesizing", "review_ready"] as const) {
    const presentation = coachRunPresentation(run("in_progress", { phase }), "connected");
    assert.ok(presentation.title.length > 0, phase);
    assert.ok(presentation.detail.length > 0, phase);
    assert.equal(presentation.active, true);
    assert.equal(presentation.retryable, false);
  }

  assert.match(coachRunPresentation(run("starting"), "connected").title, /getting started/i);
  assert.match(coachRunPresentation(run("queued"), "connected").title, /getting started/i);
  assert.match(coachRunPresentation(run("queued"), "reconnecting").title, /still working/i);
  assert.match(coachRunPresentation(run("queued"), "paused").title, /paused/i);
  assert.match(coachRunPresentation(run("queued"), "failed").title, /couldn't check/i);
  assert.equal(coachRunPresentation(run("failed"), "failed").active, false);

  const failed = coachRunPresentation(run("failed", {
    error: { code: "rate_limited", message: "Please wait a moment.", retryable: true },
  }), "connected");
  assert.equal(failed.detail, "Please wait a moment.");
  assert.equal(failed.retryable, true);
  assert.match(coachRunPresentation(run("failed"), "connected").detail, /no changes/i);
  assert.equal(coachRunPresentation(run("expired", {
    error: { code: "expired", message: "This saved run expired.", retryable: true },
  }), "connected").detail, "This saved run expired.");
  assert.match(coachRunPresentation(run("expired"), "connected").detail, /no changes/i);
  assert.match(coachRunPresentation(run("succeeded"), "connected").title, /finished/i);
  assert.equal(coachRunPresentation(run("succeeded"), "connected").retryable, false);
});

test("late send responses cannot replace a different active thread", () => {
  const current = bootstrap();
  const response = {
    thread,
    userMessage: message("server-user"),
    run: run("queued"),
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

test("failed-send reconciliation recognizes a completed persisted response", () => {
  const before = bootstrap({
    messages: [message("existing")],
    plans: [plan("existing-plan")],
  });
  const matchingUser = {
    ...message("server-user"),
    content: "Build routines",
  };
  const assistant = message("server-assistant", "assistant");
  const refreshed = bootstrap({
    messages: [...before.messages, matchingUser, assistant],
    plans: before.plans,
  });

  assert.equal(reconcileFailedSend(before, refreshed, matchingUser.content), "completed");
});

test("failed-send reconciliation resumes a matching persisted run", () => {
  const before = bootstrap({ messages: [message("existing")] });
  const matchingUser = { ...message("server-user"), content: "Update routine C" };
  const refreshed = bootstrap({
    messages: [...before.messages, matchingUser],
    latestRun: run("in_progress", { userMessageId: matchingUser.id }),
  });
  assert.equal(reconcileFailedSend(before, refreshed, matchingUser.content), "running");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, matchingUser],
    latestRun: run("failed", { userMessageId: matchingUser.id }),
  }), matchingUser.content), "none");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, matchingUser],
    latestRun: run("queued", { userMessageId: "another-message" }),
  }), matchingUser.content), "none");
});

test("failed-send reconciliation recognizes persisted users with staged plans", () => {
  const before = bootstrap({
    messages: [message("existing")],
    plans: [plan("existing-plan")],
  });
  const matchingUser = {
    ...message("server-user"),
    content: "Build routines",
  };
  const pending = plan("new-pending");
  const interruptedCreation = plan("new-applying", {
    kind: "routine",
    action: "create",
    routineCode: "B",
    proposedRoutine: { focus: "Pull", durationMin: 45, exercises: [] },
    status: "applying",
  });

  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, matchingUser],
    plans: [...before.plans, pending],
  }), matchingUser.content), "partial");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, matchingUser],
    plans: [...before.plans, interruptedCreation],
  }), matchingUser.content), "partial");
});

test("failed-send reconciliation rejects wrong threads and unrelated state", () => {
  const before = bootstrap({
    messages: [message("existing")],
    plans: [plan("existing-plan")],
  });
  const matchingUser = {
    ...message("server-user"),
    content: "Build routines",
  };
  const assistant = message("server-assistant", "assistant");

  assert.equal(reconcileFailedSend(before, bootstrap({
    thread: otherThread,
    messages: [...before.messages, matchingUser, assistant],
  }), matchingUser.content), "none");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [
      ...before.messages,
      assistant,
      { ...matchingUser, content: "Different request" },
    ],
    plans: [...before.plans, plan("new-pending")],
  }), matchingUser.content), "none");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, assistant, matchingUser],
    plans: before.plans,
  }), matchingUser.content), "none");
  assert.equal(reconcileFailedSend(before, bootstrap({
    messages: [...before.messages, matchingUser],
    plans: [...before.plans, plan("already-applied", { status: "applied" })],
  }), matchingUser.content), "none");
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

test("plan updates are guarded by thread and handled plans leave the review list", () => {
  const first = plan("plan-1");
  const second = plan("plan-2", { exerciseName: "Deadlift" });
  const current = bootstrap({ plans: [first, second] });
  const applied = { ...first, status: "applied" as const };

  assert.equal(bootstrapWithAppliedPlan(null, thread.id, applied), null);
  assert.equal(bootstrapWithAppliedPlan(current, otherThread.id, applied), current);
  const updated = bootstrapWithAppliedPlan(current, thread.id, applied);
  assert.deepEqual(updated?.plans, [applied, second]);
  assert.deepEqual(reviewablePlans(updated?.plans), [second]);

  assert.equal(bootstrapWithoutPlan(null, thread.id, first.id), null);
  assert.equal(bootstrapWithoutPlan(current, otherThread.id, first.id), current);
  assert.deepEqual(bootstrapWithoutPlan(current, thread.id, first.id)?.plans, [second]);
});

test("plan actions use readable progress and success messages for every action", () => {
  const routineCreate = plan("routine-create", {
    kind: "routine",
    action: "create",
    routineCode: "PULL-2",
    proposedRoutine: { focus: "Pull", durationMin: 45, exercises: [] },
  });
  const routineUpdate = plan("routine-update", {
    kind: "routine",
    action: "update",
    routineCode: "A",
    proposedRoutine: { focus: "Strength", durationMin: 45, exercises: [] },
  });
  const exerciseCreate = plan("exercise-create", { action: "create", exerciseName: "Farmer Carry" });
  const exerciseUpdate = plan("exercise-update", { action: "update", exerciseName: "Squat" });
  const exerciseArchive = plan("exercise-archive", { action: "archive", exerciseName: "Old Squat" });

  assert.equal(planApplyBusyLabel(routineCreate, true), "Creating routine…");
  assert.equal(planApplyBusyLabel(routineUpdate, true), "Applying & publishing…");
  assert.equal(planApplyBusyLabel(routineUpdate, false), "Saving draft…");
  assert.equal(planApplyBusyLabel(exerciseCreate, true), "Adding to library…");
  assert.equal(planApplyBusyLabel(exerciseUpdate, true), "Updating exercise…");
  assert.equal(planApplyBusyLabel(exerciseArchive, true), "Archiving exercise…");

  assert.deepEqual(planApplySuccess(routineCreate, true), {
    planId: "routine-create",
    message: "Routine PULL-2 created and published.",
    tone: "success",
  });
  assert.equal(planApplySuccess(routineUpdate, true).message, "Routine A updated and published.");
  assert.equal(planApplySuccess(routineUpdate, false).message, "Draft saved for routine A.");
  assert.equal(planApplySuccess(exerciseCreate, true).message, "Farmer Carry added to your exercise library.");
  assert.equal(planApplySuccess(exerciseUpdate, true).message, "Squat updated.");
  assert.equal(planApplySuccess(exerciseArchive, true).message, "Old Squat archived.");
});

test("plan action failures retain the API message or name the affected target", () => {
  const routine = plan("routine", {
    kind: "routine",
    action: "update",
    routineCode: "A",
    proposedRoutine: { focus: "Strength", durationMin: 45, exercises: [] },
  });
  const exercise = plan("exercise", { exerciseName: "Squat" });
  assert.deepEqual(planApplyFailure(routine, new Error("Routine changed.")), {
    planId: "routine",
    message: "Routine changed.",
    tone: "error",
  });
  assert.deepEqual(planApplyFailure(exercise, null), {
    planId: "exercise",
    message: "Squat could not be changed.",
    tone: "error",
  });
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
