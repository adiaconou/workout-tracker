import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
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
import { apiRequest } from "../../api/client";
import { LoadingView, Screen } from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";
import { CoachMarkdown } from "./coach-markdown";

type CoachProfile = {
  model: string;
  reasoningEffort: string;
};

type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type AssistantMessage = {
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

type RoutineChangePlan = ChangePlanBase & {
  kind: "routine";
  action: "create" | "update";
  routineCode: string;
  proposedRoutine: {
    focus: string;
    durationMin: number;
    exercises: unknown[];
  };
};

type ExerciseChangePlan = ChangePlanBase & {
  kind: "exercise";
  action: "create" | "update" | "archive";
  exerciseName: string;
};

type ChangePlan = RoutineChangePlan | ExerciseChangePlan;

type ModelOption = {
  id: string;
  label: string;
  created: number;
  reasoningEfforts: string[];
};

type CoachBootstrap = {
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

type ModelSelection = Pick<CoachProfile, "model" | "reasoningEffort">;

const quickPrompts = [
  "What should I train today?",
  "Review my recent workouts",
  "Improve my next routine",
  "Build me a new routine",
];

export function CoachScreen() {
  const { starter } = useLocalSearchParams<{ starter?: string }>();
  const messageListRef = useRef<ScrollView | null>(null);
  const starterAppliedRef = useRef(false);
  const [data, setData] = useState<CoachBootstrap | null>(null);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
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
      setData(payload);
      setSelection({ model: payload.profile.model, reasoningEffort: payload.profile.reasoningEffort });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  useEffect(() => {
    if (
      starter !== "routine-design" ||
      starterAppliedRef.current ||
      !data ||
      data.messages.length > 0 ||
      composer
    ) {
      return;
    }
    starterAppliedRef.current = true;
    setComposer("Build routines using the equipment and workout length I just selected.");
    router.setParams({ starter: "" });
  }, [composer, data, starter]);

  const selectedModel = useMemo(
    () => data?.models.find((model) => model.id === selection?.model) ?? data?.models[0] ?? null,
    [data?.models, selection?.model],
  );
  const reasoningEfforts = selectedModel?.reasoningEfforts ?? ["auto"];
  const reviewPlans = data?.plans.filter((plan) => (
    plan.status === "pending"
    || (plan.kind === "routine" && plan.action === "create" && plan.status === "applying")
  )) ?? [];

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
      setData((current) => current ? { ...current, profile: { ...current.profile, ...payload.profile } } : current);
      setSelection({ model: payload.profile.model, reasoningEffort: payload.profile.reasoningEffort });
    } catch (caught) {
      setSelection(previous);
      setError(caught instanceof Error ? caught.message : "The model setting could not be saved.");
    } finally {
      setSavingModel(false);
    }
  }

  function chooseModel(model: ModelOption) {
    if (!selection || savingModel) return;
    const reasoningEffort = model.reasoningEfforts.includes(selection.reasoningEffort)
      ? selection.reasoningEffort
      : model.reasoningEfforts.includes("medium") ? "medium" : "auto";
    setShowModels(false);
    void persistModelSettings({ model: model.id, reasoningEffort });
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
      const model = payload.models.some((option) => option.id === selection.model)
        ? selection.model
        : payload.defaultModel;
      const option = payload.models.find((candidate) => candidate.id === model);
      const reasoningEffort = option?.reasoningEfforts.includes(selection.reasoningEffort)
        ? selection.reasoningEffort
        : "auto";
      setData({
        ...data,
        models: payload.models,
        modelConfiguration: {
          configured: payload.configured,
          source: payload.source,
          defaultModel: payload.defaultModel,
        },
      });
      setSelection({ model, reasoningEffort });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The model list could not be refreshed.");
    } finally {
      setRefreshingModels(false);
    }
  }

  async function send(text = composer) {
    const content = text.trim();
    if (!content || !data || !selection || sending || !data.modelConfiguration.configured) return;
    const activeThreadId = data.thread.id;
    const optimisticMessage: AssistantMessage = {
      id: `local-${Date.now()}`,
      threadId: activeThreadId,
      role: "user",
      content,
      model: null,
      reasoningEffort: null,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    setError("");
    setComposer("");
    setData((current) => current ? { ...current, messages: [...current.messages, optimisticMessage] } : current);
    try {
      const payload = await apiRequest<{
        thread: AssistantThread;
        userMessage: AssistantMessage;
        assistantMessage: AssistantMessage;
        plans: ChangePlan[];
      }>("/api/v1/assistant/messages", {
        method: "POST",
        body: JSON.stringify({
          threadId: activeThreadId,
          content,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
        }),
      });
      setData((current) => {
        if (!current || current.thread.id !== activeThreadId) return current;
        return {
          ...current,
          thread: payload.thread,
          threads: current.threads.map((thread) => thread.id === payload.thread.id ? payload.thread : thread),
          messages: [
            ...current.messages.filter((message) => message.id !== optimisticMessage.id),
            payload.userMessage,
            payload.assistantMessage,
          ],
          plans: payload.plans,
          profile: { ...current.profile, ...selection },
        };
      });
    } catch (caught) {
      setData((current) => current ? {
        ...current,
        messages: current.messages.filter((message) => message.id !== optimisticMessage.id),
      } : current);
      setComposer(content);
      setError(caught instanceof Error ? caught.message : "The coach could not respond.");
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

  async function handlePlan(planId: string, action: "apply" | "reject", publish = true) {
    if (!data) return;
    setPlanBusy(`${planId}:${action}:${publish}`);
    setError("");
    try {
      await apiRequest(`/api/v1/assistant/plans/${encodeURIComponent(planId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "apply" ? { publish } : {}),
      });
      await load(data.thread.id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The change could not be completed.";
      await load(data.thread.id);
      setError(message);
    } finally {
      setPlanBusy(null);
    }
  }

  if (loading && !data) return <LoadingView label="Opening Coach…" />;
  if (!data || !selection) {
    return (
      <Screen scroll={false} safeTop={false} contentStyle={styles.errorScreen}>
        <Text style={styles.errorText}>{error || "The coach could not be loaded."}</Text>
        <CompactAction title="Try again" onPress={() => void load()} />
      </Screen>
    );
  }

  const hasConversation = data.messages.length > 0 || reviewPlans.length > 0;

  return (
    <Screen scroll={false} safeTop={false} contentStyle={styles.screen}>
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
                    disabled={!data.modelConfiguration.configured || sending}
                    onPress={() => void send(prompt)}
                    style={({ pressed }) => [
                      styles.promptButton,
                      (!data.modelConfiguration.configured || sending) && styles.disabled,
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
                  <View key={message.id} style={styles.assistantRow}>
                    <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
                    <CoachMarkdown content={message.content} />
                  </View>
                )
              ))}

              {reviewPlans.map((plan) => (
                <View key={plan.id} style={styles.planCard}>
                  <View style={styles.planHeader}>
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>
                        {plan.kind === "routine"
                          ? plan.action === "create" ? "Review new routine" : "Review routine change"
                          : `Review exercise ${exerciseActionLabel(plan.action).toLowerCase()}`}
                      </Text>
                    </View>
                    <Text style={styles.planTitle}>
                      {plan.kind === "exercise"
                        ? `${plan.exerciseName}: ${plan.summary}`
                        : `${plan.action === "create" ? "New routine" : "Routine"} ${plan.routineCode}: ${plan.summary}`}
                    </Text>
                  </View>
                  <Text style={styles.planRationale}>{plan.rationale}</Text>
                  <Text style={styles.planSafety}>
                    {plan.kind === "routine" && plan.action === "create" && plan.status === "applying"
                      ? "Creation was interrupted or is still finishing. Retry shortly; the same routine will not be created twice."
                      : "Nothing changes until you choose an action."}
                  </Text>
                  <View style={styles.planDiff}>
                    {plan.diff.map((change, index) => (
                      <Text key={`${plan.id}:${index}`} style={styles.planDiffText}>• {change}</Text>
                    ))}
                  </View>
                  <View style={styles.planActions}>
                    <CompactAction
                      title={plan.kind === "exercise"
                        ? exerciseApplyLabel(plan.action)
                        : plan.action === "create"
                          ? plan.status === "applying" ? "Retry creation" : "Create routine"
                          : "Apply & publish"}
                      primary
                      loading={planBusy === `${plan.id}:apply:true`}
                      disabled={Boolean(planBusy)}
                      onPress={() => void handlePlan(plan.id, "apply", true)}
                    />
                    {plan.kind === "routine" && plan.action === "update" ? (
                      <CompactAction
                        title="Save as draft"
                        loading={planBusy === `${plan.id}:apply:false`}
                        disabled={Boolean(planBusy)}
                        onPress={() => void handlePlan(plan.id, "apply", false)}
                      />
                    ) : null}
                    {plan.status === "pending" ? (
                      <CompactAction
                        title="Dismiss"
                        subtle
                        loading={planBusy === `${plan.id}:reject:true`}
                        disabled={Boolean(planBusy)}
                        onPress={() => void handlePlan(plan.id, "reject")}
                      />
                    ) : null}
                  </View>
                </View>
              ))}

              {sending ? (
                <View style={styles.assistantRow}>
                  <View style={styles.assistantAvatar}><Text style={styles.assistantAvatarText}>C</Text></View>
                  <View style={styles.thinkingRow}>
                    <ActivityIndicator color={colors.textMuted} size="small" />
                    <Text style={styles.thinkingText}>Thinking…</Text>
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
              editable={!sending && data.modelConfiguration.configured}
              onChangeText={setComposer}
              placeholder={data.modelConfiguration.configured ? "Message Coach" : "OpenAI API key required"}
              placeholderTextColor={colors.textDim}
              selectionColor={colors.accent}
              style={styles.composer}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!composer.trim() || sending || !data.modelConfiguration.configured}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendButton,
                (!composer.trim() || sending || !data.modelConfiguration.configured) && styles.sendButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              {sending ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.sendIcon}>↑</Text>}
            </Pressable>
          </View>
          <Text style={[styles.composerNote, !data.modelConfiguration.configured && styles.setupNote]}>
            {data.modelConfiguration.configured
              ? "Review each proposed change. Only the action buttons make changes."
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
    </Screen>
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
        <ActivityIndicator color={primary ? colors.background : colors.text} size="small" />
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

const styles = StyleSheet.create({
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
  messageText: { color: colors.text, fontSize: 15, lineHeight: 23 },
  thinkingRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thinkingText: { color: colors.textMuted, fontSize: 14 },
  planCard: {
    marginLeft: 40,
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
  planTitle: { flex: 1, minWidth: 180, color: colors.text, fontSize: 15, fontWeight: "800" },
  planRationale: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  planSafety: { color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  planDiff: { gap: 5 },
  planDiffText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  planActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
