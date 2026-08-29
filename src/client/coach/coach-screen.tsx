import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, apiRequest } from "../api/client";
import { LoadingView, Message, Screen } from "../ui/ui";
import { colors, radii, spacing } from "../ui/tokens";
import { CoachMarkdown } from "./coach-markdown";
import {
  createCoachRunController,
  type CoachRunController,
} from "./coach-run-controller";
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
  coachRunPresentation,
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
  type CoachMessageAttempt,
  type CoachMessageRun,
  type CoachProfile,
  type CoachRunConnection,
  type CoachRunResponse,
  type ExerciseChangePlan,
  type ModelOption,
  type ModelSelection,
  type PlanActionFeedback,
  type PlanApplyResponse,
  type SendMessageResponse,
} from "./coach-model";

const quickPrompts = [
  "What should I train today?",
  "Review my recent workouts",
  "Improve my next routine",
  "Build me a new routine",
];

export type CoachScreenStatus = "idle" | "working" | "review" | "error";

export function CoachScreen({
  embedded = false,
  visible = true,
  starter,
  onStarterConsumed,
  onStatusChange,
}: {
  embedded?: boolean;
  visible?: boolean;
  starter?: string;
  onStarterConsumed?: () => void;
  onStatusChange?: (status: CoachScreenStatus) => void;
}) {
  const messageListRef = useRef<ScrollView | null>(null);
  const starterAppliedRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const messageAttemptRef = useRef<CoachMessageAttempt | null>(null);
  const runRetryAttemptRef = useRef<{ runId: string; key: string } | null>(null);
  const runControllerRef = useRef<CoachRunController | null>(null);
  const [data, setData] = useState<CoachBootstrap | null>(null);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [retryingRun, setRetryingRun] = useState(false);
  const [runConnection, setRunConnection] = useState<CoachRunConnection>("connected");
  const [runTransportError, setRunTransportError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [planFeedback, setPlanFeedback] = useState<{
    threadId: string;
    feedback: PlanActionFeedback;
  } | null>(null);
  const [sendNotice, setSendNotice] = useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [showModels, setShowModels] = useState(false);
  const [showThreads, setShowThreads] = useState(false);

  const load = useCallback(async (threadId?: string) => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<CoachBootstrap>(
        `/api/v1/assistant${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`,
      );
      setData((current) => bootstrapWithPreservedActivities(current, payload));
      setPlanFeedback((current) => current?.threadId === payload.thread.id ? current : null);
      setSendNotice((current) => current?.threadId === payload.thread.id ? current : null);
      setSelection(selectionFromProfile(payload.profile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = createCoachRunController({
      request: apiRequest,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancelScheduled: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      isRetryableError: (caught) => !(caught instanceof ApiError) || caught.retryable,
      errorMessage: (caught) => caught instanceof Error
        ? caught.message
        : "Coach progress could not be checked.",
      onResponse: (payload) => {
        setData((current) => bootstrapWithRunResponse(current, payload.run.threadId, payload));
        setRunTransportError("");
      },
      onConnection: setRunConnection,
      onFatalError: setRunTransportError,
    });
    runControllerRef.current = controller;
    return () => {
      controller.stop();
      runControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    runControllerRef.current?.resume();
    void load();
  }, [load]);

  useEffect(() => {
    if (Platform.OS === "web") {
      const updatePollingForVisibility = () => {
        if (document.visibilityState === "visible") runControllerRef.current?.resume();
        else runControllerRef.current?.pause();
      };
      window.addEventListener("focus", updatePollingForVisibility);
      document.addEventListener("visibilitychange", updatePollingForVisibility);
      updatePollingForVisibility();
      return () => {
        window.removeEventListener("focus", updatePollingForVisibility);
        document.removeEventListener("visibilitychange", updatePollingForVisibility);
      };
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runControllerRef.current?.resume();
      else runControllerRef.current?.pause();
    });
    return () => subscription.remove();
  }, []);

  const activeRunId = data?.latestRun && coachRunIsActive(data.latestRun.status)
    ? data.latestRun.id
    : null;

  useEffect(() => {
    if (!activeRunId || !data?.latestRun) {
      runControllerRef.current?.stop();
      return;
    }
    setRunTransportError("");
    runControllerRef.current?.monitor(data.latestRun);
  }, [activeRunId, data?.thread.id]);

  useEffect(() => {
    if (visible) return;
    setShowModels(false);
    setShowThreads(false);
  }, [visible]);

  useEffect(() => {
    if (!starter) starterAppliedRef.current = false;
  }, [starter]);

  useEffect(() => {
    if (
      starter !== "routine-design" ||
      starterAppliedRef.current ||
      !data
    ) {
      return;
    }
    starterAppliedRef.current = true;
    if (data.messages.length === 0 && !composer) {
      setComposer("Build routines using the equipment and workout length I just selected.");
    }
    onStarterConsumed?.();
  }, [composer, data, onStarterConsumed, starter]);

  const selectedModel = useMemo(
    () => selectedModelOption(data?.models, selection?.model),
    [data?.models, selection?.model],
  );
  const reasoningEfforts = selectedModel?.reasoningEfforts ?? ["auto"];
  const reviewPlans = reviewablePlans(data?.plans);
  activeThreadIdRef.current = data?.thread.id ?? null;

  useEffect(() => {
    if (error || runTransportError) {
      onStatusChange?.("error");
    } else if (loading || sending || retryingRun || activeRunId) {
      onStatusChange?.("working");
    } else if (reviewPlans.length > 0) {
      onStatusChange?.("review");
    } else {
      onStatusChange?.("idle");
    }
  }, [
    activeRunId,
    error,
    loading,
    onStatusChange,
    retryingRun,
    reviewPlans.length,
    runTransportError,
    sending,
  ]);

  async function persistModelSettings(next: ModelSelection) {
    if (!data || !selection) return;
    const previous = selection;
    setSelection(next);
    setSavingModel(true);
    setError("");
    try {
      const payload = await apiRequest<{ profile: CoachProfile }>("/api/v1/assistant/profile", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setData((current) => bootstrapWithProfile(current, payload.profile));
      setSelection(selectionFromProfile(payload.profile));
    } catch (caught) {
      const failure = modelSaveFailure(previous, caught);
      setSelection(failure.selection);
      setError(failure.error);
    } finally {
      setSavingModel(false);
    }
  }

  function chooseModel(model: ModelOption) {
    if (!selection || savingModel) return;
    setShowModels(false);
    void persistModelSettings(modelSelectionForOption(selection, model));
  }

  function chooseReasoningEffort(reasoningEffort: string) {
    if (!selection || savingModel || reasoningEffort === selection.reasoningEffort) return;
    void persistModelSettings({ ...selection, reasoningEffort });
  }

  async function refreshModels() {
    if (!data || !selection) return;
    setRefreshingModels(true);
    setError("");
    try {
      const payload = await apiRequest<{
        models: ModelOption[];
        configured: boolean;
        source: "live" | "fallback";
        defaultModel: string;
      }>("/api/v1/assistant/models");
      const nextSelection = refreshedModelSelection(
        payload.models,
        payload.defaultModel,
        selection,
      );
      setData({
        ...data,
        models: payload.models,
        modelConfiguration: {
          configured: payload.configured,
          source: payload.source,
          defaultModel: payload.defaultModel,
        },
      });
      setSelection(nextSelection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The model list could not be refreshed.");
    } finally {
      setRefreshingModels(false);
    }
  }

  async function send(text = composer) {
    const content = text.trim();
    if (
      !content
      || !data
      || !selection
      || sending
      || activeRunId
      || !data.modelConfiguration.configured
    ) return;
    const activeThreadId = data.thread.id;
    const requestBody = JSON.stringify({
      threadId: activeThreadId,
      content,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
    });
    const requestFingerprint = `${activeThreadId}:${requestBody}`;
    const idempotencyKey = coachMessageAttemptKey(
      messageAttemptRef.current,
      requestFingerprint,
      false,
      createCoachMessageIdempotencyKey,
    );
    messageAttemptRef.current = { key: idempotencyKey, requestFingerprint };
    const optimisticMessage = optimisticUserMessage({
      id: `local-${Date.now()}`,
      threadId: activeThreadId,
      content,
      createdAt: new Date().toISOString(),
    });
    setSending(true);
    setError("");
    setPlanFeedback(null);
    setSendNotice(null);
    setComposer("");
    setData((current) => bootstrapWithOptimisticMessage(current, optimisticMessage));
    try {
      const payload = await apiRequest<SendMessageResponse>("/api/v1/assistant/messages", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: requestBody,
      });
      messageAttemptRef.current = null;
      setData((current) => bootstrapWithSendResponse(
        current,
        activeThreadId,
        optimisticMessage.id,
        payload,
        selection,
      ));
      setRunConnection("connected");
      setRunTransportError("");
      runControllerRef.current?.monitor(payload.run);
    } catch (caught) {
      const failure = sendFailureState(content, caught);
      let reconciliation: ReturnType<typeof reconcileFailedSend> = "none";
      try {
        const refreshed = await apiRequest<CoachBootstrap>(
          `/api/v1/assistant?threadId=${encodeURIComponent(activeThreadId)}`,
        );
        reconciliation = reconcileFailedSend(data, refreshed, content);
        if (reconciliation !== "none") {
          setData((current) => current?.thread.id === activeThreadId
            ? bootstrapWithPreservedActivities(current, refreshed)
            : current);
          if (reconciliation === "running" && refreshed.latestRun) {
            setRunConnection("connected");
            setRunTransportError("");
            runControllerRef.current?.monitor(refreshed.latestRun);
          }
        }
      } catch {
        // Fall back to the original send error when reconciliation is unavailable.
      }

      if (activeThreadIdRef.current === activeThreadId && reconciliation !== "none") {
        setComposer("");
        setError("");
        setSendNotice({
          threadId: activeThreadId,
          message: reconciliation === "running"
            ? "Your request was saved. Coach will resume from the last saved step if you leave."
            : reconciliation === "completed"
            ? "The connection dropped, but your request and Coach's reply were saved."
            : "Your request was saved and the proposed update is ready to review.",
        });
      } else if (activeThreadIdRef.current === activeThreadId) {
        setData((current) => bootstrapWithoutOptimisticMessage(current, optimisticMessage.id));
        setComposer(failure.composer);
        setError(failure.error);
      }
    } finally {
      setSending(false);
    }
  }

  async function createThread() {
    if (sending) return;
    setError("");
    try {
      const payload = await apiRequest<{ thread: AssistantThread }>("/api/v1/assistant/threads", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setShowThreads(false);
      await load(payload.thread.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A new conversation could not be created.");
    }
  }

  async function retryCoachRun(run: CoachMessageRun) {
    if (!data || retryingRun || !coachRunCanRetry(run)) return;
    const activeThreadId = data.thread.id;
    const existingAttempt = runRetryAttemptRef.current;
    const idempotencyKey = existingAttempt?.runId === run.id
      ? existingAttempt.key
      : createCoachRunRetryIdempotencyKey();
    runRetryAttemptRef.current = { runId: run.id, key: idempotencyKey };
    setRetryingRun(true);
    setError("");
    setRunTransportError("");
    setSendNotice(null);
    try {
      const payload = await apiRequest<CoachRunResponse>(
        `/api/v1/assistant/message-runs/${encodeURIComponent(run.id)}/retry`,
        {
          method: "POST",
          headers: { "x-idempotency-key": idempotencyKey },
        },
      );
      runRetryAttemptRef.current = null;
      setData((current) => bootstrapWithRunResponse(current, activeThreadId, payload));
      setRunConnection("connected");
      runControllerRef.current?.monitor(payload.run);
    } catch (caught) {
      setRunTransportError(caught instanceof Error
        ? caught.message
        : "Coach could not retry this request.");
    } finally {
      setRetryingRun(false);
    }
  }

  async function handlePlan(planId: string, action: "apply" | "reject", publish = true) {
    if (!data) return;
    const plan = data.plans.find((candidate) => candidate.id === planId);
    if (!plan) return;
    const activeThreadId = data.thread.id;
    const transition = beginPlanAction(planId, action, publish);
    setPlanBusy(transition.busyKey);
    setError("");
    setPlanFeedback(null);
    setSendNotice(null);
    try {
      const payload = await apiRequest<PlanApplyResponse | { rejected: true; planId: string }>(
        `/api/v1/assistant/plans/${encodeURIComponent(planId)}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(transition.body),
        },
      );
      if (action === "apply" && "plan" in payload) {
        setData((current) => bootstrapWithAppliedPlan(current, activeThreadId, payload.plan));
        setPlanFeedback({
          threadId: activeThreadId,
          feedback: planApplySuccess(payload.plan, "published" in payload ? payload.published : publish),
        });
      } else {
        setData((current) => bootstrapWithoutPlan(current, activeThreadId, planId));
      }
    } catch (caught) {
      let feedback = planApplyFailure(plan, caught);
      try {
        const refreshed = await apiRequest<CoachBootstrap>(
          `/api/v1/assistant?threadId=${encodeURIComponent(activeThreadId)}`,
        );
        const refreshedPlan = refreshed.plans.find((candidate) => candidate.id === planId);
        setData((current) => current?.thread.id === activeThreadId
          ? bootstrapWithPreservedActivities(current, refreshed)
          : current);
        if (action === "apply" && refreshedPlan?.status === "applied") {
          feedback = planApplySuccess(refreshedPlan, publish);
        }
      } catch {
        // Keep the original, plan-specific failure when refresh is also unavailable.
      }
      setPlanFeedback({ threadId: activeThreadId, feedback });
    } finally {
      setPlanBusy(null);
    }
  }

  if (loading && !data) return <LoadingView label="Opening Coach…" />;
  if (!data || !selection) {
    const errorContent = (
      <>
        <Text style={styles.errorText}>{error || "The coach could not be loaded."}</Text>
        <CompactAction title="Try again" onPress={() => void load()} />
      </>
    );
    if (embedded) {
      return <View style={[styles.embeddedScreen, styles.errorScreen]}>{errorContent}</View>;
    }
    return (
      <Screen scroll={false} safeTop={false} contentStyle={styles.errorScreen}>
        {errorContent}
      </Screen>
    );
  }

  const activePlanFeedback = planFeedback?.threadId === data.thread.id ? planFeedback.feedback : null;
  const activeSendNotice = sendNotice?.threadId === data.thread.id ? sendNotice.message : null;
  const latestRunAssistantLoaded = Boolean(
    data.latestRun?.assistantMessageId
    && data.messages.some((message) => message.id === data.latestRun?.assistantMessageId),
  );
  const visibleRun = data.latestRun && (
    data.latestRun.status !== "succeeded" || !latestRunAssistantLoaded
  )
    ? data.latestRun
    : null;
  const hasConversation = data.messages.length > 0
    || reviewPlans.length > 0
    || Boolean(visibleRun)
    || Boolean(activePlanFeedback)
    || Boolean(activeSendNotice);

  const conversation = (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose coach model"
            disabled={savingModel}
            onPress={() => setShowModels(true)}
            style={({ pressed }) => [styles.modelTrigger, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.modelTriggerText}>
              {selectedModel?.label ?? selection.model}
            </Text>
            {savingModel ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Text style={styles.chevron}>⌄</Text>
            )}
          </Pressable>
          <View style={styles.headerActions}>
            <IconButton label="New chat" symbol="＋" onPress={() => void createThread()} disabled={sending} />
            <IconButton label="Chat history" symbol="☰" onPress={() => setShowThreads(true)} />
          </View>
        </View>

        <ScrollView
          ref={messageListRef}
          style={styles.messageScroll}
          contentContainerStyle={[styles.messageContent, !hasConversation && styles.messageContentEmpty]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: hasConversation })}
        >
          {!hasConversation ? (
            <View style={styles.emptyState}>
              <View style={styles.coachMark}><Text style={styles.coachMarkText}>C</Text></View>
              <Text style={styles.emptyTitle}>How can I help with your training?</Text>
              <View style={styles.promptGrid}>
                {quickPrompts.map((prompt) => (
                  <Pressable
                    key={prompt}
                    accessibilityRole="button"
                    disabled={!data.modelConfiguration.configured || sending || Boolean(activeRunId)}
                    onPress={() => void send(prompt)}
                    style={({ pressed }) => [
                      styles.promptButton,
                      (!data.modelConfiguration.configured || sending || Boolean(activeRunId)) && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.promptText}>{prompt}</Text>
                    <Text style={styles.promptArrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.chatColumn}>
              {data.messages.map((message) => (
                message.role === "user" ? (
                  <View key={message.id} style={styles.userRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.messageText}>{message.content}</Text>
                    </View>
                  </View>
                ) : (
                  <AssistantMessageView key={message.id} message={message} />
                )
              ))}

              {visibleRun ? (
                <CoachRunActivityCard
                  run={visibleRun}
                  connection={runConnection}
                  transportError={runTransportError}
                  retrying={retryingRun}
                  onCheckNow={() => runControllerRef.current?.checkNow()}
                  onRetry={() => void retryCoachRun(visibleRun)}
                />
              ) : sending ? (
                <View style={styles.assistantRow} accessibilityLiveRegion="polite">
                  <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
                  <View style={styles.activityCard}>
                    <View style={styles.runHeadingRow}>
                      <ActivityIndicator color={colors.textMuted} size="small" />
                      <Text style={styles.activityTitle}>Saving your request…</Text>
                    </View>
                    <Text style={styles.runDetail}>Your request is being saved before Coach starts.</Text>
                  </View>
                </View>
              ) : null}

              {reviewPlans.map((plan) => (
                <PlanReviewCard
                  key={plan.id}
                  plan={plan}
                  planBusy={planBusy}
                  onPlan={handlePlan}
                />
              ))}

              {activeSendNotice ? (
                <View style={styles.assistantRow}>
                  <View style={styles.assistantAvatar}>
                    <Text style={styles.assistantAvatarText}>C</Text>
                  </View>
                  <View style={styles.sendNotice}>
                    <Text style={styles.sendNoticeText}>{activeSendNotice}</Text>
                  </View>
                </View>
              ) : null}

              {activePlanFeedback ? (
                <View style={styles.assistantRow}>
                  <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
                  <View style={styles.planFeedback}>
                    <Message tone={activePlanFeedback.tone}>{activePlanFeedback.message}</Message>
                  </View>
                </View>
              ) : null}

            </View>
          )}
        </ScrollView>

        <View style={styles.composerDock}>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          <View style={styles.composerShell}>
            <TextInput
              accessibilityLabel="Message your coach"
              value={composer}
              multiline
              editable={data.modelConfiguration.configured}
              onChangeText={setComposer}
              placeholder={data.modelConfiguration.configured ? "Message Coach" : "OpenAI API key required"}
              placeholderTextColor={colors.textDim}
              selectionColor={colors.accent}
              style={styles.composer}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!composer.trim() || sending || Boolean(activeRunId) || !data.modelConfiguration.configured}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendButton,
                (!composer.trim() || sending || Boolean(activeRunId) || !data.modelConfiguration.configured) && styles.sendButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              {sending ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.sendIcon}>↑</Text>}
            </Pressable>
          </View>
          <Text style={[styles.composerNote, !data.modelConfiguration.configured && styles.setupNote]}>
            {data.modelConfiguration.configured
              ? activeRunId
                ? "You can draft your next message while Coach finishes this request."
                : "Review each proposed change. Only the action buttons make changes."
              : "Connect OPENAI_API_KEY in Site settings to start chatting."}
          </Text>
        </View>

        <OptionModal visible={showModels} title="Model" onClose={() => setShowModels(false)}>
          <View style={styles.modalSection}>
            <View style={styles.modalSectionHeader}>
              <Text style={styles.modalLabel}>Reasoning effort</Text>
              <Text style={styles.modalHint}>Higher can take longer</Text>
            </View>
            <View style={styles.effortRow}>
              {reasoningEfforts.map((effort) => (
                <Pressable
                  key={effort}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selection.reasoningEffort === effort }}
                  disabled={savingModel}
                  onPress={() => chooseReasoningEffort(effort)}
                  style={({ pressed }) => [
                    styles.effortChip,
                    selection.reasoningEffort === effort && styles.effortChipSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.effortText,
                    selection.reasoningEffort === effort && styles.effortTextSelected,
                  ]}>{effort}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.modelListHeader}>
            <Text style={styles.modalLabel}>Available models</Text>
            <Pressable
              accessibilityRole="button"
              disabled={refreshingModels}
              onPress={() => void refreshModels()}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
            >
              {refreshingModels ? (
                <ActivityIndicator color={colors.textMuted} size="small" />
              ) : (
                <Text style={styles.refreshText}>Refresh</Text>
              )}
            </Pressable>
          </View>
          {data.models.map((model) => (
            <Pressable
              key={model.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selection.model === model.id }}
              disabled={savingModel}
              onPress={() => chooseModel(model)}
              style={({ pressed }) => [
                styles.optionRow,
                selection.model === model.id && styles.optionRowSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>{model.label}</Text>
                <Text style={styles.optionSubtitle}>{model.id}</Text>
              </View>
              {selection.model === model.id ? <Text style={styles.optionCheck}>✓</Text> : null}
            </Pressable>
          ))}
          <Text style={styles.catalogSource}>
            {data.modelConfiguration.source === "live" ? "Live model catalog" : "Preview model catalog"}
          </Text>
        </OptionModal>

        <OptionModal visible={showThreads} title="Chats" onClose={() => setShowThreads(false)}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void createThread()}
            style={({ pressed }) => [styles.newChatRow, pressed && styles.pressed]}
          >
            <Text style={styles.newChatPlus}>＋</Text>
            <Text style={styles.newChatText}>New chat</Text>
          </Pressable>
          {data.threads.map((thread) => (
            <Pressable
              key={thread.id}
              accessibilityRole="button"
              accessibilityState={{ selected: data.thread.id === thread.id }}
              onPress={() => {
                setShowThreads(false);
                void load(thread.id);
              }}
              style={({ pressed }) => [
                styles.optionRow,
                data.thread.id === thread.id && styles.optionRowSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionCopy}>
                <Text numberOfLines={1} style={styles.optionTitle}>{thread.title}</Text>
                <Text style={styles.optionSubtitle}>{new Date(thread.updatedAt).toLocaleString()}</Text>
              </View>
            </Pressable>
          ))}
        </OptionModal>
      </KeyboardAvoidingView>
  );

  if (embedded) return <View style={styles.embeddedScreen}>{conversation}</View>;
  return (
    <Screen scroll={false} safeTop={false} contentStyle={styles.screen}>
      {conversation}
    </Screen>
  );
}

function PlanReviewCard({
  plan,
  planBusy,
  onPlan,
}: {
  plan: ChangePlan;
  planBusy: string | null;
  onPlan: (
    planId: string,
    action: "apply" | "reject",
    publish?: boolean,
  ) => void | Promise<void>;
}) {
  const presentation = planReviewPresentation(plan);
  const fallbackDetails = plan.diff.map(readablePlanDiff);
  const sections = presentation.sections.length
    ? presentation.sections
    : [{
      key: "legacy",
      title: "Proposed changes",
      summary: `${fallbackDetails.length} ${fallbackDetails.length === 1 ? "detail" : "details"}`,
      preview: fallbackDetails[0] ?? null,
      details: fallbackDetails,
    }];
  const detailCount = presentation.detailCount
    || sections.reduce((total, section) => total + section.details.length, 0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [showAllDetails, setShowAllDetails] = useState(false);

  function toggleSection(sectionKey: string) {
    setShowAllDetails(false);
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  }

  function toggleAllDetails() {
    if (showAllDetails) {
      setExpandedSections({});
      setShowAllDetails(false);
      return;
    }
    setExpandedSections(Object.fromEntries(sections.map((section) => [section.key, true])));
    setShowAllDetails(true);
  }

  const applyBusyKey = `${plan.id}:apply:true`;
  const draftBusyKey = `${plan.id}:apply:false`;
  const rejectBusyKey = `${plan.id}:reject:true`;
  const primaryTitle = plan.kind === "exercise"
    ? planBusy === applyBusyKey
      ? planApplyBusyLabel(plan, true)
      : exerciseApplyLabel(plan.action)
    : plan.action === "create"
      ? planBusy === applyBusyKey
        ? planApplyBusyLabel(plan, true)
        : plan.status === "applying" ? "Retry creation" : "Create routine"
      : planBusy === applyBusyKey
        ? planApplyBusyLabel(plan, true)
        : "Apply & publish";
  const title = plan.kind === "exercise"
    ? `${plan.exerciseName}: ${plan.summary}`
    : `${plan.action === "create" ? "New routine" : "Routine"} ${plan.routineCode}: ${plan.summary}`;
  const safety = plan.kind === "routine"
    && plan.action === "create"
    && plan.status === "applying"
    ? "Creation was interrupted or is still finishing. Retry shortly; the same routine will not be created twice."
    : "Nothing changes until you choose an action.";

  return (
    <View style={styles.planCard}>
      <View style={styles.planHeader}>
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>
            {plan.kind === "routine"
              ? plan.action === "create" ? "Review new routine" : "Review routine change"
              : `Review exercise ${exerciseActionLabel(plan.action).toLowerCase()}`}
          </Text>
        </View>
        <View style={styles.planHeading}>
          <Text style={styles.planTitle}>{title}</Text>
          {presentation.metadata ? (
            <Text style={styles.planMetadata}>{presentation.metadata}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.planReasoning}>
        <Text style={styles.planSectionLabel}>Why this change</Text>
        <Text style={styles.planRationale}>{plan.rationale}</Text>
      </View>

      <View style={styles.planSafetyRow}>
        <Text style={styles.planSafetyIcon}>i</Text>
        <Text style={styles.planSafetyText}>{safety}</Text>
      </View>

      <View style={styles.planSectionList}>
        {sections.map((section) => {
          const expanded = Boolean(expandedSections[section.key]);
          return (
            <View key={`${plan.id}:${section.key}`} style={styles.planSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${section.title}`}
                accessibilityState={{ expanded }}
                onPress={() => toggleSection(section.key)}
                style={({ pressed }) => [
                  styles.planSectionTrigger,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.planSectionCopy}>
                  <Text style={styles.planSectionTitle}>{section.title}</Text>
                  <Text style={styles.planSectionSummary}>{section.summary}</Text>
                </View>
                <Text style={styles.planSectionChevron}>{expanded ? "−" : "+"}</Text>
              </Pressable>

              {!expanded && section.preview ? (
                <Text numberOfLines={2} style={styles.planSectionPreview}>
                  {section.preview}
                </Text>
              ) : null}

              {expanded ? (
                <View style={styles.planSectionDetails}>
                  {section.details.map((detail, index) => (
                    <Text
                      key={`${plan.id}:${section.key}:${index}`}
                      style={styles.planDetailText}
                    >
                      • {detail}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${showAllDetails ? "Hide" : "Show"} all prescription details`}
        accessibilityState={{ expanded: showAllDetails }}
        onPress={toggleAllDetails}
        style={({ pressed }) => [
          styles.planDisclosure,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.planDisclosureCopy}>
          <Text style={styles.planDisclosureTitle}>All prescription details</Text>
          <Text style={styles.planDisclosureMeta}>
            {detailCount} {detailCount === 1 ? "detail" : "details"}
          </Text>
        </View>
        <Text style={styles.planDisclosureChevron}>{showAllDetails ? "−" : "+"}</Text>
      </Pressable>

      <View style={styles.planActions}>
        <CompactAction
          title={primaryTitle}
          primary
          loading={planBusy === applyBusyKey}
          disabled={Boolean(planBusy)}
          onPress={() => void onPlan(plan.id, "apply", true)}
        />
        {plan.kind === "routine" && plan.action === "update" ? (
          <CompactAction
            title={planBusy === draftBusyKey
              ? planApplyBusyLabel(plan, false)
              : "Save as draft"}
            loading={planBusy === draftBusyKey}
            disabled={Boolean(planBusy)}
            onPress={() => void onPlan(plan.id, "apply", false)}
          />
        ) : null}
        {plan.status === "pending" ? (
          <CompactAction
            title="Dismiss"
            subtle
            loading={planBusy === rejectBusyKey}
            disabled={Boolean(planBusy)}
            onPress={() => void onPlan(plan.id, "reject")}
          />
        ) : null}
      </View>
    </View>
  );
}

function AssistantMessageView({ message }: { message: AssistantMessage }) {
  const activities = coachToolActivityRows(message.activities);
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
      <View style={styles.assistantContent}>
        {activities.length ? (
          <View style={styles.activityCard}>
            <Text style={styles.activityTitle}>Coach activity</Text>
            {activities.map((activity) => (
              <View key={activity.key} style={styles.activityRow}>
                <Text style={activity.tone === "success" ? styles.activitySuccess : styles.activityError}>
                  {activity.tone === "success" ? "✓" : "!"}
                </Text>
                <Text style={styles.activityText}>{activity.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <CoachMarkdown content={message.content} />
      </View>
    </View>
  );
}

function CoachRunActivityCard({
  run,
  connection,
  transportError,
  retrying,
  onCheckNow,
  onRetry,
}: {
  run: CoachMessageRun;
  connection: CoachRunConnection;
  transportError: string;
  retrying: boolean;
  onCheckNow: () => void;
  onRetry: () => void;
}) {
  const presentation = coachRunPresentation(run, connection);
  return (
    <View
      style={styles.assistantRow}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Coach activity. ${presentation.title}. ${presentation.detail}`}
    >
      <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
      <View style={styles.assistantContent}>
        <View style={styles.activityCard}>
          <View style={styles.runHeadingRow}>
            {presentation.active && connection !== "failed" ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : null}
            <Text style={styles.runTitle}>{presentation.title}</Text>
          </View>
          <Text style={styles.runDetail}>{presentation.detail}</Text>
          {run.activities.length ? (
            <View style={styles.runActivityList}>
              {run.activities.map((activity) => (
                <View key={activity.id} style={styles.runActivityItem}>
                  <Text style={activity.status === "succeeded" ? styles.activitySuccess : styles.activityError}>
                    {activity.status === "succeeded" ? "✓" : "!"}
                  </Text>
                  <View style={styles.runActivityCopy}>
                    <Text style={styles.activityText}>{activity.label}</Text>
                    {activity.purpose ? <Text style={styles.runActivityPurpose}>{activity.purpose}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {transportError ? <Text style={styles.runTransportError}>{transportError}</Text> : null}
          {connection === "failed" && presentation.active ? (
            <View style={styles.runActions}>
              <CompactAction title="Check again" onPress={onCheckNow} />
            </View>
          ) : presentation.retryable ? (
            <View style={styles.runActions}>
              <CompactAction
                title={retrying ? "Retrying…" : "Retry request"}
                loading={retrying}
                onPress={onRetry}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function IconButton({
  label,
  symbol,
  onPress,
  disabled = false,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.iconButtonText}>{symbol}</Text>
    </Pressable>
  );
}

function CompactAction({
  title,
  onPress,
  primary = false,
  subtle = false,
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  subtle?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compactAction,
        primary && styles.compactActionPrimary,
        subtle && styles.compactActionSubtle,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <View style={styles.compactActionLoading}>
          <ActivityIndicator color={primary ? colors.background : colors.text} size="small" />
          <Text style={[
            styles.compactActionText,
            primary && styles.compactActionTextPrimary,
            subtle && styles.compactActionTextSubtle,
          ]}>{title}</Text>
        </View>
      ) : (
        <Text style={[
          styles.compactActionText,
          primary && styles.compactActionTextPrimary,
          subtle && styles.compactActionTextSubtle,
        ]}>{title}</Text>
      )}
    </Pressable>
  );
}

function OptionModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityRole="none" onPress={() => undefined} style={styles.modalPanel}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function exerciseActionLabel(action: ExerciseChangePlan["action"]) {
  return action === "create" ? "Create" : action === "update" ? "Update" : "Archive";
}

function exerciseApplyLabel(action: ExerciseChangePlan["action"]) {
  return action === "create" ? "Add to library" : action === "archive" ? "Archive exercise" : "Update exercise";
}

function createCoachMessageIdempotencyKey() {
  return `coach-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createCoachRunRetryIdempotencyKey() {
  return `coach-run-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const styles = StyleSheet.create({
  embeddedScreen: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    maxWidth: 960,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  keyboardView: { flex: 1 },
  errorScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modelTrigger: {
    minHeight: 42,
    maxWidth: "75%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  modelTriggerText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chevron: { color: colors.textMuted, fontSize: 18, lineHeight: 18 },
  headerActions: { flexDirection: "row", gap: spacing.xs },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  iconButtonText: { color: colors.textMuted, fontSize: 21, lineHeight: 24, fontWeight: "600" },
  messageScroll: { flex: 1 },
  messageContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  messageContentEmpty: { justifyContent: "center" },
  emptyState: { width: "100%", maxWidth: 720, alignSelf: "center", alignItems: "center" },
  coachMark: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    marginBottom: spacing.lg,
  },
  coachMarkText: { color: colors.background, fontSize: 22, fontWeight: "900" },
  emptyTitle: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.xl,
  },
  promptGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  promptButton: {
    minWidth: 240,
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  promptText: { flex: 1, color: colors.textMuted, fontSize: 14, lineHeight: 19 },
  promptArrow: { color: colors.textDim, fontSize: 22 },
  chatColumn: { width: "100%", maxWidth: 760, alignSelf: "center", gap: spacing.xl },
  userRow: { width: "100%", alignItems: "flex-end" },
  userBubble: {
    maxWidth: "82%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    backgroundColor: colors.surfaceRaised,
  },
  assistantRow: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  assistantContent: { flex: 1, minWidth: 0, gap: spacing.md },
  assistantAvatar: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    marginTop: 1,
  },
  assistantAvatarText: { color: colors.background, fontSize: 13, fontWeight: "900" },
  activityCard: {
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  activityTitle: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  activitySuccess: { color: colors.success, fontSize: 13, lineHeight: 19, fontWeight: "900" },
  activityError: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: "900" },
  activityText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  runHeadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  runTitle: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  runDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  runActivityList: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  runActivityItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  runActivityCopy: { flex: 1, minWidth: 0, gap: 2 },
  runActivityPurpose: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  runTransportError: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  runActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 23 },
  thinkingRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thinkingText: { color: colors.textMuted, fontSize: 14 },
  planCard: {
    width: "100%",
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  planHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  planBadge: { borderRadius: radii.pill, backgroundColor: colors.accentDark, paddingHorizontal: spacing.md, paddingVertical: 5 },
  planBadgeText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  planHeading: { flex: 1, minWidth: 180, gap: 4 },
  planTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  planMetadata: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  planReasoning: { gap: 4 },
  planSectionLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  planRationale: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  planSafetyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  planSafetyIcon: {
    width: 18,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  planSafetyText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  planActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  planSectionList: { gap: spacing.sm },
  planSection: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  planSectionTrigger: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  planSectionCopy: { flex: 1, minWidth: 0, gap: 2 },
  planSectionTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  planSectionSummary: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  planSectionChevron: {
    width: 22,
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  planSectionPreview: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  planSectionDetails: {
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  planDetailText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  planDisclosure: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  planDisclosureCopy: { flex: 1, minWidth: 0 },
  planDisclosureTitle: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  planDisclosureMeta: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  planDisclosureChevron: {
    width: 22,
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  planFeedback: { flex: 1, minWidth: 0 },
  sendNotice: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  sendNoticeText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  compactAction: {
    minHeight: 36,
    minWidth: 74,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  compactActionPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  compactActionSubtle: { backgroundColor: "transparent", borderColor: "transparent" },
  compactActionText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  compactActionTextPrimary: { color: colors.background },
  compactActionTextSubtle: { color: colors.textMuted },
  compactActionLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  composerDock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  inlineError: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  composerShell: {
    width: "100%",
    maxWidth: 760,
    minHeight: 58,
    maxHeight: 180,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: 9,
    paddingLeft: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 27,
    backgroundColor: colors.surfaceRaised,
  },
  composer: {
    flex: 1,
    minHeight: 38,
    maxHeight: 150,
    paddingTop: 8,
    paddingBottom: 7,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  sendButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: { backgroundColor: colors.borderStrong, opacity: 0.65 },
  sendIcon: { color: colors.background, fontSize: 22, lineHeight: 23, fontWeight: "900" },
  composerNote: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    marginTop: 7,
  },
  setupNote: { color: colors.warning },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.overlay,
  },
  modalPanel: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  modalHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  modalClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  modalCloseText: { color: colors.textMuted, fontSize: 26, lineHeight: 28 },
  modalContent: { padding: spacing.md, gap: spacing.sm },
  modalSection: { padding: spacing.sm, gap: spacing.md },
  modalSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  modalLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  modalHint: { color: colors.textDim, fontSize: 11 },
  effortRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  effortChip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  effortChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  effortText: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  effortTextSelected: { color: colors.accent },
  modelListHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  refreshButton: { minWidth: 64, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  refreshText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  optionRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  optionRowSelected: { backgroundColor: colors.surfaceRaised },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  optionSubtitle: { color: colors.textDim, fontSize: 11 },
  optionCheck: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  catalogSource: { color: colors.textDim, fontSize: 10, textAlign: "center", marginVertical: spacing.sm },
  newChatRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  newChatPlus: { color: colors.text, fontSize: 20 },
  newChatText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
