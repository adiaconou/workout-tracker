import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiRequest } from "../../api/client";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Field,
  Heading,
  LoadingView,
  Message,
  Screen,
} from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";

type CoachProfile = {
  ownerEmail: string;
  primaryGoal: string;
  trainingDaysPerWeek: number;
  sessionDurationMin: number;
  equipment: string;
  limitations: string;
  preferences: string;
  model: string;
  reasoningEffort: string;
  createdAt: string;
  updatedAt: string;
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

type CoachCheckIn = {
  id: string;
  energy: number;
  soreness: number;
  sleepQuality: number;
  availableMinutes: number | null;
  notes: string;
  createdAt: string;
};

type ChangePlan = {
  id: string;
  routineCode: string;
  summary: string;
  rationale: string;
  diff: string[];
  status: "pending" | "applying" | "applied" | "rejected";
  proposedRoutine: {
    focus: string;
    durationMin: number;
    exercises: unknown[];
  };
  appliedVersionId: string | null;
  createdAt: string;
};

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
  checkIns: CoachCheckIn[];
  models: ModelOption[];
  modelConfiguration: {
    configured: boolean;
    source: "live" | "fallback";
    defaultModel: string;
  };
};

type ProfileDraft = Pick<CoachProfile,
  "primaryGoal" | "trainingDaysPerWeek" | "sessionDurationMin" |
  "equipment" | "limitations" | "preferences" | "model" | "reasoningEffort"
>;

const quickPrompts = [
  "Review my recent training and tell me what to prioritize next.",
  "Make my next routine more strength focused without increasing the session length.",
  "Review my set design, rest periods, and RIR targets for my goal.",
];

export function CoachScreen() {
  const [data, setData] = useState<CoachBootstrap | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [energy, setEnergy] = useState(3);
  const [soreness, setSoreness] = useState(2);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [availableMinutes, setAvailableMinutes] = useState("60");
  const [checkInNotes, setCheckInNotes] = useState("");

  const load = useCallback(async (threadId?: string) => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<CoachBootstrap>(
        `/api/v1/assistant${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`,
      );
      setData(payload);
      setProfileDraft(toProfileDraft(payload.profile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const selectedModel = useMemo(
    () => data?.models.find((model) => model.id === profileDraft?.model) ?? data?.models[0] ?? null,
    [data?.models, profileDraft?.model],
  );
  const reasoningEfforts = selectedModel?.reasoningEfforts ?? ["auto"];
  const pendingPlans = data?.plans.filter((plan) => plan.status === "pending") ?? [];

  async function saveProfile() {
    if (!profileDraft) return;
    setSavingProfile(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiRequest<{ profile: CoachProfile }>("/api/v1/assistant/profile", {
        method: "PATCH",
        body: JSON.stringify(profileDraft),
      });
      setData((current) => current ? { ...current, profile: payload.profile } : current);
      setProfileDraft(toProfileDraft(payload.profile));
      setMessage("Coaching profile saved.");
      setShowProfile(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coaching profile could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function send(text = composer) {
    const content = text.trim();
    if (!content || !data || !profileDraft) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiRequest<{
        thread: AssistantThread;
        userMessage: AssistantMessage;
        assistantMessage: AssistantMessage;
        plans: ChangePlan[];
      }>("/api/v1/assistant/messages", {
        method: "POST",
        body: JSON.stringify({
          threadId: data.thread.id,
          content,
          model: profileDraft.model,
          reasoningEffort: profileDraft.reasoningEffort,
        }),
      });
      setData((current) => current ? {
        ...current,
        thread: payload.thread,
        threads: current.threads.map((thread) => thread.id === payload.thread.id ? payload.thread : thread),
        messages: [...current.messages, payload.userMessage, payload.assistantMessage],
        plans: payload.plans,
        profile: {
          ...current.profile,
          model: profileDraft.model,
          reasoningEffort: profileDraft.reasoningEffort,
        },
      } : current);
      setComposer("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coach could not respond.");
    } finally {
      setSending(false);
    }
  }

  async function createThread() {
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

  async function refreshModels() {
    if (!data || !profileDraft) return;
    setRefreshingModels(true);
    setError("");
    try {
      const payload = await apiRequest<{
        models: ModelOption[];
        configured: boolean;
        source: "live" | "fallback";
        defaultModel: string;
      }>("/api/v1/assistant/models");
      const model = payload.models.some((option) => option.id === profileDraft.model)
        ? profileDraft.model
        : payload.defaultModel;
      const option = payload.models.find((candidate) => candidate.id === model);
      const reasoningEffort = option?.reasoningEfforts.includes(profileDraft.reasoningEffort)
        ? profileDraft.reasoningEffort
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
      setProfileDraft({ ...profileDraft, model, reasoningEffort });
      setMessage("Model catalog refreshed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The model catalog could not be refreshed.");
    } finally {
      setRefreshingModels(false);
    }
  }

  async function saveCheckIn() {
    setSavingCheckIn(true);
    setError("");
    setMessage("");
    try {
      const payload = await apiRequest<{ checkIn: CoachCheckIn }>("/api/v1/assistant/check-ins", {
        method: "POST",
        body: JSON.stringify({
          energy,
          soreness,
          sleepQuality,
          availableMinutes: Number(availableMinutes) || null,
          notes: checkInNotes,
        }),
      });
      setData((current) => current ? {
        ...current,
        checkIns: [payload.checkIn, ...current.checkIns].slice(0, 7),
      } : current);
      setCheckInNotes("");
      setShowCheckIn(false);
      setMessage("Readiness check-in saved for the coach.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The check-in could not be saved.");
    } finally {
      setSavingCheckIn(false);
    }
  }

  async function handlePlan(planId: string, action: "apply" | "reject", publish = true) {
    if (!data) return;
    setPlanBusy(`${planId}:${action}:${publish}`);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/v1/assistant/plans/${encodeURIComponent(planId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "apply" ? { publish } : {}),
      });
      await load(data.thread.id);
      setMessage(action === "reject"
        ? "The coaching plan was rejected."
        : publish ? "Routine version approved and published." : "Routine version saved as a draft.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The coaching plan could not be updated.");
    } finally {
      setPlanBusy(null);
    }
  }

  function chooseModel(model: ModelOption) {
    if (!profileDraft) return;
    const reasoningEffort = model.reasoningEfforts.includes(profileDraft.reasoningEffort)
      ? profileDraft.reasoningEffort
      : model.reasoningEfforts.includes("medium") ? "medium" : "auto";
    setProfileDraft({ ...profileDraft, model: model.id, reasoningEffort });
    setShowModels(false);
  }

  if (loading && !data) return <LoadingView label="Opening your coach…" />;
  if (!data || !profileDraft) {
    return (
      <Screen>
        <Message>{error || "The coach could not be loaded."}</Message>
        <Button title="Try again" onPress={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.heroRow}>
        <View style={styles.heroCopy}>
          <Eyebrow>AI training partner</Eyebrow>
          <Heading>Coach</Heading>
          <Body muted>
            Ask about programming, recovery, exercise selection, set design, and rest. Routine edits always wait for your approval.
          </Body>
        </View>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, !data.modelConfiguration.configured && styles.statusDotWarning]} />
          <Text style={styles.statusText}>
            {data.modelConfiguration.configured ? "Ready" : "Setup needed"}
          </Text>
        </View>
      </View>

      {!data.modelConfiguration.configured ? (
        <Message tone="warning">
          The coaching workspace is ready, but an OpenAI API key still needs to be connected to the Site before messages can be sent.
        </Message>
      ) : null}
      {message ? <Message tone="success">{message}</Message> : null}
      {error ? <Message>{error}</Message> : null}

      <Card style={styles.controlCard}>
        <View style={styles.cardHeadingRow}>
          <View style={styles.cardHeadingCopy}>
            <Eyebrow>Conversation</Eyebrow>
            <Heading size="small">{data.thread.title}</Heading>
          </View>
          <View style={styles.inlineActions}>
            <Button title="History" compact variant="ghost" onPress={() => setShowThreads(true)} />
            <Button title="New chat" compact variant="secondary" onPress={() => void createThread()} />
          </View>
        </View>

        <View style={styles.selectorRow}>
          <View style={styles.selectorColumn}>
            <Text style={styles.fieldLabel}>Model</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose coach model"
              onPress={() => setShowModels(true)}
              style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.selectValue}>{selectedModel?.label ?? profileDraft.model}</Text>
              <Text style={styles.selectArrow}>⌄</Text>
            </Pressable>
          </View>
          <View style={styles.sourceColumn}>
            <Text style={styles.sourceText}>
              {data.modelConfiguration.source === "live" ? "Live model catalog" : "Preview catalog"}
            </Text>
            <Button
              title="Refresh"
              compact
              variant="ghost"
              loading={refreshingModels}
              onPress={() => void refreshModels()}
            />
          </View>
        </View>

        <View style={styles.effortSection}>
          <Text style={styles.fieldLabel}>Reasoning effort</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {reasoningEfforts.map((effort) => (
              <ChoiceChip
                key={effort}
                title={effort}
                selected={profileDraft.reasoningEffort === effort}
                onPress={() => setProfileDraft({ ...profileDraft, reasoningEffort: effort })}
              />
            ))}
          </ScrollView>
          <Text style={styles.helperText}>Auto lets the selected model use its default. Higher efforts can take longer and cost more.</Text>
          <View style={styles.modelSaveRow}>
            <Button
              title="Save model settings"
              compact
              variant="secondary"
              loading={savingProfile}
              onPress={() => void saveProfile()}
            />
          </View>
        </View>
      </Card>

      <View style={styles.twoColumnRow}>
        <Card style={styles.compactCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showProfile }}
            onPress={() => setShowProfile((value) => !value)}
            style={styles.disclosureHeader}
          >
            <View style={styles.cardHeadingCopy}>
              <Eyebrow>Goals and guardrails</Eyebrow>
              <Heading size="small">Coaching profile</Heading>
            </View>
            <Text style={styles.disclosureText}>{showProfile ? "Close" : "Edit"}</Text>
          </Pressable>
          {showProfile ? (
            <View style={styles.formStack}>
              <Field
                label="Primary goal"
                value={profileDraft.primaryGoal}
                onChangeText={(primaryGoal) => setProfileDraft({ ...profileDraft, primaryGoal })}
                placeholder="Strength, hypertrophy, conditioning…"
              />
              <View style={styles.fieldPair}>
                <View style={styles.pairField}>
                  <Field
                    label="Days per week"
                    keyboardType="number-pad"
                    value={String(profileDraft.trainingDaysPerWeek)}
                    onChangeText={(value) => setProfileDraft({ ...profileDraft, trainingDaysPerWeek: Number(value) || 0 })}
                  />
                </View>
                <View style={styles.pairField}>
                  <Field
                    label="Minutes per session"
                    keyboardType="number-pad"
                    value={String(profileDraft.sessionDurationMin)}
                    onChangeText={(value) => setProfileDraft({ ...profileDraft, sessionDurationMin: Number(value) || 0 })}
                  />
                </View>
              </View>
              <Field
                label="Equipment"
                value={profileDraft.equipment}
                multiline
                onChangeText={(equipment) => setProfileDraft({ ...profileDraft, equipment })}
                placeholder="Home gym, barbell, dumbbells…"
              />
              <Field
                label="Limitations"
                value={profileDraft.limitations}
                multiline
                onChangeText={(limitations) => setProfileDraft({ ...profileDraft, limitations })}
                placeholder="Movements to avoid or discuss with your coach"
              />
              <Field
                label="Preferences"
                value={profileDraft.preferences}
                multiline
                onChangeText={(preferences) => setProfileDraft({ ...profileDraft, preferences })}
                placeholder="Favorite exercises, progression style, scheduling…"
              />
              <Button title="Save coaching profile" loading={savingProfile} onPress={() => void saveProfile()} />
            </View>
          ) : (
            <Body muted>{profileDraft.primaryGoal} · {profileDraft.trainingDaysPerWeek} days/week · {profileDraft.sessionDurationMin} min</Body>
          )}
        </Card>

        <Card style={styles.compactCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showCheckIn }}
            onPress={() => setShowCheckIn((value) => !value)}
            style={styles.disclosureHeader}
          >
            <View style={styles.cardHeadingCopy}>
              <Eyebrow>Today</Eyebrow>
              <Heading size="small">Readiness check-in</Heading>
            </View>
            <Text style={styles.disclosureText}>{showCheckIn ? "Close" : "Update"}</Text>
          </Pressable>
          {showCheckIn ? (
            <View style={styles.formStack}>
              <RatingPicker label="Energy" value={energy} onChange={setEnergy} low="Low" high="High" />
              <RatingPicker label="Soreness" value={soreness} onChange={setSoreness} low="Fresh" high="Very sore" />
              <RatingPicker label="Sleep" value={sleepQuality} onChange={setSleepQuality} low="Poor" high="Great" />
              <Field
                label="Minutes available"
                keyboardType="number-pad"
                value={availableMinutes}
                onChangeText={setAvailableMinutes}
              />
              <Field
                label="Notes"
                value={checkInNotes}
                multiline
                onChangeText={setCheckInNotes}
                placeholder="Anything the coach should account for today"
              />
              <Button title="Save check-in" loading={savingCheckIn} onPress={() => void saveCheckIn()} />
            </View>
          ) : data.checkIns[0] ? (
            <Body muted>
              Energy {data.checkIns[0].energy}/5 · Soreness {data.checkIns[0].soreness}/5 · Sleep {data.checkIns[0].sleepQuality}/5
            </Body>
          ) : (
            <Body muted>No check-in yet. Add one when recovery should influence the plan.</Body>
          )}
        </Card>
      </View>

      {pendingPlans.map((plan) => (
        <Card key={plan.id} style={styles.planCard}>
          <View style={styles.planTop}>
            <View style={styles.planCode}><Text style={styles.planCodeText}>Routine {plan.routineCode}</Text></View>
            <View style={styles.planHeading}>
              <Eyebrow>Approval required</Eyebrow>
              <Heading size="small">{plan.summary}</Heading>
            </View>
          </View>
          <Body muted>{plan.rationale}</Body>
          <View style={styles.diffList}>
            {plan.diff.map((change, index) => (
              <View key={`${plan.id}:${index}`} style={styles.diffRow}>
                <Text style={styles.diffMarker}>+</Text>
                <Text style={styles.diffText}>{change}</Text>
              </View>
            ))}
          </View>
          <View style={styles.planMeta}>
            <Text style={styles.planMetaText}>{plan.proposedRoutine.exercises.length} exercises</Text>
            <Text style={styles.planMetaText}>{plan.proposedRoutine.durationMin} min</Text>
          </View>
          <View style={styles.planActions}>
            <Button
              title="Approve & publish"
              compact
              loading={planBusy === `${plan.id}:apply:true`}
              disabled={Boolean(planBusy)}
              onPress={() => void handlePlan(plan.id, "apply", true)}
            />
            <Button
              title="Save draft"
              compact
              variant="secondary"
              loading={planBusy === `${plan.id}:apply:false`}
              disabled={Boolean(planBusy)}
              onPress={() => void handlePlan(plan.id, "apply", false)}
            />
            <Button
              title="Reject"
              compact
              variant="ghost"
              loading={planBusy === `${plan.id}:reject:true`}
              disabled={Boolean(planBusy)}
              onPress={() => void handlePlan(plan.id, "reject")}
            />
          </View>
        </Card>
      ))}

      <View style={styles.chatHeading}>
        <View>
          <Eyebrow>Coach conversation</Eyebrow>
          <Heading size="medium">Plan with your data</Heading>
        </View>
        {pendingPlans.length ? <Text style={styles.pendingCount}>{pendingPlans.length} pending</Text> : null}
      </View>

      {!data.messages.length ? (
        <Card style={styles.emptyChat}>
          <Heading size="small">What should we work on?</Heading>
          <Body muted>The coach can inspect your real routines, exercise library, recent workouts, and readiness before answering.</Body>
          <View style={styles.quickPromptList}>
            {quickPrompts.map((prompt) => (
              <Pressable
                key={prompt}
                accessibilityRole="button"
                onPress={() => setComposer(prompt)}
                style={({ pressed }) => [styles.quickPrompt, pressed && styles.pressed]}
              >
                <Text style={styles.quickPromptText}>{prompt}</Text>
                <Text style={styles.quickPromptArrow}>→</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : (
        <View style={styles.messageList}>
          {data.messages.map((item) => (
            <View key={item.id} style={[styles.messageBubble, item.role === "user" ? styles.userBubble : styles.coachBubble]}>
              <Text style={styles.messageRole}>{item.role === "user" ? "You" : "Coach"}</Text>
              <Text style={styles.messageContent}>{item.content}</Text>
              {item.role === "assistant" && item.model ? (
                <Text style={styles.messageMeta}>{item.model} · {item.reasoningEffort}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      <Card style={styles.composerCard}>
        <TextInput
          accessibilityLabel="Message your coach"
          value={composer}
          multiline
          editable={!sending && data.modelConfiguration.configured}
          onChangeText={setComposer}
          placeholder={data.modelConfiguration.configured ? "Ask your coach to review or change your training…" : "Connect the model API key to start coaching"}
          placeholderTextColor={colors.textDim}
          selectionColor={colors.accent}
          style={styles.composer}
        />
        <View style={styles.composerFooter}>
          <Text style={styles.composerHint}>Changes are proposed first and never auto-published.</Text>
          <Button
            title="Send"
            compact
            loading={sending}
            disabled={!composer.trim() || !data.modelConfiguration.configured}
            onPress={() => void send()}
          />
        </View>
      </Card>

      <Body muted style={styles.safetyNote}>
        Coach guidance is for training support, not medical diagnosis. Stop and seek appropriate help for concerning pain or symptoms.
      </Body>

      <OptionModal
        visible={showModels}
        title="Choose a model"
        onClose={() => setShowModels(false)}
      >
        {data.models.map((model) => (
          <Pressable
            key={model.id}
            accessibilityRole="button"
            accessibilityState={{ selected: profileDraft.model === model.id }}
            onPress={() => chooseModel(model)}
            style={({ pressed }) => [
              styles.optionRow,
              profileDraft.model === model.id && styles.optionRowSelected,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>{model.label}</Text>
              <Text style={styles.optionSubtitle}>{model.id}</Text>
              <Text style={styles.optionSubtitle}>Reasoning: {model.reasoningEfforts.join(", ")}</Text>
            </View>
            {profileDraft.model === model.id ? <Text style={styles.optionCheck}>✓</Text> : null}
          </Pressable>
        ))}
      </OptionModal>

      <OptionModal
        visible={showThreads}
        title="Coaching history"
        onClose={() => setShowThreads(false)}
      >
        <Button title="Start a new conversation" onPress={() => void createThread()} />
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
              <Text style={styles.optionTitle}>{thread.title}</Text>
              <Text style={styles.optionSubtitle}>{new Date(thread.updatedAt).toLocaleString()}</Text>
            </View>
          </Pressable>
        ))}
      </OptionModal>
    </Screen>
  );
}

function ChoiceChip({
  title,
  selected,
  onPress,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function RatingPicker({
  label,
  value,
  onChange,
  low,
  high,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  low: string;
  high: string;
}) {
  return (
    <View style={styles.ratingSection}>
      <View style={styles.ratingLabels}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.helperText}>{low} → {high}</Text>
      </View>
      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((ratingValue) => (
          <ChoiceChip
            key={ratingValue}
            title={String(ratingValue)}
            selected={value === ratingValue}
            onPress={() => onChange(ratingValue)}
          />
        ))}
      </View>
    </View>
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
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Card style={styles.modalCard}>
          <View style={styles.modalHeading}>
            <Heading size="medium">{title}</Heading>
            <Button title="Close" compact variant="ghost" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.modalList} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

function toProfileDraft(profile: CoachProfile): ProfileDraft {
  return {
    primaryGoal: profile.primaryGoal,
    trainingDaysPerWeek: profile.trainingDaysPerWeek,
    sessionDurationMin: profile.sessionDurationMin,
    equipment: profile.equipment,
    limitations: profile.limitations,
    preferences: profile.preferences,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
  };
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  heroCopy: { flex: 1, gap: spacing.sm },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  statusDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  statusText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  controlCard: { borderColor: colors.borderStrong },
  cardHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  cardHeadingCopy: { flex: 1, gap: spacing.xs },
  inlineActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  selectorRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  selectorColumn: { flex: 1, gap: 6 },
  sourceColumn: { alignItems: "flex-end", gap: 2 },
  sourceText: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  selectButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, borderRadius: radii.md, paddingHorizontal: spacing.md },
  selectValue: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  selectArrow: { color: colors.accent, fontSize: 18 },
  effortSection: { gap: spacing.sm },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: { minWidth: 46, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "800", textTransform: "capitalize" },
  chipTextSelected: { color: colors.accent },
  helperText: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  modelSaveRow: { alignItems: "flex-start", marginTop: spacing.xs },
  twoColumnRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg, flexWrap: "wrap" },
  compactCard: { flex: 1, minWidth: 280 },
  disclosureHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.md },
  disclosureText: { color: colors.accent, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  formStack: { gap: spacing.md },
  fieldPair: { flexDirection: "row", gap: spacing.md },
  pairField: { flex: 1 },
  ratingSection: { gap: spacing.sm },
  ratingLabels: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  ratingRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  planCard: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  planTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  planCode: { minHeight: 38, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.accent },
  planCodeText: { color: colors.background, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  planHeading: { flex: 1, gap: spacing.xs },
  diffList: { gap: spacing.sm },
  diffRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  diffMarker: { color: colors.accent, fontSize: 16, fontWeight: "900" },
  diffText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  planMeta: { flexDirection: "row", gap: spacing.md },
  planMetaText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  planActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chatHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  pendingCount: { color: colors.warning, fontSize: 12, fontWeight: "800" },
  emptyChat: { gap: spacing.lg },
  quickPromptList: { gap: spacing.sm },
  quickPrompt: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  quickPromptText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  quickPromptArrow: { color: colors.accent, fontSize: 18 },
  messageList: { gap: spacing.md },
  messageBubble: { maxWidth: "92%", padding: spacing.lg, borderRadius: radii.lg, gap: spacing.sm, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.accentDark, borderColor: colors.accent },
  coachBubble: { alignSelf: "flex-start", backgroundColor: colors.surface, borderColor: colors.border },
  messageRole: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  messageContent: { color: colors.text, fontSize: 15, lineHeight: 23 },
  messageMeta: { color: colors.textDim, fontSize: 10 },
  composerCard: { borderColor: colors.borderStrong },
  composer: { minHeight: 110, color: colors.text, fontSize: 16, lineHeight: 23, textAlignVertical: "top", padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
  composerFooter: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  composerHint: { flex: 1, color: colors.textDim, fontSize: 11, lineHeight: 16 },
  safetyNote: { textAlign: "center", fontSize: 11, lineHeight: 17 },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  modalCard: { width: "100%", maxWidth: 620, maxHeight: "86%", borderColor: colors.borderStrong, padding: spacing.xl },
  modalHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  modalList: { gap: spacing.sm },
  optionRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionRowSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  optionSubtitle: { color: colors.textMuted, fontSize: 11 },
  optionCheck: { color: colors.accent, fontSize: 20, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
