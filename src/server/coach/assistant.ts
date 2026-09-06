import { validateRoutineVersionInput } from "../../domain/routines/validation";
import { isRoutineVersionSemanticallyEqual } from "../../domain/routines/comparison";
import type {
  CoachMessageRun,
  CoachMessageContext,
  GeneratedRoutineProgram as GeneratedRoutineProgramPayload,
  ProgramGenerationJob,
} from "../../contracts/api";
import {
  ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS,
  ROUTINE_DURATION_ESTIMATE_TOLERANCE,
  routineDurationToleranceMinutes,
} from "../../domain/routines/duration";
import { getEntityServices } from "../services";
import { getMessageRunRepository, getProgramGenerationJobRepository } from "../db";
import type { StoredAssistantMessageRun, PreparedCoachProposal } from "../db/message-run-repository";
import type { StoredProgramGenerationJob } from "../db/program-generation-job-repository";
import {
  muscleGroups,
  normalizeExerciseName,
  type Exercise,
  type MuscleGroup,
  type RoutineAggregate,
  type RoutineVersionInput,
} from "../../domain/entities";
import {
  equipmentDescription,
  isExerciseEquipmentAvailable,
  trainingProfileFromStored,
} from "../../domain/training-profile";
import {
  assistantModelOption,
  fallbackAssistantModels,
  isCompatibleAssistantModel,
  type AssistantModelOption,
} from "./models";
import {
  type CoachResponse,
  type CoachToolActivity,
  type CoachToolChoice,
} from "./response-types";
import { coachTools } from "./tool-definitions";
import { advanceCoachMessageRun, parseStoredRunActivities } from "./message-run-executor";
import {
  coachMessageRunAwaitsResponseAttachment,
  coachMessageRunExpiresAt,
  coachMessageRunIsExpired,
  coachMessageRunTerminalRetainedUntil,
  coachResponseText,
  fingerprintCoachMessageRequest,
  mapCoachMessageRunRemoteResponse,
  normalizeCoachMessageIdempotencyKey,
  COACH_MESSAGE_RUN_POLL_AFTER_MS,
} from "./message-run";
import {
  buildExerciseChangeDiff,
  completeExerciseInput,
  exerciseInputSnapshot,
  type CompleteExerciseInput,
  type ExerciseChangeAction,
} from "./exercise-change";
import {
  buildRoutineChangeDiff,
  buildRoutineCreationDiff,
  completeRoutineChangeProposal,
  completeRoutineCreationProposal,
} from "./routine-change";
import {
  buildProgramGenerationTool,
  exerciseGenerationContext,
  generatedProgramFromResponse,
  normalizeProgramGenerationRequest,
  unavailableSelectedMuscleGroups,
  type ProgramGenerationRequest,
} from "./program-generation";
import {
  boundedInteger,
  cleanCoachProfile,
  cleanModel,
  cleanReasoningEffort,
  cleanRequiredText,
  cleanText,
  coachInstructions,
  increasesUnavailableExerciseCount,
  nullableRequiredText,
  openAIBaseUrl,
  outputTokenBudget,
  pickDefaultModel,
  rating,
  resolveAssistantRequest,
} from "./policy";
import {
  fingerprintProgramGenerationRequest,
  mapProgramGenerationRemoteResponse,
  normalizeProgramGenerationIdempotencyKey,
  PROGRAM_GENERATION_POLL_AFTER_MS,
  programGenerationAwaitsResponseAttachment,
  programGenerationExpiresAt,
  programGenerationIsExpired,
  programGenerationTerminalRetainedUntil,
  programGenerationValidationLeaseStaleBefore,
  selectProgramGenerationReasoningEffort,
} from "./program-generation-job";
import { apiError, apiResponse, errorMessage, readJson } from "../http";
import { coachExerciseSummary, coachRoutineSummary, coachRoutineDetails, coachWorkoutDetails,
  coachPage, coachPageNumber, normalizeCoachMessageContext } from "./tool-data";
import { applyCoachRoutineEdits } from "./routine-edit";
import { restoreConversationSummary, normalizeCoachTimeZone, buildConversationContext, acceptConversationSummary, skipConversationSummaryRefresh,
  coachCheckInContext, coachSummaryInstructions, coachSummaryJsonSchema, coachContextAuthorityInstructions,
  type ConversationContext } from "./conversation-context";
import type { CoachMessageRunRemoteResult } from "./message-run";
import { coachResponseMetrics, COACH_PROMPT_VERSION } from "./response-metrics";
import type { ApiUser, WorkerEnv } from "../types";

type AssistantContext = {
  request: Request;
  env: WorkerEnv;
  user: ApiUser;
  segments: string[];
};

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

type StoredProgramGenerationContext = {
  request: Pick<
    ProgramGenerationRequest,
    "selectedMuscleGroups" | "routineCount" | "targetDurationMin"
  >;
  availableExercises: Array<Pick<Exercise, "id" | "muscles">>;
  existingRoutineCodes: string[];
};

type AssistantThread = {
  id: string;
  ownerEmail: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type AssistantMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  activities?: CoachToolActivity[];
  model: string | null;
  reasoningEffort: string | null;
  createdAt: string;
};

type AssistantMessageRow = Omit<AssistantMessage, "activities"> & {
  activitiesJson: string;
  contextJson: string;
  timeZone: string;
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

type ChangePlanRow = {
  id: string;
  threadId: string;
  routineId: string;
  routineCode: string;
  baseVersionId: string | null;
  proposedInputJson: string;
  summary: string;
  rationale: string;
  diffJson: string;
  status: string;
  appliedVersionId: string | null;
  originRunId: string | null;
  originUserMessageId: string | null;
  appliedAs: "published" | "draft" | null;
  supersedesPlanId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ExerciseChangePlanRow = {
  id: string;
  threadId: string;
  action: ExerciseChangeAction;
  exerciseId: string | null;
  exerciseName: string;
  baseUpdatedAt: string | null;
  baseInputJson: string | null;
  proposedInputJson: string;
  summary: string;
  rationale: string;
  diffJson: string;
  status: string;
  appliedExerciseId: string | null;
  originRunId: string | null;
  originUserMessageId: string | null;
  appliedAs: "published" | "draft" | null;
  supersedesPlanId: string | null;
  createdAt: string;
  updatedAt: string;
};

const assistantApiTimeoutMs = 55_000;
const assistantBackgroundRequestTimeoutMs = 15_000;
const assistantModelDiscoveryTimeoutMs = 5_000;
const routineCreationApplyLeaseMs = 60_000;
let modelCache: { expiresAt: number; models: AssistantModelOption[] } | null = null;

class OpenAIRequestError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly upstreamStatus: number | null = null,
  ) {
    super(message);
  }
}

class StaleExercisePlanError extends Error {}
class StaleProgramGenerationContextError extends Error {}

export async function handleAssistantRequest(context: AssistantContext) {
  const { request, segments } = context;
  const decision = resolveAssistantRequest(request.method, segments);

  if (decision?.kind === "bootstrap") return assistantBootstrap(context);
  if (decision?.kind === "models") return assistantModels(context);
  if (decision?.kind === "profile-read") {
    return apiResponse(request, { profile: await ensureCoachProfile(context.env, context.user.email) });
  }
  if (decision?.kind === "profile-update") return updateCoachProfile(context);
  if (decision?.kind === "thread-create") return createAssistantThread(context);
  if (decision?.kind === "message-create") return createAssistantMessage(context);
  if (decision?.kind === "message-run-read") return readAssistantMessageRun(context, decision.runId);
  if (decision?.kind === "message-run-advance") return advanceAssistantMessageRun(context, decision.runId);
  if (decision?.kind === "message-run-retry") return retryAssistantMessageRun(context, decision.runId);
  if (decision?.kind === "check-in-create") return createCoachCheckIn(context);
  if (decision?.kind === "program-generate") return generateRoutineProgram(context);
  if (decision?.kind === "program-generation-read") {
    return readRoutineProgramGeneration(context, decision.jobId);
  }
  if (decision?.kind === "program-generation-cancel") {
    return cancelRoutineProgramGeneration(context, decision.jobId);
  }
  if (decision?.kind === "plan-apply") return applyChangePlan(context, decision.planId);
  if (decision?.kind === "plan-reject") return rejectChangePlan(context, decision.planId);

  return apiError(request, 405, "assistant_method_not_allowed", "Method not allowed for the coach.");
}

async function assistantBootstrap({ request, env, user }: AssistantContext) {
  const url = new URL(request.url);
  const profile = await ensureCoachProfile(env, user.email);
  const threads = await listThreads(env, user.email);
  const requestedThreadId = url.searchParams.get("threadId");
  const thread = requestedThreadId
    ? await getThread(env, user.email, requestedThreadId)
    : threads[0] ?? await insertThread(env, user.email);
  if (!thread) {
    return apiError(request, 404, "assistant_thread_not_found", "Coaching conversation not found.");
  }
  const [messages, plans, checkIns, modelCatalog, latestStoredRun] = await Promise.all([
    listMessages(env, user.email, thread.id),
    listChangePlans(env, user.email, thread.id),
    listCheckIns(env, user.email),
    listModelCatalog(env),
    getMessageRunRepository().getLatestForThread(user.email, thread.id),
  ]);
  const latestRun = latestStoredRun && latestStoredRun.status !== "succeeded"
    ? serializeMessageRun(latestStoredRun)
    : null;
  return apiResponse(request, {
    profile,
    threads: threads.some((candidate) => candidate.id === thread.id) ? threads : [thread, ...threads],
    thread,
    messages,
    plans,
    latestRun,
    checkIns,
    models: modelCatalog.models,
    modelConfiguration: {
      configured: Boolean(env.OPENAI_API_KEY),
      source: modelCatalog.source,
      defaultModel: pickDefaultModel(env, modelCatalog.models),
    },
  });
}

async function assistantModels({ request, env }: AssistantContext) {
  const catalog = await listModelCatalog(env, true);
  return apiResponse(request, {
    models: catalog.models,
    configured: Boolean(env.OPENAI_API_KEY),
    source: catalog.source,
    defaultModel: pickDefaultModel(env, catalog.models),
  });
}

async function updateCoachProfile({ request, env, user }: AssistantContext) {
  try {
    const current = await ensureCoachProfile(env, user.email);
    const input = await readJson<Partial<CoachProfile>>(request);
    if (
      Object.prototype.hasOwnProperty.call(input, "equipment")
      || Object.prototype.hasOwnProperty.call(input, "sessionDurationMin")
    ) {
      throw new Error("Equipment and workout duration are managed in your app profile.");
    }
    const profile = cleanCoachProfile({ ...current, ...input });
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE coach_profiles SET primary_goal = ?,
      training_days_per_week = ?, limitations = ?, preferences = ?, model = ?, reasoning_effort = ?,
      updated_at = ? WHERE owner_email = ?`)
      .bind(
        profile.primaryGoal,
        profile.trainingDaysPerWeek,
        profile.limitations,
        profile.preferences,
        profile.model,
        profile.reasoningEffort,
        now,
        user.email,
      ).run();
    return apiResponse(request, {
      profile: { ...profile, ownerEmail: user.email, createdAt: current.createdAt, updatedAt: now },
    });
  } catch (error) {
    return apiError(request, 400, "coach_profile_invalid", errorMessage(error, "The coaching profile could not be saved."));
  }
}

async function createAssistantThread({ request, env, user }: AssistantContext) {
  const thread = await insertThread(env, user.email);
  return apiResponse(request, { thread }, { status: 201 });
}

async function createCoachCheckIn({ request, env, user }: AssistantContext) {
  try {
    const input = await readJson<{
      energy?: number;
      soreness?: number;
      sleepQuality?: number;
      availableMinutes?: number | null;
      notes?: string;
    }>(request);
    const energy = rating(input.energy, "Energy");
    const soreness = rating(input.soreness, "Soreness");
    const sleepQuality = rating(input.sleepQuality, "Sleep quality");
    const availableMinutes = input.availableMinutes === null || input.availableMinutes === undefined
      ? null
      : boundedInteger(input.availableMinutes, 5, 300, "Available minutes");
    const notes = cleanText(input.notes, 600);
    const checkIn: CoachCheckIn = {
      id: crypto.randomUUID(),
      energy,
      soreness,
      sleepQuality,
      availableMinutes,
      notes,
      createdAt: new Date().toISOString(),
    };
    await env.DB.prepare(`INSERT INTO coach_check_ins (
      id, owner_email, energy, soreness, sleep_quality, available_minutes, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(checkIn.id, user.email, energy, soreness, sleepQuality, availableMinutes, notes, checkIn.createdAt)
      .run();
    return apiResponse(request, { checkIn }, { status: 201 });
  } catch (error) {
    return apiError(request, 400, "coach_check_in_invalid", errorMessage(error, "The readiness check-in could not be saved."));
  }
}

async function generateRoutineProgram(context: AssistantContext) {
  const { request, env, user } = context;
  if (!env.OPENAI_API_KEY) {
    return apiError(
      request,
      503,
      "openai_not_configured",
      "Program generation needs an OpenAI API key configured in the Site environment.",
    );
  }

  let generationRequest;
  let idempotencyKey: string;
  try {
    generationRequest = normalizeProgramGenerationRequest(await readJson(request));
    idempotencyKey = normalizeProgramGenerationIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
  } catch (error) {
    return apiError(
      request,
      400,
      "coach_program_generation_invalid",
      errorMessage(error, "Program generation details are invalid."),
    );
  }

  const repository = getProgramGenerationJobRepository();
  let requestFingerprint: string;
  try {
    requestFingerprint = await fingerprintProgramGenerationRequest(generationRequest);
    await repository.pruneExpired(new Date().toISOString());
  } catch (error) {
    return apiError(
      request,
      500,
      "coach_program_generation_error",
      errorMessage(error, "Program generation could not be prepared."),
      true,
    );
  }
  const existingJob = await repository.getByIdempotency(user.email, idempotencyKey);
  if (existingJob) {
    if (existingJob.requestFingerprint !== requestFingerprint) {
      return apiError(
        request,
        409,
        "coach_program_generation_idempotency_conflict",
        "That generation request was already used for different program details.",
      );
    }
    const replayedJob = existingJob.status === "starting"
      && !existingJob.openAIResponseId
      && !programGenerationAwaitsResponseAttachment(existingJob.updatedAt)
      ? await failUnattachedProgramGeneration(user.email, existingJob)
      : existingJob;
    return programGenerationResponse(request, replayedJob, 202, true);
  }

  let job: StoredProgramGenerationJob | null = null;
  let remoteResponseId: string | null = null;
  try {
    const services = getEntityServices();
    const [profile, catalog, exercises, routines] = await Promise.all([
      ensureCoachProfile(env, user.email),
      listModelCatalog(env),
      services.exercises.list(user.email, { availableOnly: true }),
      services.routines.list(user.email, true),
    ]);
    if (!exercises.length) {
      return apiError(
        request,
        409,
        "exercise_library_empty",
        "Add an active exercise supported by your Training Setup before generating a program.",
      );
    }
    const unavailableMuscles = unavailableSelectedMuscleGroups(
      generationRequest.selectedMuscleGroups,
      exercises,
    );
    if (unavailableMuscles.length) {
      return apiError(
        request,
        409,
        "selected_muscles_unavailable",
        `No available exercise is tagged for: ${unavailableMuscles.join(", ")}. Update your Training Setup, exercise tags, or priority muscles.`,
      );
    }

    const model = cleanModel(profile.model ?? pickDefaultModel(env, catalog.models));
    const availableModel = catalog.models.find((option) => option.id === model);
    if (!availableModel) {
      return apiError(
        request,
        400,
        "assistant_model_unavailable",
        "The Coach model saved in your profile is not available for this API key.",
      );
    }
    const reasoningEffort = selectProgramGenerationReasoningEffort(
      availableModel.reasoningEfforts,
    );
    const availableExerciseIds = exercises.map((exercise) => exercise.id);
    const existingRoutineCodes = routines.map((routine) => routine.code);
    const generationTool = buildProgramGenerationTool(
      availableExerciseIds,
      generationRequest.routineCount,
      generationRequest.targetDurationMin,
    );
    const createdAt = new Date().toISOString();
    const storedContext: StoredProgramGenerationContext = {
      request: {
        selectedMuscleGroups: generationRequest.selectedMuscleGroups,
        routineCount: generationRequest.routineCount,
        targetDurationMin: generationRequest.targetDurationMin,
      },
      availableExercises: exercises.map(({ id, muscles }) => ({ id, muscles })),
      existingRoutineCodes,
    };
    const created = await repository.createStarting(user.email, {
      id: crypto.randomUUID(),
      idempotencyKey,
      requestFingerprint,
      requestJson: JSON.stringify(storedContext),
      createdAt,
      expiresAt: programGenerationExpiresAt(createdAt),
    });
    if (created.kind === "conflict") {
      return apiError(
        request,
        409,
        "coach_program_generation_idempotency_conflict",
        "That generation request was already used for different program details.",
      );
    }
    job = created.job;
    if (created.kind === "replayed") {
      return programGenerationResponse(request, job, 202, true);
    }

    const response = await createOpenAIResponse(env, {
      model,
      reasoningEffort,
      safetyIdentifier: user.id,
      instructions: `You design practical strength and fitness programs for review inside Workout Tracker.

Return exactly one complete program by calling return_routine_program. Do not return prose. Use only the supplied available exercise IDs, which are active and compatible with the user's Training Setup. Never invent an exercise or ID. Return exactly the requested number of distinct routines, give each a unique code that does not collide case-insensitively with an existing code, and set every routine durationMin to the requested target. Make positions unique positive integers within their scope. Cover every requested muscle group, prioritizing primary-muscle matches where practical. Keep plans realistic for the user's experience, goal, limitations, movements to avoid, equipment, and preferences. Use the supplied durationEstimatePolicy to keep each routine's deterministic estimate within its allowed tolerance: use the upper set target, count each rep and round using the supplied seconds, double unilateral work, include programmed rest except after the final set, and round up to a minute. Treat duration as a target estimate, not a guarantee. Mention meaningful uncertainty or constraint tradeoffs in warnings using non-medical language. Do not diagnose injuries or medical conditions or make treatment claims. For concerning pain or symptoms, warn the user to stop and seek appropriate professional help.`,
      input: [{
        role: "user",
        content: JSON.stringify({
          request: generationRequest,
          durationEstimatePolicy: {
            ...ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS,
            ...ROUTINE_DURATION_ESTIMATE_TOLERANCE,
            allowedDeltaMinutes: routineDurationToleranceMinutes(
              generationRequest.targetDurationMin,
            ),
          },
          availableEquipment: profile.equipment,
          existingRoutineCodes,
          availableExercises: exerciseGenerationContext(exercises),
        }),
      }],
      tools: [generationTool],
      toolChoice: { type: "function", name: "return_routine_program" },
      background: true,
      metadata: { program_generation_id: job.id },
      textVerbosity: "low",
      timeoutMs: assistantBackgroundRequestTimeoutMs,
      timeoutMessage: "Coach could not start program generation in time. Try again.",
    });
    if (!response.id) {
      throw new OpenAIRequestError("OpenAI did not return a program generation ID.");
    }
    remoteResponseId = response.id;
    const remote = mapProgramGenerationRemoteResponse(response);
    const attached = await repository.attachResponse(
      user.email,
      job.id,
      response.id,
      remote.kind === "pending" ? remote.status : "in_progress",
      new Date().toISOString(),
    );
    job = await repository.get(user.email, job.id);
    if (!attached) {
      if (!job || job.openAIResponseId !== response.id) {
        await cancelOpenAIResponse(env, response.id).catch((cancelError) => {
          console.error("Unattached program generation response could not be cancelled", cancelError);
        });
      }
      if (!job) throw new Error("Program generation could not be reloaded.");
      if (job.status === "cancelling") {
        const cancelled = await finishRoutineProgramGenerationCancellation(context, job);
        return programGenerationResponse(request, cancelled, 202, true);
      }
      return programGenerationResponse(request, job, 202, true);
    }
    if (!job) throw new Error("Program generation could not be reloaded.");
    if (job.status === "cancelling") {
      const cancelled = await finishRoutineProgramGenerationCancellation(context, job);
      return programGenerationResponse(request, cancelled, 202, true);
    }
    const processed = await processRoutineProgramGenerationResponse(context, job, response);
    return programGenerationResponse(request, processed, 202, true);
  } catch (error) {
    const status = error instanceof OpenAIRequestError ? error.status : 500;
    if (remoteResponseId) {
      await cancelOpenAIResponse(env, remoteResponseId).catch((cancelError) => {
        console.error("Failed program generation response could not be cancelled", cancelError);
      });
    }
    if (job) {
      const now = new Date().toISOString();
      await repository.fail(
        user.email,
        job.id,
        {
          code: "coach_program_generation_failed",
          message: errorMessage(error, "The program could not be generated."),
          retryable: status === 429 || status >= 500,
        },
        now,
        programGenerationTerminalRetainedUntil(now),
      ).catch((storageError) => console.error("Program generation failure could not be recorded", storageError));
    }
    return apiError(
      request,
      status,
      error instanceof OpenAIRequestError
        ? "coach_program_generation_failed"
        : "coach_program_generation_error",
      errorMessage(error, "The program could not be generated."),
      status === 429 || status >= 500,
    );
  }
}

async function readRoutineProgramGeneration(
  context: AssistantContext,
  jobId: string,
) {
  const { request, env, user } = context;
  const repository = getProgramGenerationJobRepository();
  const now = new Date().toISOString();
  const job = await repository.get(user.email, jobId);
  if (!job) {
    await repository.pruneExpired(now);
    return apiError(request, 404, "coach_program_generation_not_found", "Program generation not found.");
  }
  if (programGenerationIsTerminal(job.status)) {
    if (programGenerationIsExpired(job.expiresAt, Date.parse(now))) {
      await repository.pruneExpired(now);
      return apiError(request, 404, "coach_program_generation_not_found", "Program generation not found.");
    }
    await repository.pruneExpired(now);
    return programGenerationResponse(request, job);
  }
  if (programGenerationIsExpired(job.expiresAt, Date.parse(now))) {
    const expired = job.status === "cancelling"
      ? await finishRoutineProgramGenerationCancellation(context, job, true)
      : await expireRoutineProgramGeneration(context, job);
    await repository.pruneExpired(now);
    return programGenerationResponse(request, expired);
  }
  await repository.pruneExpired(now);
  if (
    job.status === "starting"
    && !job.openAIResponseId
    && !programGenerationAwaitsResponseAttachment(job.updatedAt, Date.parse(now))
  ) {
    const failed = await failUnattachedProgramGeneration(user.email, job);
    return programGenerationResponse(request, failed);
  }
  if (!env.OPENAI_API_KEY) {
    return apiError(
      request,
      503,
      "openai_not_configured",
      "Program generation needs an OpenAI API key configured in the Site environment.",
      true,
    );
  }
  try {
    if (job.status === "cancelling") {
      const cancelled = await finishRoutineProgramGenerationCancellation(context, job);
      return programGenerationResponse(request, cancelled);
    }
    if (!job.openAIResponseId) {
      return programGenerationResponse(request, job);
    }
    const response = await retrieveOpenAIResponse(env, job.openAIResponseId);
    const processed = await processRoutineProgramGenerationResponse(context, job, response);
    return programGenerationResponse(request, processed);
  } catch (error) {
    if (error instanceof OpenAIRequestError && error.upstreamStatus === 404) {
      const expired = await expireRoutineProgramGeneration(context, job);
      return programGenerationResponse(request, expired);
    }
    const status = error instanceof OpenAIRequestError ? error.status : 500;
    return apiError(
      request,
      status,
      "coach_program_generation_status_failed",
      errorMessage(error, "Coach is still working, but its status could not be checked."),
      status === 429 || status >= 500,
    );
  }
}

async function cancelRoutineProgramGeneration(
  context: AssistantContext,
  jobId: string,
) {
  const { request, user } = context;
  const repository = getProgramGenerationJobRepository();
  const now = new Date().toISOString();
  let job = await repository.get(user.email, jobId);
  if (!job) {
    await repository.pruneExpired(now);
    return apiError(request, 404, "coach_program_generation_not_found", "Program generation not found.");
  }
  if (programGenerationIsTerminal(job.status)) {
    if (programGenerationIsExpired(job.expiresAt, Date.parse(now))) {
      await repository.pruneExpired(now);
      return apiError(request, 404, "coach_program_generation_not_found", "Program generation not found.");
    }
    await repository.pruneExpired(now);
    return programGenerationResponse(request, job);
  }
  const forceSettle = programGenerationIsExpired(job.expiresAt, Date.parse(now));
  if (job.status !== "cancelling") {
    await repository.beginCancel(user.email, job.id, now);
    job = await repository.get(user.email, job.id) ?? job;
  }
  if (!forceSettle) await repository.pruneExpired(now);
  if (programGenerationIsTerminal(job.status)) return programGenerationResponse(request, job);
  try {
    const cancelled = await finishRoutineProgramGenerationCancellation(context, job, forceSettle);
    if (forceSettle) await repository.pruneExpired(now);
    return programGenerationResponse(request, cancelled);
  } catch (error) {
    const status = error instanceof OpenAIRequestError ? error.status : 500;
    return apiError(
      request,
      status,
      "coach_program_generation_cancel_failed",
      errorMessage(error, "Program generation could not be cancelled yet."),
      status === 429 || status >= 500,
    );
  }
}

async function processRoutineProgramGenerationResponse(
  context: AssistantContext,
  job: StoredProgramGenerationJob,
  response: CoachResponse,
) {
  const repository = getProgramGenerationJobRepository();
  let remote;
  try {
    remote = mapProgramGenerationRemoteResponse(response);
  } catch (error) {
    throw new OpenAIRequestError(
      errorMessage(error, "OpenAI returned an unsupported program generation status."),
    );
  }
  const now = new Date().toISOString();
  if (remote.kind === "pending") {
    if (programGenerationIsExpired(job.expiresAt)) {
      return expireRoutineProgramGeneration(context, job);
    }
    await repository.setPending(context.user.email, job.id, remote.status, now);
    return await repository.get(context.user.email, job.id) ?? job;
  }
  if (remote.kind === "cancelled") {
    await repository.cancel(
      context.user.email,
      job.id,
      now,
      programGenerationTerminalRetainedUntil(now),
    );
    return await repository.get(context.user.email, job.id) ?? job;
  }
  if (remote.kind === "failed") {
    await repository.fail(
      context.user.email,
      job.id,
      {
        code: "coach_program_generation_failed",
        message: remote.error,
        retryable: true,
      },
      now,
      programGenerationTerminalRetainedUntil(now),
      job.status === "validating" ? job.updatedAt : undefined,
    );
    return await repository.get(context.user.email, job.id) ?? job;
  }
  return finalizeRoutineProgramGeneration(context, job, response);
}

async function finalizeRoutineProgramGeneration(
  { user }: AssistantContext,
  job: StoredProgramGenerationJob,
  response: CoachResponse,
) {
  const repository = getProgramGenerationJobRepository();
  const validationClaimedAt = new Date().toISOString();
  const claimed = await repository.claimValidation(
    user.email,
    job.id,
    validationClaimedAt,
    programGenerationValidationLeaseStaleBefore(validationClaimedAt),
  );
  if (!claimed) return await repository.get(user.email, job.id) ?? job;

  try {
    const services = getEntityServices();
    const [exercises, routines] = await Promise.all([
      services.exercises.list(user.email, { availableOnly: true }),
      services.routines.list(user.email, true),
    ]);
    const storedContext = storedProgramGenerationContext(
      job.requestJson,
      exercises,
      routines.map((routine) => routine.code),
    );
    const program = generatedProgramFromResponse(response, {
      request: storedContext.request,
      availableExercises: storedContext.availableExercises,
      existingRoutineCodes: storedContext.existingRoutineCodes,
    });
    assertProgramGenerationContextCurrent(program, exercises, routines.map((routine) => routine.code));
    const now = new Date().toISOString();
    await repository.succeed(
      user.email,
      job.id,
      validationClaimedAt,
      program,
      now,
      programGenerationTerminalRetainedUntil(now),
    );
  } catch (error) {
    const now = new Date().toISOString();
    await repository.fail(
      user.email,
      job.id,
      {
        code: error instanceof StaleProgramGenerationContextError
          ? "coach_program_generation_context_changed"
          : "coach_program_generation_failed",
        message: errorMessage(error, "The model returned an invalid routine program."),
        retryable: true,
      },
      now,
      programGenerationTerminalRetainedUntil(now),
      validationClaimedAt,
    );
  }
  return await repository.get(user.email, job.id) ?? job;
}

function storedProgramGenerationContext(
  value: string,
  fallbackExercises: ReadonlyArray<Pick<Exercise, "id" | "muscles">>,
  fallbackRoutineCodes: readonly string[],
) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored program generation context is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (!("request" in record)) {
    return {
      request: normalizeProgramGenerationRequest(record),
      availableExercises: [...fallbackExercises],
      existingRoutineCodes: [...fallbackRoutineCodes],
    };
  }
  if (
    !Array.isArray(record.availableExercises)
    || !record.availableExercises.every((exercise) => (
      exercise !== null
      && typeof exercise === "object"
      && !Array.isArray(exercise)
      && typeof (exercise as Record<string, unknown>).id === "string"
      && Array.isArray((exercise as Record<string, unknown>).muscles)
    ))
    || !Array.isArray(record.existingRoutineCodes)
    || !record.existingRoutineCodes.every((code) => typeof code === "string")
  ) {
    throw new Error("Stored program generation context is invalid.");
  }
  return {
    request: storedProgramGenerationValidationRequest(record.request),
    availableExercises: record.availableExercises as Array<Pick<Exercise, "id" | "muscles">>,
    existingRoutineCodes: record.existingRoutineCodes as string[],
  };
}

function storedProgramGenerationValidationRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored program generation context is invalid.");
  }
  const record = value as Record<string, unknown>;
  return normalizeProgramGenerationRequest({
    name: "",
    goal: "Validate the generated routine program.",
    selectedMuscleGroups: record.selectedMuscleGroups,
    trainingDaysPerWeek: record.routineCount,
    routineCount: record.routineCount,
    targetDurationMin: record.targetDurationMin,
    experienceLevel: "beginner",
    avoid: "",
    limitations: "",
    preferences: "",
  });
}

function assertProgramGenerationContextCurrent(
  program: GeneratedRoutineProgramPayload,
  exercises: ReadonlyArray<Pick<Exercise, "id">>,
  routineCodes: readonly string[],
) {
  const currentExerciseIds = new Set(exercises.map((exercise) => exercise.id));
  const unavailableExercise = program.routines
    .flatMap((routine) => routine.version.exercises)
    .find((exercise) => !currentExerciseIds.has(exercise.exerciseId));
  if (unavailableExercise) {
    throw new StaleProgramGenerationContextError(
      "The exercise library or Training Setup changed while Coach was generating. Generate a fresh draft.",
    );
  }
  const currentRoutineCodes = new Set(routineCodes.map((code) => code.trim().toUpperCase()));
  const collidingRoutine = program.routines.find((routine) => currentRoutineCodes.has(routine.code));
  if (collidingRoutine) {
    throw new StaleProgramGenerationContextError(
      `Routine code ${collidingRoutine.code} was added while Coach was generating. Generate a fresh draft.`,
    );
  }
}

async function finishRoutineProgramGenerationCancellation(
  { env, user }: AssistantContext,
  job: StoredProgramGenerationJob,
  forceSettle = false,
) {
  const repository = getProgramGenerationJobRepository();
  if (job.openAIResponseId) {
    if (!env.OPENAI_API_KEY) {
      if (!forceSettle) {
        throw new OpenAIRequestError(
          "Program generation cannot be cancelled until the OpenAI API key is restored.",
          503,
        );
      }
    } else {
      try {
        await cancelOpenAIResponse(env, job.openAIResponseId);
      } catch (error) {
        const responseNoLongerExists = error instanceof OpenAIRequestError
          && error.upstreamStatus === 404;
        // Cancels are idempotent while OpenAI retains the Response; an exact 404 means there is no
        // remaining remote draft to preserve, so completing the user's local discard is safe.
        if (!responseNoLongerExists && !forceSettle) throw error;
        if (!responseNoLongerExists) {
          console.error("Expired program generation response could not be cancelled", error);
        }
      }
    }
  } else if (!forceSettle && programGenerationAwaitsResponseAttachment(job.updatedAt)) {
    return job;
  }
  const now = new Date().toISOString();
  await repository.cancel(
    user.email,
    job.id,
    now,
    programGenerationTerminalRetainedUntil(now),
  );
  return await repository.get(user.email, job.id) ?? job;
}

async function expireRoutineProgramGeneration(
  { env, user }: AssistantContext,
  job: StoredProgramGenerationJob,
) {
  if (job.openAIResponseId && env.OPENAI_API_KEY) {
    await cancelOpenAIResponse(env, job.openAIResponseId).catch(() => undefined);
  }
  const repository = getProgramGenerationJobRepository();
  const now = new Date().toISOString();
  await repository.expire(
    user.email,
    job.id,
    {
      code: "coach_program_generation_expired",
      message: "Coach did not finish this draft in time. No routines were created.",
      retryable: true,
    },
    now,
    programGenerationTerminalRetainedUntil(now),
    job.status === "validating" ? job.updatedAt : undefined,
  );
  return await repository.get(user.email, job.id) ?? job;
}

async function failUnattachedProgramGeneration(
  ownerEmail: string,
  job: StoredProgramGenerationJob,
) {
  const repository = getProgramGenerationJobRepository();
  const now = new Date().toISOString();
  await repository.failUnattachedStart(
    ownerEmail,
    job.id,
    {
      code: "coach_program_generation_start_lost",
      message: "Coach could not confirm that program generation started. Try again.",
      retryable: true,
    },
    now,
    programGenerationTerminalRetainedUntil(now),
  );
  return await repository.get(ownerEmail, job.id) ?? job;
}

function programGenerationIsTerminal(status: StoredProgramGenerationJob["status"]) {
  return ["succeeded", "failed", "cancelled", "expired"].includes(status);
}

function programGenerationResponse(
  request: Request,
  job: StoredProgramGenerationJob,
  status = 200,
  includeLocation = false,
) {
  const program = job.status === "succeeded" && job.resultJson
    ? JSON.parse(job.resultJson) as GeneratedRoutineProgramPayload
    : null;
  const error = job.errorCode && job.errorMessage
    ? { code: job.errorCode, message: job.errorMessage, retryable: job.errorRetryable }
    : null;
  const generation: ProgramGenerationJob = {
    id: job.id,
    status: job.status === "validating" ? "in_progress" : job.status,
    pollAfterMs: PROGRAM_GENERATION_POLL_AFTER_MS,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    program,
    error,
  };
  const headers = includeLocation
    ? { location: `/api/v1/assistant/program-generations/${encodeURIComponent(job.id)}` }
    : undefined;
  return apiResponse(request, { generation }, { status, headers });
}

async function createAssistantMessage({ request, env, user }: AssistantContext) {
  if (!env.OPENAI_API_KEY) {
    return apiError(request, 503, "openai_not_configured", "The coach needs an OpenAI API key configured in the Site environment.");
  }
  const repository = getMessageRunRepository();
  let thread: AssistantThread;
  let model: string;
  let reasoningEffort: string;
  let content: string;
  let idempotencyKey: string;
  let requestFingerprint: string;
  let messageContext: CoachMessageContext;
  let timeZone: string;
  try {
    const input = await readJson<{
      threadId?: string;
      content?: string;
      model?: string;
      reasoningEffort?: string;
      context?: unknown;
      timeZone?: unknown;
    }>(request);
    content = cleanRequiredText(input.content, "Message", 4_000);
    idempotencyKey = normalizeCoachMessageIdempotencyKey(request.headers.get("x-idempotency-key"));
    const loadedThread = input.threadId
      ? await getThread(env, user.email, input.threadId)
      : await insertThread(env, user.email);
    thread = loadedThread!;
    if (!thread) {
      return apiError(request, 404, "assistant_thread_not_found", "Coaching conversation not found.");
    }
    messageContext = normalizeCoachMessageContext(input.context);
    timeZone = normalizeCoachTimeZone(input.timeZone);
    const profile = await ensureCoachProfile(env, user.email);
    const catalog = await listModelCatalog(env);
    model = cleanModel(input.model ?? profile.model ?? pickDefaultModel(env, catalog.models));
    const availableModel = catalog.models.find((option) => option.id === model);
    if (!availableModel) {
      return apiError(request, 400, "assistant_model_unavailable", "That model is not available for this API key.");
    }
    reasoningEffort = cleanReasoningEffort(
      input.reasoningEffort ?? profile.reasoningEffort,
      availableModel.reasoningEfforts,
    );
    requestFingerprint = await fingerprintCoachMessageRequest({
      threadId: thread.id,
      content,
      model,
      reasoningEffort,
      context: messageContext,
      timeZone,
    });
    if (!await repository.getByIdempotency(user.email, idempotencyKey)) {
      await resolveCoachTarget(env, user.email, thread.id, messageContext);
    }
  } catch (error) {
    return apiError(
      request,
      400,
      "coach_message_invalid",
      errorMessage(error, "The coaching message is invalid."),
    );
  }

  try {
    await repository.pruneExpired(new Date().toISOString());
    await releaseExpiredActiveMessageRun({ request, env, user, segments: [] }, thread.id);
    const now = new Date().toISOString();
    const created = await repository.createStarting(user.email, {
      id: crypto.randomUUID(),
      threadId: thread.id,
      idempotencyKey,
      requestFingerprint,
      userMessageId: crypto.randomUUID(),
      userContent: content,
      userContextJson: JSON.stringify(messageContext),
      timeZone,
      model,
      reasoningEffort,
      createdAt: now,
      expiresAt: coachMessageRunExpiresAt(now),
    });
    if (created.kind === "conflict") {
      return apiError(
        request,
        409,
        "coach_message_idempotency_conflict",
        "That send key was already used for a different coaching message.",
      );
    }
    if (created.kind === "active") {
      return apiError(
        request,
        409,
        "coach_message_run_active",
        "Coach is already working in this conversation. Wait for that response before sending another.",
        true,
      );
    }
    await env.DB.prepare(`UPDATE coach_profiles SET model = ?, reasoning_effort = ?, updated_at = ?
      WHERE owner_email = ?`).bind(model, reasoningEffort, now, user.email).run();
    let run = created.run;
    if (created.kind === "created") run = await startAssistantMessageRun({ request, env, user, segments: [] }, run);
    if (
      created.kind === "replayed"
      && run.status === "starting"
      && !run.openAIResponseId
      && !coachMessageRunAwaitsResponseAttachment(run.updatedAt)
    ) {
      run = await failUnattachedMessageRun(user.email, run);
    }
    return acceptedMessageRunResponse({ request, env, user, segments: [] }, run);
  } catch (error) {
    console.error("Coach message start failed", error);
    return apiError(
      request,
      500,
      "coach_message_start_failed",
      "The coaching request could not be saved. Try again.",
      true,
    );
  }
}

async function readAssistantMessageRun(context: AssistantContext, runId: string) {
  const run = await getMessageRunRepository().get(context.user.email, runId);
  if (!run) {
    return apiError(context.request, 404, "coach_message_run_not_found", "Coaching request not found.");
  }
  return messageRunStatusResponse(context, run);
}

async function retryAssistantMessageRun(context: AssistantContext, runId: string) {
  const { request, env, user } = context;
  const repository = getMessageRunRepository();
  let idempotencyKey: string;
  try {
    idempotencyKey = normalizeCoachMessageIdempotencyKey(request.headers.get("x-idempotency-key"));
  } catch (error) {
    return apiError(request, 400, "coach_message_retry_invalid", errorMessage(error, "Retry details are invalid."));
  }
  let source = await repository.get(user.email, runId);
  if (!source) return apiError(request, 404, "coach_message_run_not_found", "Coaching request not found.");
  if (!messageRunIsTerminal(source.status) && coachMessageRunIsExpired(source.expiresAt)) {
    source = await expireMessageRun(context, source);
  }
  if (source.status !== "failed" && source.status !== "expired") {
    return apiError(request, 409, "coach_message_retry_unavailable", "Only a failed or expired coaching request can be retried.");
  }
  if (!env.OPENAI_API_KEY) {
    return apiError(request, 503, "openai_not_configured", "The coach needs an OpenAI API key configured in the Site environment.");
  }
  try {
    await releaseExpiredActiveMessageRun(context, source.threadId);
    const fingerprint = await fingerprintCoachMessageRequest({
      retryOfRunId: source.id,
      threadId: source.threadId,
      userMessageId: source.userMessageId,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
    });
    const now = new Date().toISOString();
    const created = await repository.createRetryStarting(user.email, {
      id: crypto.randomUUID(),
      sourceRunId: source.id,
      threadId: source.threadId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      userMessageId: source.userMessageId,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      createdAt: now,
      expiresAt: coachMessageRunExpiresAt(now),
    });
    if (created.kind === "conflict") {
      return apiError(request, 409, "coach_message_idempotency_conflict", "That retry key was already used for a different coaching request.");
    }
    if (created.kind === "active") {
      return apiError(request, 409, "coach_message_run_active", "Coach is already working in this conversation.", true);
    }
    const run = created.kind === "created"
      ? await startAssistantMessageRun(context, created.run)
      : created.run;
    return messageRunStatusResponse(context, run, 202, true);
  } catch (error) {
    console.error("Coach message retry failed", error);
    return apiError(
      request,
      500,
      "coach_message_retry_failed",
      "The coaching request could not be retried. Try again.",
      true,
    );
  }
}

async function savedCoachMessageContext(env: WorkerEnv, run: StoredAssistantMessageRun) {
  const stored = await env.DB.prepare(`SELECT context_json AS contextJson, time_zone AS timeZone
    FROM assistant_messages WHERE id = ? AND owner_email = ? AND thread_id = ?`)
    .bind(run.userMessageId, run.ownerEmail, run.threadId).first<{ contextJson: string; timeZone: string }>();
  if (!stored) throw new Error("The saved coaching message was not found.");
  return { context: normalizeCoachMessageContext(JSON.parse(stored.contextJson)), timeZone: normalizeCoachTimeZone(stored.timeZone) };
}

async function resolveCoachTarget(env: WorkerEnv, ownerEmail: string, threadId: string, context: CoachMessageContext) {
  const services = getEntityServices();
  let targetData: unknown = null;
  const target = context.target;
  if (target?.kind === "routine") {
    const routine = await services.routines.get(ownerEmail, target.routineId);
    if (!routine) throw new Error("The selected routine was not found.");
    targetData = { ...target, routine: coachRoutineDetails(routine), versionChanged: Boolean(target.versionId && target.versionId !== routine.currentVersionId) };
  } else if (target?.kind === "exercise") {
    const exercise = await services.exercises.get(ownerEmail, target.exerciseId);
    if (!exercise) throw new Error("The selected exercise was not found.");
    targetData = { ...target, exercise: coachExerciseSummary(exercise) };
  } else if (target?.kind === "workout") {
    const workout = await services.workouts.get(ownerEmail, target.workoutId);
    if (!workout) throw new Error("The selected workout was not found.");
    const placement = target.viewedSetId ? workout.exercises.find((exercise) => exercise.sets.some((set) =>
      set.id === target.viewedSetId || set.prescribedSetId === target.viewedSetId)) : null;
    if (target.viewedSetId && !placement) throw new Error("The selected set does not belong to this workout.");
    targetData = { ...target, routineCode: workout.routineCode, status: workout.status,
      viewedExercise: placement ? { id: placement.id, exerciseId: placement.exerciseId, name: placement.exerciseNameSnapshot } : null,
      viewedSet: placement?.sets.find((set) => set.id === target.viewedSetId || set.prescribedSetId === target.viewedSetId) ?? null };
  }
  let revision: unknown = null;
  if (context.revisePlanId) {
    const plan = await getThreadPlan(env, ownerEmail, threadId, context.revisePlanId);
    if (plan.status !== "pending") throw new Error("The selected proposal was already handled. Start a new request using the current data.");
    revision = { planId: plan.id, status: plan.status, summary: plan.summary, instruction: "Read this proposal with get_plan before revising it." };
  }
  return { target: targetData, revision };
}

async function currentCoachInstructions(env: WorkerEnv, run: StoredAssistantMessageRun) {
  const [profile, checkIns, saved] = await Promise.all([
    ensureCoachProfile(env, run.ownerEmail), listCheckIns(env, run.ownerEmail), savedCoachMessageContext(env, run),
  ]);
  return coachInstructions(profile, checkIns, coachCheckInContext(checkIns, saved.timeZone)) + "\n\n" + coachContextAuthorityInstructions;
}

async function loadCoachConversationContext(env: WorkerEnv, run: StoredAssistantMessageRun): Promise<ConversationContext> {
  const snapshot = JSON.parse(run.contextStateJson) as Partial<ConversationContext>;
  if (Array.isArray(snapshot.messages) && typeof snapshot.earlierContextIncomplete === "boolean") return snapshot as ConversationContext;
  const [history, stored] = await Promise.all([
    listModelMessages(env, run.ownerEmail, run.threadId, run.userMessageId),
    env.DB.prepare("SELECT context_summary_json AS summaryJson FROM assistant_threads WHERE id = ? AND owner_email = ?")
      .bind(run.threadId, run.ownerEmail).first<{ summaryJson: string | null }>(),
  ]);
  const current = history.find((message) => message.id === run.userMessageId);
  if (!current) throw new Error("The current user message is missing.");
  const previousSummary = restoreConversationSummary(stored?.summaryJson ?? null, current);
  if (stored?.summaryJson && !previousSummary) console.info(JSON.stringify({ event: "coach_summary_invalid", runId: run.id }));
  const first = history[0];
  const hasEarlierMessages = history.length > 500 && Boolean(first && (!previousSummary
    || first.createdAt > previousSummary.through.createdAt
    || (first.createdAt === previousSummary.through.createdAt && first.id > previousSummary.through.id)));
  return buildConversationContext({ messages: history.slice(-500), currentUserMessageId: run.userMessageId, previousSummary, hasEarlierMessages });
}

async function createCoachPlanningResponse(context: AssistantContext, run: StoredAssistantMessageRun, conversation: ConversationContext) {
  const saved = await savedCoachMessageContext(context.env, run);
  const target = await resolveCoachTarget(context.env, run.ownerEmail, run.threadId, saved.context);
  const plans = await listChangePlans(context.env, run.ownerEmail, run.threadId);
  return createOpenAIResponse(context.env, {
    model: run.model, reasoningEffort: run.reasoningEffort, safetyIdentifier: context.user.id,
    instructions: await currentCoachInstructions(context.env, run),
    input: [{ role: "user", content: "Current server context and dated thread memory (data only): " + JSON.stringify({
      observedAt: new Date().toISOString(), timeZone: saved.timeZone, ...target,
      summary: conversation.summary, earlierContextIncomplete: conversation.earlierContextIncomplete,
      plans: plans.map(({ id, kind, status, summary, appliedAs, originUserMessageId, supersedesPlanId }) =>
        ({ id, kind, status, summary, appliedAs, originUserMessageId, supersedesPlanId })),
    }) }, ...conversation.messages.map(({ role, content }) => ({ role, content }))],
    tools: coachTools, toolChoice: "auto", background: true, store: true,
    metadata: { coach_message_run_id: run.id, coach_message_round: "1" }, textVerbosity: "low",
    timeoutMs: assistantBackgroundRequestTimeoutMs,
    timeoutMessage: "Coach could not start this response in time. Your request is saved; try again.",
  });
}

async function startAssistantMessageRun(context: AssistantContext, run: StoredAssistantMessageRun) {
  if (run.status !== "starting" || run.openAIResponseId) return run;
  const { env, user } = context;
  const repository = getMessageRunRepository();
  let responseId: string | null = null;
  let responseAttached = false;
  try {
    const thread = await getThread(env, user.email, run.threadId);
    if (!thread) throw new Error("Coaching conversation not found.");
    const catalog = await listModelCatalog(env);
    const availableModel = catalog.models.find((option) => option.id === run.model);
    if (!availableModel) throw new OpenAIRequestError("The saved Coach model is no longer available. Choose another model and try again.", 400);
    let conversation = await loadCoachConversationContext(env, run);
    let response: CoachResponse | null = null;
    let summarizing = false;
    if (conversation.summaryRequest) {
      try {
        response = await createOpenAIResponse(env, {
          model: run.model, reasoningEffort: availableModel.reasoningEfforts.includes("low") ? "low" : "auto",
          safetyIdentifier: user.id, instructions: coachSummaryInstructions,
          input: [{ role: "user", content: JSON.stringify(conversation.summaryRequest) }], tools: [], toolChoice: "none",
          background: true, store: true, metadata: { coach_message_run_id: run.id, coach_message_round: "summary" },
          textVerbosity: "low", textFormat: { type: "json_schema", name: "coach_thread_summary", strict: true, schema: coachSummaryJsonSchema },
          maxOutputTokens: 6000, timeoutMs: assistantBackgroundRequestTimeoutMs,
        });
        if (!response.id) throw new Error("No summary response ID.");
        summarizing = true;
      } catch {
        conversation = skipConversationSummaryRefresh(conversation);
        response = null;
        console.info(JSON.stringify({ event: "coach_summary_skipped", runId: run.id, reason: "start_failed" }));
      }
    }
    response ??= await createCoachPlanningResponse(context, run, conversation);
    if (!response.id) throw new OpenAIRequestError("OpenAI did not return a Coach response ID.");
    responseId = response.id;
    const remote = mapCoachMessageRunRemoteResponse(response);
    const attached = await repository.attachResponse(user.email, run.id, {
      openAIResponseId: response.id, previousResponseId: null,
      responseIdsJson: JSON.stringify(appendResponseId([], response.id)),
      contextStateJson: JSON.stringify(conversation), status: remote.kind === "pending" ? remote.status : "in_progress",
      phase: summarizing ? "summarizing" : "planning", roundCount: summarizing ? 0 : 1, updatedAt: new Date().toISOString(),
    });
    responseAttached = attached;
    const reloaded = await repository.get(user.email, run.id);
    if (!attached && reloaded?.openAIResponseId !== response.id) await deleteOpenAIResponse(env, response.id).catch(() => undefined);
    return reloaded ?? run;
  } catch (error) {
    const current = await repository.get(user.email, run.id).catch(() => null);
    if (responseId && !responseAttached && current && current.openAIResponseId !== responseId) {
      await deleteOpenAIResponse(env, responseId).catch(() => undefined);
    }
    if (!responseAttached) {
      const now = new Date().toISOString();
      await repository.failUnattached(user.email, run.id, { expectedUpdatedAt: run.updatedAt,
        error: publicMessageRunError(error), updatedAt: now, expiresAt: coachMessageRunTerminalRetainedUntil(now) });
    }
    return await repository.get(user.email, run.id) ?? current ?? run;
  }
}

async function processCoachSummaryResponse(context: AssistantContext, run: StoredAssistantMessageRun, leaseToken: string, remote: CoachMessageRunRemoteResult) {
  let conversation = JSON.parse(run.contextStateJson) as ConversationContext;
  let summaryAccepted = false;
  try {
    if (remote.kind !== "ready") throw new Error("Summary generation did not complete.");
    conversation = acceptConversationSummary(conversation, JSON.parse(coachResponseText(remote.response)));
    summaryAccepted = true;
  } catch {
    conversation = skipConversationSummaryRefresh(conversation);
    console.info(JSON.stringify({ event: "coach_summary_skipped", runId: run.id, reason: "invalid_or_failed" }));
  }
  const summary = conversation.summary;
  if (summaryAccepted && summary) {
    const now = new Date().toISOString();
    try {
      await context.env.DB.prepare(`UPDATE assistant_threads SET context_summary_json = ?,
      context_summary_through_message_id = ?, context_summary_updated_at = ?
      WHERE id = ? AND owner_email = ?
        AND EXISTS (SELECT 1 FROM assistant_message_runs WHERE id = ? AND owner_email = ?
          AND status = 'processing' AND lease_token = ? AND lease_expires_at > ? AND expires_at > ?)
        AND (context_summary_through_message_id IS NULL OR EXISTS (
          SELECT 1 FROM assistant_messages cursor WHERE cursor.id = context_summary_through_message_id
            AND cursor.owner_email = assistant_threads.owner_email AND cursor.thread_id = assistant_threads.id
            AND (cursor.created_at < ? OR (cursor.created_at = ? AND cursor.id <= ?))))`)
      .bind(JSON.stringify(summary), summary.through.id, now, run.threadId, run.ownerEmail,
        run.id, run.ownerEmail, leaseToken, now, now, summary.through.createdAt, summary.through.createdAt, summary.through.id).run();
    } catch {
      console.info(JSON.stringify({ event: "coach_summary_save_failed", runId: run.id }));
    }
  }
  const response = await createCoachPlanningResponse(context, run, conversation);
  if (!response.id) throw new OpenAIRequestError("OpenAI did not return a Coach response ID.");
  const mapped = mapCoachMessageRunRemoteResponse(response);
  const repository = getMessageRunRepository();
  const attached = await repository.attachResponse(run.ownerEmail, run.id, {
    openAIResponseId: response.id, previousResponseId: null,
    responseIdsJson: JSON.stringify(appendResponseId(parseResponseIds(run.responseIdsJson), response.id)),
    contextStateJson: JSON.stringify(conversation), pendingInputJson: "[]",
    status: mapped.kind === "pending" ? mapped.status : "in_progress", phase: "planning", roundCount: 1,
    updatedAt: new Date().toISOString(), leaseToken,
  });
  const reloaded = await repository.get(run.ownerEmail, run.id);
  if (!attached && reloaded?.openAIResponseId !== response.id) await deleteOpenAIResponse(context.env, response.id).catch(() => undefined);
  return reloaded ?? run;
}

async function advanceAssistantMessageRun(context: AssistantContext, runId: string) {
  const { request, env, user } = context;
  const result = await advanceCoachMessageRun({ ownerEmail: user.email, runId }, {
    store: getMessageRunRepository(), available: Boolean(env.OPENAI_API_KEY),
    now: Date.now, createId: () => crypto.randomUUID(),
    retrieveResponse: (id) => retrieveOpenAIResponse(env, id),
    createContinuation: async (run, toolOutputs, previousResponseId) => createOpenAIResponse(env, {
      model: run.model, reasoningEffort: run.reasoningEffort, safetyIdentifier: user.id,
      instructions: await currentCoachInstructions(env, run), input: toolOutputs,
      tools: coachTools, toolChoice: run.forceFinal ? "none" : "auto", previousResponseId,
      background: true, store: true, metadata: { coach_message_run_id: run.id,
        coach_message_round: String(run.roundCount + 1) }, textVerbosity: "low",
      timeoutMs: assistantBackgroundRequestTimeoutMs,
      timeoutMessage: "Coach could not start the next step in time. Your progress is saved.",
    }),
    executeTool: async (run, call, identity) => executeCoachTool({ env, user,
      thread: (await getThread(env, user.email, run.threadId))!, run, identity,
      name: call.name, argumentsValue: call.argumentsValue }),
    recordToolCall: (run, call, output, status, id) => recordToolCall(env, user.email, run.threadId,
      call.name, call.argumentsValue, output, status, id),
    reportAuditError: (error) => console.error("Coach run audit failed", error),
    classifyRequestError: (error) => error instanceof OpenAIRequestError
      ? { ...publicMessageRunError(error), status: error.status, upstreamStatus: error.upstreamStatus } : null,
    publicError: publicMessageRunError,
    formatToolError: (error) => errorMessage(error, "The coaching check failed."),
    expireRun: (run) => expireMessageRun(context, run),
    failUnattachedRun: (run) => failUnattachedMessageRun(user.email, run),
    succeedRun: (run, lease, content, responseId) => succeedMessageRun(context, run, lease, content, responseId),
    failRun: (run, lease, error) => failClaimedMessageRun(context, run, lease, error),
    deleteResponse: (id) => deleteOpenAIResponse(env, id),
    processSummaryResponse: (run, lease, remote) => processCoachSummaryResponse(context, run, lease, remote),
  });
  if (result.kind === "not_found") return apiError(request, 404, "coach_message_run_not_found", "Coaching request not found.");
  if (result.kind === "unavailable") return apiError(request, result.error.status,
    result.error.code, result.error.message, result.error.retryable);
  return messageRunStatusResponse(context, result.run);
}

async function succeedMessageRun(
  context: AssistantContext,
  run: StoredAssistantMessageRun,
  leaseToken: string,
  content: string,
  responseId: string | null,
) {
  const repository = getMessageRunRepository();
  const activities = parseStoredRunActivities(run.activitiesJson);
  const now = new Date().toISOString();
  await repository.succeed(context.user.email, run.id, leaseToken, {
    assistantMessageId: crypto.randomUUID(),
    content,
    responseId,
    runActivitiesJson: JSON.stringify(activities),
    messageActivitiesJson: JSON.stringify(activities.map(({ name, status }) => ({ name, status }))),
    createdAt: now,
    expiresAt: coachMessageRunTerminalRetainedUntil(now),
  });
  const reloaded = await repository.get(context.user.email, run.id) ?? run;
  await cleanupMessageRunResponses(context, reloaded);
  return await repository.get(context.user.email, run.id) ?? reloaded;
}

async function failClaimedMessageRun(
  context: AssistantContext,
  run: StoredAssistantMessageRun,
  leaseToken: string,
  error: { code: string; message: string; retryable: boolean },
) {
  const now = new Date().toISOString();
  await getMessageRunRepository().fail(
    context.user.email,
    run.id,
    error,
    now,
    coachMessageRunTerminalRetainedUntil(now),
    leaseToken,
  );
  const reloaded = await getMessageRunRepository().get(context.user.email, run.id) ?? run;
  await cleanupMessageRunResponses(context, reloaded);
  return await getMessageRunRepository().get(context.user.email, run.id) ?? reloaded;
}

async function failUnattachedMessageRun(ownerEmail: string, run: StoredAssistantMessageRun) {
  const repository = getMessageRunRepository();
  const now = new Date().toISOString();
  await repository.failUnattached(ownerEmail, run.id, {
    expectedUpdatedAt: run.updatedAt,
    error: { code: "coach_message_start_lost",
      message: "Coach could not confirm that this response started. Your request is saved; try again.", retryable: true },
    updatedAt: now, expiresAt: coachMessageRunTerminalRetainedUntil(now),
  });
  return await repository.get(ownerEmail, run.id) ?? run;
}

async function expireMessageRun(context: AssistantContext, run: StoredAssistantMessageRun) {
  const repository = getMessageRunRepository();
  const now = new Date().toISOString();
  await repository.expireIfPast(
    context.user.email,
    run.id,
    {
      code: "coach_message_expired",
      message: "This coaching request expired before it finished. Your message is saved and no routine changes were made.",
      retryable: true,
    },
    now,
    coachMessageRunTerminalRetainedUntil(now),
  );
  const reloaded = await repository.get(context.user.email, run.id) ?? run;
  await cleanupMessageRunResponses(context, reloaded, true);
  return await repository.get(context.user.email, run.id) ?? reloaded;
}

async function releaseExpiredActiveMessageRun(context: AssistantContext, threadId: string) {
  const active = await getMessageRunRepository().getActiveForThread(context.user.email, threadId);
  if (!active || !coachMessageRunIsExpired(active.expiresAt)) return;
  await expireMessageRun(context, active);
}

async function cleanupMessageRunResponses(
  context: AssistantContext,
  run: StoredAssistantMessageRun,
  cancelCurrent = false,
) {
  if (!messageRunIsTerminal(run.status)) return;
  if (!context.env.OPENAI_API_KEY) return;
  const ids = parseResponseIds(run.responseIdsJson);
  if (run.openAIResponseId && !ids.includes(run.openAIResponseId)) ids.push(run.openAIResponseId);
  if (!ids.length) return;
  if (cancelCurrent && run.openAIResponseId) {
    await cancelOpenAIResponse(context.env, run.openAIResponseId).catch(() => undefined);
  }
  const cleanup = await Promise.allSettled(ids.map((id) => deleteOpenAIResponse(context.env, id)));
  const removed = cleanup.every((result) => (
    result.status === "fulfilled"
    || (result.reason instanceof OpenAIRequestError && result.reason.upstreamStatus === 404)
  ));
  if (removed) await getMessageRunRepository().clearResponseIds(context.user.email, run.id);
}

async function acceptedMessageRunResponse(
  context: AssistantContext,
  run: StoredAssistantMessageRun,
) {
  const [thread, userMessage, plans] = await Promise.all([
    getThread(context.env, context.user.email, run.threadId),
    getMessage(context.env, context.user.email, run.threadId, run.userMessageId),
    listChangePlans(context.env, context.user.email, run.threadId),
  ]);
  if (!thread || !userMessage) throw new Error("The saved coaching request could not be reloaded.");
  return apiResponse(context.request, {
    thread,
    userMessage,
    run: serializeMessageRun(run),
    plans,
  }, {
    status: 202,
    headers: {
      location: `/api/v1/assistant/message-runs/${encodeURIComponent(run.id)}`,
      "cache-control": "no-store",
    },
  });
}

async function messageRunStatusResponse(
  context: AssistantContext,
  run: StoredAssistantMessageRun,
  status = 200,
  includeLocation = false,
) {
  const [assistantMessage, plans] = await Promise.all([
    run.assistantMessageId
      ? getMessage(context.env, context.user.email, run.threadId, run.assistantMessageId)
      : null,
    listChangePlans(context.env, context.user.email, run.threadId),
  ]);
  return apiResponse(context.request, {
    run: serializeMessageRun(run),
    assistantMessage,
    plans,
  }, {
    status,
    headers: {
      ...(includeLocation
        ? { location: `/api/v1/assistant/message-runs/${encodeURIComponent(run.id)}` }
        : {}),
      "cache-control": "no-store",
    },
  });
}

function serializeMessageRun(run: StoredAssistantMessageRun): CoachMessageRun {
  const storedExpired = !messageRunIsTerminal(run.status) && coachMessageRunIsExpired(run.expiresAt);
  const status = storedExpired
    ? "expired" as const
    : run.status === "processing"
      ? "in_progress" as const
      : run.status === "cancelled"
        ? "failed" as const
        : run.status;
  const validPhase = ["summarizing", "planning", "checking", "recovering", "synthesizing", "review_ready"]
    .includes(run.phase);
  const error = storedExpired
    ? {
      code: "coach_message_expired",
      message: "This coaching request expired before it finished. Your message is saved and no routine changes were made.",
      retryable: true,
    }
    : run.errorCode && run.errorMessage
      ? { code: run.errorCode, message: run.errorMessage, retryable: run.errorRetryable }
      : null;
  return {
    id: run.id,
    threadId: run.threadId,
    userMessageId: run.userMessageId,
    status,
    phase: validPhase ? run.phase as CoachMessageRun["phase"] : "planning",
    activities: parseStoredRunActivities(run.activitiesJson).map(({ name: _name, ...activity }) => activity),
    pollAfterMs: COACH_MESSAGE_RUN_POLL_AFTER_MS,
    assistantMessageId: run.assistantMessageId,
    error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expiresAt: run.expiresAt,
  };
}

function publicMessageRunError(error: unknown) {
  if (error instanceof OpenAIRequestError) {
    if (error.status === 429) {
      return {
        code: "coach_rate_limited",
        message: "Coach is temporarily rate-limited. Your request is saved; try again in a moment.",
        retryable: true,
      };
    }
    if (error.status === 504) {
      return {
        code: "coach_model_timeout",
        message: "Coach’s model request timed out. Your request is saved; try again.",
        retryable: true,
      };
    }
    if (error.status >= 500) {
      return {
        code: "coach_model_unavailable",
        message: "Coach’s model service is temporarily unavailable. Your request is saved; try again.",
        retryable: true,
      };
    }
    return {
      code: "coach_model_request_invalid",
      message: "Coach could not use the selected model for this request. Choose another model and try again.",
      retryable: false,
    };
  }
  return {
    code: "coach_message_run_failed",
    message: "Coach could not finish this response. Your request is saved and no routine changes were made.",
    retryable: true,
  };
}

function messageRunIsTerminal(status: StoredAssistantMessageRun["status"]) {
  return ["succeeded", "failed", "expired", "cancelled"].includes(status);
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseResponseIds(value: string) {
  return parseJsonArray(value).filter((id): id is string => typeof id === "string");
}

function appendResponseId(ids: readonly string[], id: string) {
  return [...ids.filter((candidate) => candidate !== id), id];
}

async function getMessage(
  env: WorkerEnv,
  ownerEmail: string,
  threadId: string,
  messageId: string,
) {
  const row = await env.DB.prepare(`SELECT id, thread_id AS threadId, role, content,
    model, reasoning_effort AS reasoningEffort, activities_json AS activitiesJson,
    created_at AS createdAt FROM assistant_messages
    WHERE id = ? AND owner_email = ? AND thread_id = ?`)
    .bind(messageId, ownerEmail, threadId)
    .first<AssistantMessageRow>();
  if (!row) return null;
  const { activitiesJson, ...message } = row;
  return { ...message, activities: JSON.parse(activitiesJson) as CoachToolActivity[] };
}

async function listModelMessages(
  env: WorkerEnv,
  ownerEmail: string,
  threadId: string,
  currentUserMessageId: string,
) {
  const rows = await env.DB.prepare(`SELECT id, thread_id AS threadId, role, content,
    model, reasoning_effort AS reasoningEffort, activities_json AS activitiesJson,
    created_at AS createdAt FROM (
      SELECT message.id, message.thread_id, message.role, message.content,
        message.model, message.reasoning_effort, message.activities_json, message.created_at
      FROM assistant_messages AS message
      WHERE message.owner_email = ? AND message.thread_id = ?
      AND (message.created_at, message.id) <= (
        SELECT created_at, id FROM assistant_messages WHERE id = ? AND owner_email = ? AND thread_id = ?
      ) AND (
        message.role <> 'user' OR message.id = ? OR EXISTS (
          SELECT 1 FROM assistant_message_runs succeeded_run
          WHERE succeeded_run.owner_email = message.owner_email
            AND succeeded_run.user_message_id = message.id
            AND succeeded_run.status = 'succeeded'
        ) OR NOT EXISTS (
          SELECT 1 FROM assistant_message_runs abandoned_run
          WHERE abandoned_run.owner_email = message.owner_email
            AND abandoned_run.user_message_id = message.id
            AND abandoned_run.status IN ('failed', 'expired', 'cancelled')
        )
      ) ORDER BY message.created_at DESC, message.id DESC LIMIT 501
    ) ORDER BY created_at ASC, id ASC`)
    .bind(ownerEmail, threadId, currentUserMessageId, ownerEmail, threadId, currentUserMessageId)
    .all<AssistantMessageRow>();
  return rows.results.map(({ activitiesJson: _activitiesJson, ...message }) => message);
}

async function applyChangePlan(context: AssistantContext, planId: string) {
  const { request, env, user } = context;
  try {
    const input = await readJson<{ publish?: boolean }>(request);
    const publish = input.publish !== false;
    const routinePlan = await getRoutineChangePlan(env, user.email, planId);
    if (routinePlan) return await applyRoutineChangePlan(context, routinePlan, publish);
    const exercisePlan = await getExerciseChangePlan(env, user.email, planId);
    if (exercisePlan) return await applyExerciseChangePlan(context, exercisePlan);
    return apiError(request, 404, "coach_plan_not_found", "Change plan not found.");
  } catch (error) {
    return apiError(request, 400, "coach_plan_apply_failed", errorMessage(error, "The change could not be applied."));
  }
}

async function applyRoutineChangePlan(context: AssistantContext, plan: ChangePlanRow, publish: boolean) {
  const { request, env, user } = context;
  const isCreation = plan.baseVersionId === null;
  if (isCreation && !publish) {
    return apiError(request, 400, "coach_new_routine_must_publish", "A new routine must be created before it can have draft versions.");
  }
  if (isCreation && plan.status === "applying") {
    const recovery = await recoverRoutineCreationPlan(env, user.email, plan);
    if (recovery.state === "applied") {
      return finalizeRoutineCreationPlan(context, plan, recovery.routine);
    }
    if (recovery.state === "pending") {
      return applyRoutineChangePlan(context, recovery.plan, publish);
    }
    return apiError(request, 409, "coach_plan_applying", "This routine is still being created. Try again shortly.");
  }
  if (plan.status !== "pending") {
    return apiError(request, 409, "coach_plan_not_pending", "This change plan has already been handled.");
  }
  const claimed = await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applying', updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'pending'`)
    .bind(new Date().toISOString(), plan.id, user.email).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    return apiError(request, 409, "coach_plan_not_pending", "This change plan has already been handled.");
  }

  try {
    const services = getEntityServices();
    const proposed = validateRoutineVersionInput(JSON.parse(plan.proposedInputJson) as RoutineVersionInput);
    if (isCreation) {
      if (await services.routines.get(user.email, plan.routineCode)) {
        await markRoutinePlanStale(env, user.email, plan.id);
        return apiError(request, 409, "coach_plan_stale", "That routine code was claimed after this plan was created. Ask the coach to prepare a fresh plan with another code.");
      }
      const activeExercises = await services.exercises.list(user.email, { availableOnly: true });
      const activeExerciseIds = new Set(activeExercises.map((exercise) => exercise.id));
      if (proposed.exercises.some((exercise) => !activeExerciseIds.has(exercise.exerciseId))) {
        await markRoutinePlanStale(env, user.email, plan.id);
        return apiError(request, 409, "coach_plan_stale", "An exercise in this plan is no longer available with your selected equipment. Ask the coach to prepare a fresh plan.");
      }

      const routine = await services.routines.create(user.email, plan.routineCode, proposed, plan.routineId);
      return finalizeRoutineCreationPlan(context, plan, routine);
    }

    const routine = await services.routines.get(user.email, plan.routineId);
    if (!routine || !routine.currentVersion || routine.currentVersionId !== plan.baseVersionId) {
      await markRoutinePlanStale(env, user.email, plan.id);
      return apiError(request, 409, "coach_plan_stale", "The routine changed after this plan was created. Ask the coach to prepare a fresh plan.");
    }
    const availableExercises = await services.exercises.list(user.email, { availableOnly: true });
    if (increasesUnavailableExerciseCount(
      routine.currentVersion.exercises,
      proposed.exercises,
      new Set(availableExercises.map((exercise) => exercise.id)),
    )) {
      await markRoutinePlanStale(env, user.email, plan.id);
      return apiError(request, 409, "coach_plan_stale", "Your equipment preferences changed and this plan introduces an unavailable exercise. Ask the coach to prepare a fresh plan.");
    }
    const version = await services.routines.createVersion(user.email, plan.routineId, proposed);
    const publishedRoutine = publish
      ? await services.routines.publish(user.email, plan.routineId, version.id, plan.baseVersionId ?? "")
      : null;
    if (publish && !publishedRoutine) {
      await services.routines.deleteVersion(user.email, plan.routineId, version.id);
      await markRoutinePlanStale(env, user.email, plan.id);
      return apiError(request, 409, "coach_plan_stale", "The routine changed while this plan was being applied. Ask the coach to prepare a fresh plan.");
    }
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applied',
      applied_version_id = ?, applied_as = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
      .bind(version.id, publish ? "published" : "draft", now, plan.id, user.email).run();
    return apiResponse(request, {
      plan: { ...serializeRoutinePlan(plan), status: "applied", appliedAs: publish ? "published" : "draft", appliedVersionId: version.id, updatedAt: now },
      version,
      routine: publishedRoutine,
      published: publish,
    });
  } catch (error) {
    if (isCreation) {
      const claimedRoutine = await getEntityServices().routines.get(user.email, plan.routineCode).catch(() => null);
      if (claimedRoutine) {
        if (claimedRoutine.id === plan.routineId && claimedRoutine.currentVersion) {
          return finalizeRoutineCreationPlan(context, plan, claimedRoutine);
        }
        await markRoutinePlanStale(env, user.email, plan.id);
        return apiError(request, 409, "coach_plan_stale", "That routine code is no longer available. Ask the coach to prepare a fresh plan with another code.");
      }
    }
    await resetRoutinePlanToPending(env, user.email, plan.id);
    throw error;
  }
}

async function finalizeRoutineCreationPlan(
  { request, env, user }: AssistantContext,
  plan: ChangePlanRow,
  routine: RoutineAggregate,
) {
  const version = routine.currentVersion;
  if (!version) throw new Error("The new routine was created without a published version.");
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applied',
    applied_as = 'published', routine_id = ?, applied_version_id = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
    .bind(routine.id, version.id, now, plan.id, user.email).run();
  return apiResponse(request, {
    plan: {
      ...serializeRoutinePlan({ ...plan, routineId: routine.id, status: "applied", appliedAs: "published", updatedAt: now }),
      appliedVersionId: version.id,
    },
    version,
    routine,
    published: true,
  });
}

type RoutineCreationRecovery =
  | { state: "applied"; routine: RoutineAggregate }
  | { state: "pending"; plan: ChangePlanRow }
  | { state: "busy" };

async function recoverRoutineCreationPlan(
  env: WorkerEnv,
  ownerEmail: string,
  plan: ChangePlanRow,
): Promise<RoutineCreationRecovery> {
  const services = getEntityServices();
  let routine = await services.routines.get(ownerEmail, plan.routineId);
  if (routine?.currentVersion) {
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applied',
      applied_as = 'published', routine_id = ?, applied_version_id = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'applying'`)
      .bind(routine.id, routine.currentVersion.id, now, plan.id, ownerEmail).run();
    return { state: "applied", routine };
  }

  const claimedAt = Date.parse(plan.updatedAt);
  if (Number.isFinite(claimedAt) && Date.now() - claimedAt < routineCreationApplyLeaseMs) {
    return { state: "busy" };
  }

  const recoveryClaimedAt = new Date().toISOString();
  const recoveryClaim = await env.DB.prepare(`UPDATE assistant_change_plans SET updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying' AND updated_at = ?`)
    .bind(recoveryClaimedAt, plan.id, ownerEmail, plan.updatedAt).run();
  if (Number(recoveryClaim.meta.changes ?? 0) !== 1) return { state: "busy" };

  routine = await services.routines.get(ownerEmail, plan.routineId);
  if (routine?.currentVersion) {
    await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applied',
      applied_as = 'published', routine_id = ?, applied_version_id = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'applying' AND updated_at = ?`)
      .bind(routine.id, routine.currentVersion.id, recoveryClaimedAt, plan.id, ownerEmail, recoveryClaimedAt).run();
    return { state: "applied", routine };
  }
  if (routine) {
    const deleted = await services.routines.deleteUnpublished(ownerEmail, routine.id);
    if (!deleted) {
      const current = await services.routines.get(ownerEmail, plan.routineId);
      if (current?.currentVersion) {
        const now = new Date().toISOString();
        await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'applied',
          applied_as = 'published', routine_id = ?, applied_version_id = ?, updated_at = ?
          WHERE id = ? AND owner_email = ? AND status = 'applying' AND updated_at = ?`)
          .bind(current.id, current.currentVersion.id, now, plan.id, ownerEmail, recoveryClaimedAt).run();
        return { state: "applied", routine: current };
      }
      if (current) return { state: "busy" };
    }
  }

  const now = new Date().toISOString();
  const reset = await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'pending', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying' AND updated_at = ?`)
    .bind(now, plan.id, ownerEmail, recoveryClaimedAt).run();
  return Number(reset.meta.changes ?? 0) === 1
    ? { state: "pending", plan: { ...plan, status: "pending", updatedAt: now } }
    : { state: "busy" };
}

async function applyExerciseChangePlan(context: AssistantContext, plan: ExerciseChangePlanRow) {
  const { request, env, user } = context;
  if (!["create", "update", "archive"].includes(plan.action)) {
    return apiError(request, 400, "coach_plan_invalid", "This exercise change plan is invalid.");
  }
  if (plan.status !== "pending") {
    return apiError(request, 409, "coach_plan_not_pending", "This change plan has already been handled.");
  }
  const claimed = await env.DB.prepare(`UPDATE assistant_exercise_change_plans SET status = 'applying', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'pending'`)
    .bind(new Date().toISOString(), plan.id, user.email).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    return apiError(request, 409, "coach_plan_not_pending", "This change plan has already been handled.");
  }

  try {
    const services = getEntityServices();
    let exercise: Exercise | null = null;
    if (plan.action === "create") {
      const proposed = completeExerciseInput(JSON.parse(plan.proposedInputJson));
      await assertExerciseNameAvailable(user.email, proposed, null, true);
      await assertExerciseEquipmentAvailable(env, user.email, proposed, null, true);
      exercise = await services.exercises.create(user.email, proposed);
    } else {
      const exerciseId = plan.exerciseId;
      const current = exerciseId ? await services.exercises.get(user.email, exerciseId) : null;
      if (!current || !current.isActive || current.updatedAt !== plan.baseUpdatedAt) {
        await markExercisePlanStale(env, user.email, plan.id);
        return apiError(request, 409, "coach_plan_stale", "The exercise changed after this plan was created. Ask the coach to prepare a fresh plan.");
      }
      if (plan.action === "update") {
        const proposed = completeExerciseInput(JSON.parse(plan.proposedInputJson));
        await assertExerciseNameAvailable(user.email, proposed, current.id, true);
        await assertExerciseEquipmentAvailable(env, user.email, proposed, current.equipment, true);
        exercise = await services.exercises.updateIfUnchanged(
          user.email,
          current.id,
          plan.baseUpdatedAt!,
          plan.id,
          proposed,
        );
        if (!exercise) {
          throw new StaleExercisePlanError("The exercise changed before the update could be applied. Ask the coach to prepare a fresh plan.");
        }
      } else {
        await assertExerciseCanBeArchived(user.email, current.id, true);
        const archived = await services.exercises.archiveIfUnchanged(user.email, current.id, plan.baseUpdatedAt!);
        if (!archived) {
          throw new StaleExercisePlanError("The exercise or its routine usage changed before it could be archived. Ask the coach to prepare a fresh plan.");
        }
        exercise = await services.exercises.get(user.email, current.id);
      }
    }
    if (!exercise) throw new Error("The exercise change could not be completed.");
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE assistant_exercise_change_plans SET status = 'applied',
      applied_exercise_id = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
      .bind(exercise.id, now, plan.id, user.email).run();
    return apiResponse(request, {
      plan: { ...serializeExercisePlan(plan), status: "applied", appliedExerciseId: exercise.id, updatedAt: now },
      exercise,
    });
  } catch (error) {
    if (error instanceof StaleExercisePlanError) {
      await markExercisePlanStale(env, user.email, plan.id);
      return apiError(request, 409, "coach_plan_stale", error.message);
    }
    await resetExercisePlanToPending(env, user.email, plan.id);
    throw error;
  }
}

async function rejectChangePlan({ request, env, user }: AssistantContext, planId: string) {
  const now = new Date().toISOString();
  const routineResult = await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'rejected', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'pending'`)
    .bind(now, planId, user.email).run();
  if (Number(routineResult.meta.changes ?? 0) === 1) return apiResponse(request, { rejected: true, planId });
  const exerciseResult = await env.DB.prepare(`UPDATE assistant_exercise_change_plans SET status = 'rejected', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'pending'`)
    .bind(now, planId, user.email).run();
  return Number(exerciseResult.meta.changes ?? 0) === 1
    ? apiResponse(request, { rejected: true, planId })
    : apiError(request, 404, "coach_plan_not_found", "Pending change plan not found.");
}

async function createOpenAIResponse(
  env: WorkerEnv,
  input: {
    model: string;
    reasoningEffort: string;
    safetyIdentifier: string;
    instructions: string;
    input: unknown[];
    tools: unknown[];
    toolChoice: CoachToolChoice | { type: "function"; name: string };
    background?: boolean;
    store?: boolean;
    previousResponseId?: string;
    metadata?: Record<string, string>;
    textVerbosity?: "low" | "medium" | "high";
    textFormat?: unknown;
    maxOutputTokens?: number;
    timeoutMs?: number;
    timeoutMessage?: string;
  },
) {
  const reasoning = input.reasoningEffort === "auto" ? undefined : { effort: input.reasoningEffort };
  return requestOpenAIResponse(
    env,
    "/responses",
    {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.input,
        previous_response_id: input.previousResponseId,
        tools: input.tools,
        tool_choice: input.toolChoice,
        parallel_tool_calls: false,
        reasoning,
        text: { verbosity: input.textVerbosity ?? "medium", format: input.textFormat },
        max_output_tokens: input.maxOutputTokens ?? outputTokenBudget(input.model),
        safety_identifier: input.safetyIdentifier,
        background: input.background || undefined,
        metadata: { ...input.metadata, coach_prompt_version: COACH_PROMPT_VERSION },
        store: input.store ?? false,
      }),
    },
    input.timeoutMs ?? assistantApiTimeoutMs,
    input.timeoutMessage ?? "The coach took too long to respond. Try again or select a lower reasoning effort.",
  );
}

async function deleteOpenAIResponse(env: WorkerEnv, responseId: string) {
  return requestOpenAIResponse(
    env,
    `/responses/${encodeURIComponent(responseId)}`,
    { method: "DELETE" },
    assistantBackgroundRequestTimeoutMs,
    "Coach finished locally, but temporary response cleanup timed out.",
  );
}

async function retrieveOpenAIResponse(env: WorkerEnv, responseId: string) {
  return requestOpenAIResponse(
    env,
    `/responses/${encodeURIComponent(responseId)}`,
    { method: "GET" },
    assistantBackgroundRequestTimeoutMs,
    "Coach is still working, but the status check timed out. We will try again.",
  );
}

async function cancelOpenAIResponse(env: WorkerEnv, responseId: string) {
  return requestOpenAIResponse(
    env,
    `/responses/${encodeURIComponent(responseId)}/cancel`,
    { method: "POST" },
    assistantBackgroundRequestTimeoutMs,
    "Coach is still working, but the cancellation request timed out. Try again.",
  );
}

async function requestOpenAIResponse(
  env: WorkerEnv,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const requestStartedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${env.OPENAI_API_KEY}`);
    headers.set("content-type", "application/json");
    const response = await fetch(`${openAIBaseUrl(env)}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as CoachResponse;
    if (init.method !== "DELETE") {
      const metrics = coachResponseMetrics(payload, response.headers.get("x-request-id"), Date.now() - requestStartedAt);
      if (metrics) console.info(JSON.stringify(metrics));
    }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      throw new OpenAIRequestError(
        payload.error?.message ?? `OpenAI returned status ${response.status}.`,
        status,
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof OpenAIRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OpenAIRequestError(timeoutMessage, 504);
    }
    throw new OpenAIRequestError(errorMessage(error, "The model request failed."));
  } finally {
    clearTimeout(timeout);
  }
}

type CoachToolInput = {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  run: StoredAssistantMessageRun;
  identity: { ownerEmail: string; runId: string; callId: string; leaseToken: string };
  argumentsValue: Record<string, unknown>;
  stagedPlans?: PreparedCoachProposal[];
  proposalIndex?: number;
};

async function executeCoachTool(input: CoachToolInput & { name: string }) {
  const services = getEntityServices();
  const ownerEmail = input.user.email;
  switch (input.name) {
    case "get_coaching_context": {
      const [routines, history, activeWorkouts, checkIns, saved] = await Promise.all([
        services.routines.list(ownerEmail),
        services.workouts.history(ownerEmail, { limit: 12, offset: 0 }),
        services.workouts.list(ownerEmail, { status: "In Progress" }),
        listCheckIns(input.env, ownerEmail),
        savedCoachMessageContext(input.env, input.run),
      ]);
      const page = coachPage(routines.map(coachRoutineSummary), 25, coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0), 12_000);
      return { routines: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset, history,
        activeWorkout: activeWorkouts[0] ? { id: activeWorkouts[0].id, routineCode: activeWorkouts[0].routineCode } : null,
        checkIns, readiness: coachCheckInContext(checkIns, saved.timeZone), observedAt: new Date().toISOString() };
    }
    case "get_routine": {
      const routine = await services.routines.get(ownerEmail, cleanRequiredText(input.argumentsValue.routineId, "Routine", 100));
      return { routine: routine ? coachRoutineDetails(routine, coachPageNumber(input.argumentsValue.offset, 0, 10_000, 0)) : null };
    }
    case "get_routines": {
      const ids = input.argumentsValue.routineIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 7 || new Set(ids).size !== ids.length) throw new Error("Select 1-7 unique routines.");
      const routines = await Promise.all(ids.map(async (id) => {
        const routine = await services.routines.get(ownerEmail, cleanRequiredText(id, "Routine", 100));
        if (!routine) throw new Error("A selected routine was not found.");
        return coachRoutineDetails(routine);
      }));
      const page = coachPage(routines, 7, coachPageNumber(input.argumentsValue.offset, 0, 7, 0));
      return { routines: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    }
    case "list_routine_versions": {
      const versions = await services.routines.listVersions(ownerEmail, cleanRequiredText(input.argumentsValue.routineId, "Routine", 100));
      const page = coachPage(versions.map(({ id, status, focus, durationMin, createdAt, exercises }) =>
        ({ id, status, focus, durationMin, createdAt, exerciseCount: exercises.length })), 20,
      coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0));
      return { versions: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset };
    }
    case "search_exercises": {
      const query = typeof input.argumentsValue.query === "string" ? input.argumentsValue.query : undefined;
      const muscleGroup = typeof input.argumentsValue.muscleGroup === "string"
        && muscleGroups.includes(input.argumentsValue.muscleGroup as MuscleGroup)
        ? input.argumentsValue.muscleGroup as MuscleGroup
        : undefined;
      const movementPattern = typeof input.argumentsValue.movementPattern === "string"
        ? input.argumentsValue.movementPattern
        : undefined;
      const exercises = await services.exercises.list(ownerEmail, {
        search: query,
        includeArchived: input.argumentsValue.includeArchived === true,
        availableOnly: true,
        muscleGroup,
        movementPattern,
      });
      const page = coachPage(exercises.map(coachExerciseSummary), coachPageNumber(input.argumentsValue.limit, 10, 25),
        coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0));
      return { exercises: page.items, total: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset };
    }
    case "get_exercise": {
      const exercise = await services.exercises.get(ownerEmail, cleanRequiredText(input.argumentsValue.exerciseId, "Exercise", 160));
      return { exercise: exercise ? { ...coachExerciseSummary(exercise), instructions: exercise.instructions } : null };
    }
    case "get_workout_history": {
      const limit = boundedInteger(input.argumentsValue.limit, 1, 30, "History limit");
      const routineCode = typeof input.argumentsValue.routineCode === "string" ? input.argumentsValue.routineCode : undefined;
      const from = coachDateFilter(input.argumentsValue.from);
      const to = coachDateFilter(input.argumentsValue.to);
      if (from && to && from >= to) throw new Error("History end must follow its start.");
      return { history: await services.workouts.history(ownerEmail, { limit,
        offset: coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0), routineCode, from, to }),
        range: { from: from ?? null, to: to ?? null }, statsScope: "All matching sessions in this date range, not just this page." };
    }
    case "get_exercise_progress": {
      const exerciseId = cleanRequiredText(input.argumentsValue.exerciseId, "Exercise", 160);
      const from = coachDateFilter(input.argumentsValue.from) ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
      const unit = input.argumentsValue.unit;
      if (unit !== undefined && unit !== null && unit !== "lb" && unit !== "kg") throw new Error("Progress unit must be lb or kg.");
      return { progress: await services.exercises.progress(ownerEmail, exerciseId, {
        from, limit: coachPageNumber(input.argumentsValue.limit, 12, 30), unit: unit as "lb" | "kg" | undefined ?? undefined,
      }), range: { from }, basis: "Best eligible working set per session; retrieve workout details for every set and RIR." };
    }
    case "get_workout_details": {
      const workout = await services.workouts.get(ownerEmail, cleanRequiredText(input.argumentsValue.workoutId, "Workout", 200));
      return { workout: workout ? coachWorkoutDetails(workout, coachPageNumber(input.argumentsValue.offset, 0, 10_000, 0)) : null };
    }
    case "get_plan": {
      const plan = await getThreadPlan(input.env, ownerEmail, input.thread.id, cleanRequiredText(input.argumentsValue.planId, "Plan", 200));
      if (!("routineCode" in plan)) return { plan: serializeExercisePlan(plan) };
      const { proposedRoutine, diff: _diff, ...receipt } = serializeRoutinePlan(plan);
      const page = coachPage(proposedRoutine.exercises, 20, coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0));
      return { plan: { ...receipt, proposedRoutine: { ...proposedRoutine, exercises: page.items } },
        hasMore: page.hasMore, nextOffset: page.nextOffset, totalExercises: page.total };
    }
    case "search_thread_history": {
      const query = cleanText(input.argumentsValue.query, 200);
      const limit = coachPageNumber(input.argumentsValue.limit, 10, 20);
      const offset = coachPageNumber(input.argumentsValue.offset, 0, 100_000, 0);
      const rows = await input.env.DB.prepare(`SELECT message.id, message.role, message.content, message.created_at AS createdAt
        FROM assistant_messages message WHERE message.owner_email = ? AND message.thread_id = ?
          AND instr(lower(message.content), lower(?)) > 0
          AND (message.created_at, message.id) <= (
            SELECT created_at, id FROM assistant_messages WHERE id = ? AND owner_email = ? AND thread_id = ?
          ) ORDER BY message.created_at DESC, message.id DESC LIMIT ? OFFSET ?`)
        .bind(ownerEmail, input.thread.id, query, input.run.userMessageId, ownerEmail, input.thread.id, limit + 1, offset).all<AssistantMessage>();
      const page = coachPage(rows.results.slice(0, limit), limit, 0);
      return { messages: page.items, hasMore: page.hasMore || rows.results.length > limit, nextOffset: offset + page.items.length };
    }
    case "get_active_workout": {
      const workouts = await services.workouts.list(ownerEmail, { status: "In Progress" });
      return { workout: workouts[0] ? coachWorkoutDetails(workouts[0]) : null, observedAt: new Date().toISOString() };
    }
    case "propose_new_routine":
      return proposeNewRoutine(input);
    case "propose_routine_change":
      return proposeRoutineChange(input);
    case "propose_routine_edit": {
      const routine = await services.routines.get(ownerEmail, cleanRequiredText(input.argumentsValue.routineId, "Routine", 100));
      if (!routine?.currentVersion) throw new Error("The current routine was not found.");
      const library = await services.exercises.list(ownerEmail);
      const proposedRoutine = applyCoachRoutineEdits(routine.currentVersion, input.argumentsValue.operations, library);
      return proposeRoutineChange({ ...input, argumentsValue: { ...input.argumentsValue, proposedRoutine } });
    }
    case "propose_routine_changes":
      return proposeRoutineBatch(input);
    case "propose_exercise_change":
      return proposeExerciseChange(input);
    default:
      throw new Error(`Unknown coach tool: ${input.name}`);
  }
}

function coachDateFilter(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("History dates must be valid ISO dates.");
  return new Date(value).toISOString();
}

async function getThreadPlan(env: WorkerEnv, ownerEmail: string, threadId: string, planId: string) {
  const plan = await getRoutineChangePlan(env, ownerEmail, planId) ?? await getExerciseChangePlan(env, ownerEmail, planId);
  if (!plan || plan.threadId !== threadId) throw new Error("The proposal was not found in this conversation.");
  return plan;
}

type PendingRoutineProposalResult = Pick<
  ChangePlanRow,
  "id" | "routineCode" | "summary" | "rationale" | "diffJson"
>;

function routineProposalToolResult(
  plan: PendingRoutineProposalResult,
  instruction: string,
) {
  return {
    planId: plan.id,
    status: "ready_for_review",
    routineCode: plan.routineCode,
    summary: plan.summary,
    rationale: plan.rationale,
    diff: JSON.parse(plan.diffJson) as string[],
    instruction,
  };
}

async function findExactPendingRoutineProposal(
  env: WorkerEnv,
  ownerEmail: string,
  threadId: string,
  routineCode: string,
  baseVersionId: string | null,
  proposedInputJson: string,
) {
  return env.DB.prepare(`SELECT id, routine_code AS routineCode,
    summary, rationale, diff_json AS diffJson
    FROM assistant_change_plans
    WHERE owner_email = ? AND thread_id = ? AND routine_code = ?
      AND base_version_id IS ? AND proposed_input_json = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1`)
    .bind(ownerEmail, threadId, routineCode, baseVersionId, proposedInputJson)
    .first<PendingRoutineProposalResult>();
}

async function proposeNewRoutine(input: CoachToolInput) {
  const services = getEntityServices();
  const routineCode = cleanRequiredText(input.argumentsValue.routineCode, "Routine code", 20).toUpperCase();
  if (await services.routines.get(input.user.email, routineCode)) {
    throw new Error("That routine code is already in use. Choose a different code.");
  }

  const completed = completeRoutineCreationProposal(input.argumentsValue.proposedRoutine);
  const proposed = completed.input;
  const exerciseLibrary = await services.exercises.list(input.user.email, { availableOnly: true });
  const validExerciseIds = new Set(exerciseLibrary.map((exercise) => exercise.id));
  if (proposed.exercises.some((exercise) => !validExerciseIds.has(exercise.exerciseId))) {
    throw new Error("Every proposed exercise must be active and available with the user's selected equipment.");
  }

  const summary = cleanRequiredText(input.argumentsValue.summary, "Plan summary", 500);
  const rationale = cleanRequiredText(input.argumentsValue.rationale, "Plan rationale", 2_000);
  const diff = buildRoutineCreationDiff(routineCode, completed.proposal, exerciseLibrary);
  const proposedInputJson = JSON.stringify(proposed);
  const existing = await findExactPendingRoutineProposal(
    input.env,
    input.user.email,
    input.thread.id,
    routineCode,
    null,
    proposedInputJson,
  );
  const instruction = "Tell the user the new-routine review card is ready and nothing has changed yet. Do not ask for verbal approval.";
  const supersedesPlanId = await proposalRevision(input, { kind: "routine", routineCode });
  if (existing && !supersedesPlanId) {
    const output = routineProposalToolResult(existing, instruction);
    await commitPreparedProposals(input, [], output);
    return output;
  }
  const now = new Date().toISOString();
  const planId = await proposalId(input);
  const output = routineProposalToolResult({
    id: planId,
    routineCode,
    summary,
    rationale,
    diffJson: JSON.stringify(diff),
  }, instruction);
  await commitPreparedProposals(input, [{ kind: "routine", id: planId, threadId: input.thread.id,
    routineId: planId, routineCode, baseVersionId: null, proposedInputJson, summary, rationale,
    diffJson: JSON.stringify(diff), createdAt: now, originRunId: input.run.id,
    originUserMessageId: input.run.userMessageId, supersedesPlanId }], output);
  return output;
}

async function proposeRoutineChange(input: CoachToolInput) {
  const services = getEntityServices();
  const routineId = cleanRequiredText(input.argumentsValue.routineId, "Routine", 100);
  const routine = await services.routines.get(input.user.email, routineId);
  if (!routine?.currentVersion) throw new Error("The routine or its published version could not be found.");
  const baseVersionId = cleanRequiredText(input.argumentsValue.baseVersionId, "Base version", 120);
  if (routine.currentVersionId !== baseVersionId) {
    throw new Error("The routine changed while the proposal was being prepared. Read it again before proposing changes.");
  }
  const completed = completeRoutineChangeProposal(routine.currentVersion, input.argumentsValue.proposedRoutine);
  const proposed = completed.input;
  if (isRoutineVersionSemanticallyEqual(routine.currentVersion, proposed)) {
    throw new Error("The proposed routine update does not change anything.");
  }
  const [exerciseLibrary, availableExercises] = await Promise.all([
    services.exercises.list(input.user.email),
    services.exercises.list(input.user.email, { availableOnly: true }),
  ]);
  const validExerciseIds = new Set(exerciseLibrary.map((exercise) => exercise.id));
  if (proposed.exercises.some((exercise) => !validExerciseIds.has(exercise.exerciseId))) {
    throw new Error("Every proposed exercise must come from the exercise library.");
  }
  const availableExerciseIds = new Set(availableExercises.map((exercise) => exercise.id));
  const currentPlacements = new Map(routine.currentVersion.exercises.map((exercise) => [exercise.id, exercise]));
  const introducesUnavailableExercise = completed.proposal.exercises.some((exercise) => {
    const currentPlacement = exercise.sourceRoutineExerciseId
      ? currentPlacements.get(exercise.sourceRoutineExerciseId)
      : null;
    const introducesExercise = !currentPlacement || currentPlacement.exerciseId !== exercise.exerciseId;
    return introducesExercise && !availableExerciseIds.has(exercise.exerciseId);
  });
  if (introducesUnavailableExercise) {
    throw new Error("Routine changes may preserve existing exercises, but new or replacement exercises must be available with the user's selected equipment.");
  }
  const summary = cleanRequiredText(input.argumentsValue.summary, "Plan summary", 500);
  const rationale = cleanRequiredText(input.argumentsValue.rationale, "Plan rationale", 2_000);
  const diff = buildRoutineChangeDiff(routine, completed.proposal, exerciseLibrary);
  if (!diff.length) throw new Error("The proposed routine update does not change anything.");
  const proposedInputJson = JSON.stringify(proposed);
  const existing = await findExactPendingRoutineProposal(
    input.env,
    input.user.email,
    input.thread.id,
    routine.code,
    baseVersionId,
    proposedInputJson,
  );
  const instruction = "Tell the user the review card is ready and nothing has changed yet. Do not ask for verbal approval.";
  const supersedesPlanId = await proposalRevision(input, { kind: "routine", routineCode: routine.code });
  if (existing && !supersedesPlanId) {
    const output = routineProposalToolResult(existing, instruction);
    await commitPreparedProposals(input, [], output);
    return output;
  }
  const now = new Date().toISOString();
  const planId = await proposalId(input);
  const output = routineProposalToolResult({
    id: planId,
    routineCode: routine.code,
    summary,
    rationale,
    diffJson: JSON.stringify(diff),
  }, instruction);
  await commitPreparedProposals(input, [{ kind: "routine", id: planId, threadId: input.thread.id,
    routineId: routine.id, routineCode: routine.code, baseVersionId, proposedInputJson, summary, rationale,
    diffJson: JSON.stringify(diff), createdAt: now, originRunId: input.run.id,
    originUserMessageId: input.run.userMessageId, supersedesPlanId }], output);
  return output;
}

async function proposeExerciseChange(input: CoachToolInput) {
  const actionValue = cleanRequiredText(input.argumentsValue.action, "Exercise change action", 20);
  if (!["create", "update", "archive"].includes(actionValue)) throw new Error("Exercise change action is invalid.");
  const action = actionValue as ExerciseChangeAction;
  const exerciseId = nullableRequiredText(input.argumentsValue.exerciseId, "Exercise", 160);
  const baseUpdatedAt = nullableRequiredText(input.argumentsValue.baseUpdatedAt, "Base exercise timestamp", 80);
  const services = getEntityServices();

  let current: Exercise | null = null;
  let proposed: CompleteExerciseInput | null = null;
  if (action === "create") {
    if (exerciseId !== null || baseUpdatedAt !== null) {
      throw new Error("A new exercise must not reference an existing exercise.");
    }
    proposed = completeExerciseInput(input.argumentsValue.proposedExercise);
    await assertExerciseNameAvailable(input.user.email, proposed, null);
    await assertExerciseEquipmentAvailable(input.env, input.user.email, proposed, null);
  } else {
    if (!exerciseId || !baseUpdatedAt) throw new Error("Exercise ID and current timestamp are required.");
    current = await services.exercises.get(input.user.email, exerciseId);
    if (!current || !current.isActive) throw new Error("The active exercise could not be found.");
    if (current.updatedAt !== baseUpdatedAt) {
      throw new Error("The exercise changed while the proposal was being prepared. Read it again before proposing changes.");
    }
    if (action === "update") {
      proposed = completeExerciseInput(input.argumentsValue.proposedExercise);
      await assertExerciseNameAvailable(input.user.email, proposed, current.id);
      await assertExerciseEquipmentAvailable(input.env, input.user.email, proposed, current.equipment);
    } else {
      if (input.argumentsValue.proposedExercise !== null) {
        throw new Error("An archive plan must not include a proposed exercise definition.");
      }
      await assertExerciseCanBeArchived(input.user.email, current.id);
    }
  }

  const diff = buildExerciseChangeDiff(action, current, proposed);
  if (!diff.length) throw new Error("The proposed exercise update does not change anything.");
  const summary = cleanRequiredText(input.argumentsValue.summary, "Plan summary", 500);
  const rationale = cleanRequiredText(input.argumentsValue.rationale, "Plan rationale", 2_000);
  const exerciseName = proposed?.name ?? current?.name;
  if (!exerciseName) throw new Error("The exercise name could not be determined.");
  const now = new Date().toISOString();
  const planId = await proposalId(input);
  const supersedesPlanId = await proposalRevision(input, { kind: "exercise", exerciseId, exerciseName });
  const supersedesExerciseName = supersedesPlanId && exerciseId === null
    ? (await getExerciseChangePlan(input.env, input.user.email, supersedesPlanId))?.exerciseName
    : undefined;
  const output = {
    planId,
    status: "ready_for_review",
    action,
    exerciseName,
    summary,
    rationale,
    diff,
    instruction: "Tell the user the review card is ready and nothing has changed yet. Do not ask for verbal approval.",
  };
  await commitPreparedProposals(input, [{ kind: "exercise", id: planId, threadId: input.thread.id,
    action, exerciseId, exerciseName, baseUpdatedAt, baseInputJson: current ? JSON.stringify(exerciseInputSnapshot(current)) : null,
    proposedInputJson: JSON.stringify(proposed ?? {}), summary, rationale, diffJson: JSON.stringify(diff), createdAt: now,
    originRunId: input.run.id, originUserMessageId: input.run.userMessageId, supersedesPlanId, supersedesExerciseName }], output);
  return output;
}

async function proposalId(input: CoachToolInput) {
  const source = JSON.stringify([input.user.email, input.run.id, input.identity.callId, input.proposalIndex ?? 0]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `coach-plan-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function commitPreparedProposals(input: CoachToolInput, plans: PreparedCoachProposal[], output: unknown) {
  if (input.stagedPlans) { input.stagedPlans.push(...plans); return; }
  const committed = await getMessageRunRepository().commitProposalResult(input.user.email, input.run.id,
    input.identity.callId, input.identity.leaseToken, { plans, outputJson: JSON.stringify(output), updatedAt: new Date().toISOString() });
  if (!committed) throw new Error("The proposal changed or this coaching step lost its processing lease. Refresh and retry.");
}

async function proposalRevision(input: CoachToolInput, target:
  { kind: "routine"; routineCode: string } | { kind: "exercise"; exerciseId: string | null; exerciseName: string }) {
  const request = await savedCoachMessageContext(input.env, input.run);
  if (!request.context.revisePlanId) return null;
  const plan = await getThreadPlan(input.env, input.user.email, input.thread.id, request.context.revisePlanId);
  if (plan.status !== "pending") throw new Error("This proposal was already handled. Read the current data before preparing a new change.");
  const matches = target.kind === "routine"
    ? "routineCode" in plan && plan.routineCode === target.routineCode
    : "exerciseName" in plan && plan.exerciseId === target.exerciseId
      && (target.exerciseId !== null || normalizeExerciseName(plan.exerciseName) === normalizeExerciseName(target.exerciseName));
  if (!matches && !input.stagedPlans) throw new Error("A revision must target the same routine or exercise as its original proposal.");
  return matches ? plan.id : null;
}

async function proposeRoutineBatch(input: CoachToolInput) {
  const proposals = input.argumentsValue.proposals;
  if (!Array.isArray(proposals) || proposals.length < 2 || proposals.length > 7) throw new Error("A batch needs 2-7 routine proposals.");
  const stagedPlans: PreparedCoachProposal[] = [];
  const results = [];
  const targets = new Set<string>();
  for (let index = 0; index < proposals.length; index++) {
    const item = proposals[index] as Record<string, unknown> | null;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Proposal ${index + 1} is invalid.`);
    try {
      const child = { ...input, argumentsValue: item, stagedPlans, proposalIndex: index };
      let result;
      if (item.action === "create" && item.routineId === null && item.baseVersionId === null) {
        result = await proposeNewRoutine(child);
      } else if (item.action === "update" && item.routineCode === null) {
        result = await proposeRoutineChange(child);
      } else throw new Error("Use create with a code and null routine/base IDs, or update with routine/base IDs and a null code.");
      if (targets.has(result.routineCode)) throw new Error("Each routine can appear only once in a batch.");
      targets.add(result.routineCode);
      results.push({ planId: result.planId, action: item.action, routineCode: result.routineCode, summary: result.summary });
    } catch (error) { throw new Error(`Proposal ${index + 1}: ${errorMessage(error, "Invalid proposal")}`); }
  }
  const request = await savedCoachMessageContext(input.env, input.run);
  if (request.context.revisePlanId && !stagedPlans.some((plan) => plan.supersedesPlanId === request.context.revisePlanId)) {
    throw new Error("The batch must include the proposal selected for revision.");
  }
  const output = { status: "ready_for_review", plans: results };
  await commitPreparedProposals(input, stagedPlans, output);
  return output;
}

async function assertExerciseNameAvailable(
  ownerEmail: string,
  proposed: CompleteExerciseInput,
  excludedExerciseId: string | null,
  stale = false,
) {
  const exercises = await getEntityServices().exercises.list(ownerEmail, {
    search: proposed.name,
    includeArchived: true,
  });
  const normalizedName = normalizeExerciseName(proposed.name);
  const conflict = exercises.find((exercise) => (
    exercise.id !== excludedExerciseId && exercise.normalizedName === normalizedName
  ));
  if (!conflict) return;
  const message = conflict.isActive
    ? `\"${conflict.name}\" already exists in the exercise library.`
    : `An archived exercise named \"${conflict.name}\" already exists. Restore support is not available yet.`;
  throw stale ? new StaleExercisePlanError(message) : new Error(message);
}

async function assertExerciseEquipmentAvailable(
  env: WorkerEnv,
  ownerEmail: string,
  proposed: CompleteExerciseInput,
  currentEquipment: string | null,
  stale = false,
) {
  if (currentEquipment !== null && proposed.equipment === currentEquipment) return;
  const storedProfile = await env.DB.prepare(`SELECT
    equipment_preferences_json AS equipmentPreferencesJson
    FROM app_users WHERE owner_email = ?`)
    .bind(ownerEmail)
    .first<{ equipmentPreferencesJson: string | null }>();
  const profile = trainingProfileFromStored(storedProfile ?? {});
  if (isExerciseEquipmentAvailable(proposed.equipment, profile.equipment)) return;
  const message = "The proposed exercise requires equipment that is not selected in the user's app profile.";
  throw stale ? new StaleExercisePlanError(message) : new Error(message);
}

async function assertExerciseCanBeArchived(ownerEmail: string, exerciseId: string, stale = false) {
  const routinesService = getEntityServices().routines;
  const routines = await routinesService.list(ownerEmail);
  const references = (await Promise.all(routines.map(async (routine) => {
    const usedByCurrent = routine.currentVersion?.exercises.some((exercise) => exercise.exerciseId === exerciseId);
    const versions = await routinesService.listVersions(ownerEmail, routine.id);
    const usedByDraft = versions.some((version) => (
      version.status === "draft" && version.exercises.some((exercise) => exercise.exerciseId === exerciseId)
    ));
    return usedByCurrent || usedByDraft ? routine.code : null;
  }))).filter((code): code is string => Boolean(code));
  if (references.length) {
    const message = `Remove this exercise from active routine${references.length === 1 ? "" : "s"} or draft${references.length === 1 ? "" : "s"} ${references.join(", ")} before archiving it.`;
    throw stale ? new StaleExercisePlanError(message) : new Error(message);
  }
}

async function listModelCatalog(env: WorkerEnv, refresh = false) {
  if (!env.OPENAI_API_KEY) return { models: fallbackAssistantModels(), source: "fallback" as const };
  if (!refresh && modelCache && modelCache.expiresAt > Date.now()) return { models: modelCache.models, source: "live" as const };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), assistantModelDiscoveryTimeoutMs);
  try {
    const response = await fetch(`${openAIBaseUrl(env)}/models`, {
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Model discovery returned ${response.status}.`);
    const payload = await response.json() as { data?: Array<{ id?: string; created?: number }> };
    const models = (payload.data ?? [])
      .filter((model): model is { id: string; created?: number } => Boolean(model.id) && isCompatibleAssistantModel(model.id!))
      .map((model) => assistantModelOption(model.id, model.created ?? 0))
      .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    const unique = Array.from(new Map(models.map((model) => [model.id, model])).values());
    if (!unique.length) throw new Error("No compatible text models were returned.");
    modelCache = { models: unique, expiresAt: Date.now() + 10 * 60 * 1_000 };
    return { models: unique, source: "live" as const };
  } catch {
    return { models: fallbackAssistantModels(), source: "fallback" as const };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureCoachProfile(env: WorkerEnv, ownerEmail: string) {
  const now = new Date().toISOString();
  const storedTrainingProfile = await env.DB.prepare(`SELECT
    equipment_preferences_json AS equipmentPreferencesJson,
    preferred_workout_duration_min AS preferredWorkoutDurationMin,
    onboarding_version AS onboardingVersion,
    onboarding_completed_at AS onboardingCompletedAt
    FROM app_users WHERE owner_email = ?`)
    .bind(ownerEmail)
    .first<{
      equipmentPreferencesJson: string | null;
      preferredWorkoutDurationMin: number | null;
      onboardingVersion: number | null;
      onboardingCompletedAt: string | null;
    }>();
  const trainingProfile = trainingProfileFromStored(storedTrainingProfile ?? {});
  const equipment = equipmentDescription(trainingProfile.equipment);
  await env.DB.prepare(`INSERT OR IGNORE INTO coach_profiles (
    owner_email, primary_goal, training_days_per_week, session_duration_min,
    equipment, limitations, preferences, model, reasoning_effort, created_at, updated_at
  ) VALUES (?, 'general fitness', 4, ?, ?, '', '', ?, 'medium', ?, ?)`)
    .bind(
      ownerEmail,
      trainingProfile.sessionDurationMin,
      equipment,
      env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-5.6-terra",
      now,
      now,
    ).run();
  await env.DB.prepare(`UPDATE coach_profiles SET session_duration_min = ?, equipment = ?,
    updated_at = ? WHERE owner_email = ? AND (session_duration_min <> ? OR equipment <> ?)`)
    .bind(
      trainingProfile.sessionDurationMin,
      equipment,
      now,
      ownerEmail,
      trainingProfile.sessionDurationMin,
      equipment,
    ).run();
  const profile = await env.DB.prepare(`SELECT owner_email AS ownerEmail,
    primary_goal AS primaryGoal, training_days_per_week AS trainingDaysPerWeek,
    session_duration_min AS sessionDurationMin, equipment, limitations, preferences,
    model, reasoning_effort AS reasoningEffort, created_at AS createdAt, updated_at AS updatedAt
    FROM coach_profiles WHERE owner_email = ?`).bind(ownerEmail).first<CoachProfile>();
  if (!profile) throw new Error("The coaching profile could not be loaded.");
  return profile;
}

async function insertThread(env: WorkerEnv, ownerEmail: string) {
  const now = new Date().toISOString();
  const thread: AssistantThread = {
    id: crypto.randomUUID(),
    ownerEmail,
    title: "New coaching conversation",
    createdAt: now,
    updatedAt: now,
  };
  await env.DB.prepare(`INSERT INTO assistant_threads (
    id, owner_email, title, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?)`).bind(thread.id, ownerEmail, thread.title, thread.createdAt, thread.updatedAt).run();
  return thread;
}

async function getThread(env: WorkerEnv, ownerEmail: string, threadId: string) {
  return env.DB.prepare(`SELECT id, owner_email AS ownerEmail, title,
    created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_threads WHERE id = ? AND owner_email = ?`).bind(threadId, ownerEmail).first<AssistantThread>();
}

async function listThreads(env: WorkerEnv, ownerEmail: string) {
  const rows = await env.DB.prepare(`SELECT id, owner_email AS ownerEmail, title,
    created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_threads WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(ownerEmail).all<AssistantThread>();
  return rows.results;
}

async function listMessages(env: WorkerEnv, ownerEmail: string, threadId: string, limit = 50) {
  const rows = await env.DB.prepare(`SELECT id, thread_id AS threadId, role, content,
    model, reasoning_effort AS reasoningEffort, activities_json AS activitiesJson,
    created_at AS createdAt FROM (
      SELECT id, thread_id, role, content, model, reasoning_effort, activities_json, created_at
      FROM assistant_messages WHERE owner_email = ? AND thread_id = ?
      ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC`).bind(ownerEmail, threadId, limit).all<AssistantMessageRow>();
  return rows.results.map(({ activitiesJson, ...message }) => ({
    ...message,
    activities: JSON.parse(activitiesJson) as CoachToolActivity[],
  }));
}

async function listCheckIns(env: WorkerEnv, ownerEmail: string) {
  const rows = await env.DB.prepare(`SELECT id, energy, soreness,
    sleep_quality AS sleepQuality, available_minutes AS availableMinutes,
    notes, created_at AS createdAt FROM coach_check_ins
    WHERE owner_email = ? ORDER BY created_at DESC LIMIT 7`).bind(ownerEmail).all<CoachCheckIn>();
  return rows.results;
}

async function listChangePlans(env: WorkerEnv, ownerEmail: string, threadId: string) {
  await recoverInterruptedRoutineCreations(env, ownerEmail, threadId);
  const [routineRows, exerciseRows] = await Promise.all([
    env.DB.prepare(`SELECT id, thread_id AS threadId, ${planProvenanceColumns},
      routine_id AS routineId, routine_code AS routineCode,
      base_version_id AS baseVersionId, proposed_input_json AS proposedInputJson,
      summary, rationale, diff_json AS diffJson, status,
      applied_version_id AS appliedVersionId, created_at AS createdAt, updated_at AS updatedAt
      FROM assistant_change_plans WHERE owner_email = ? AND thread_id = ?
      ORDER BY created_at DESC LIMIT 20`).bind(ownerEmail, threadId).all<ChangePlanRow>(),
    env.DB.prepare(`SELECT id, thread_id AS threadId, ${planProvenanceColumns}, action,
      exercise_id AS exerciseId, exercise_name AS exerciseName,
      base_updated_at AS baseUpdatedAt, base_input_json AS baseInputJson,
      proposed_input_json AS proposedInputJson, summary, rationale,
      diff_json AS diffJson, status, applied_exercise_id AS appliedExerciseId,
      created_at AS createdAt, updated_at AS updatedAt
      FROM assistant_exercise_change_plans WHERE owner_email = ? AND thread_id = ?
      ORDER BY created_at DESC LIMIT 20`).bind(ownerEmail, threadId).all<ExerciseChangePlanRow>(),
  ]);
  return [
    ...routineRows.results.map(serializeRoutinePlan),
    ...exerciseRows.results.map(serializeExercisePlan),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 20);
}

async function recoverInterruptedRoutineCreations(env: WorkerEnv, ownerEmail: string, threadId: string) {
  const rows = await env.DB.prepare(`SELECT id, thread_id AS threadId, ${planProvenanceColumns},
    routine_id AS routineId, routine_code AS routineCode,
    base_version_id AS baseVersionId, proposed_input_json AS proposedInputJson,
    summary, rationale, diff_json AS diffJson, status,
    applied_version_id AS appliedVersionId, created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_change_plans
    WHERE owner_email = ? AND thread_id = ? AND base_version_id IS NULL AND status = 'applying'
    ORDER BY updated_at ASC LIMIT 20`)
    .bind(ownerEmail, threadId).all<ChangePlanRow>();
  for (const plan of rows.results) await recoverRoutineCreationPlan(env, ownerEmail, plan);
}

async function getRoutineChangePlan(env: WorkerEnv, ownerEmail: string, planId: string) {
  return env.DB.prepare(`SELECT id, thread_id AS threadId, ${planProvenanceColumns},
    routine_id AS routineId, routine_code AS routineCode,
    base_version_id AS baseVersionId, proposed_input_json AS proposedInputJson,
    summary, rationale, diff_json AS diffJson, status,
    applied_version_id AS appliedVersionId, created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_change_plans WHERE id = ? AND owner_email = ?`).bind(planId, ownerEmail).first<ChangePlanRow>();
}

async function getExerciseChangePlan(env: WorkerEnv, ownerEmail: string, planId: string) {
  return env.DB.prepare(`SELECT id, thread_id AS threadId, ${planProvenanceColumns}, action,
    exercise_id AS exerciseId, exercise_name AS exerciseName,
    base_updated_at AS baseUpdatedAt, base_input_json AS baseInputJson,
    proposed_input_json AS proposedInputJson, summary, rationale,
    diff_json AS diffJson, status, applied_exercise_id AS appliedExerciseId,
    created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_exercise_change_plans WHERE id = ? AND owner_email = ?`)
    .bind(planId, ownerEmail).first<ExerciseChangePlanRow>();
}

const planProvenanceColumns = `origin_run_id AS originRunId, origin_user_message_id AS originUserMessageId,
  applied_as AS appliedAs, supersedes_plan_id AS supersedesPlanId`;

function serializeRoutinePlan(plan: ChangePlanRow) {
  const action = plan.baseVersionId === null ? "create" as const : "update" as const;
  return {
    id: plan.id,
    kind: "routine" as const,
    threadId: plan.threadId,
    action,
    routineId: action === "create" && plan.status !== "applied" ? null : plan.routineId,
    routineCode: plan.routineCode,
    baseVersionId: plan.baseVersionId,
    proposedRoutine: JSON.parse(plan.proposedInputJson) as RoutineVersionInput,
    summary: plan.summary,
    rationale: plan.rationale,
    diff: JSON.parse(plan.diffJson) as string[],
    status: plan.status,
    appliedVersionId: plan.appliedVersionId,
    originRunId: plan.originRunId,
    originUserMessageId: plan.originUserMessageId,
    appliedAs: plan.appliedAs,
    supersedesPlanId: plan.supersedesPlanId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function serializeExercisePlan(plan: ExerciseChangePlanRow) {
  return {
    id: plan.id,
    kind: "exercise" as const,
    threadId: plan.threadId,
    action: plan.action,
    exerciseId: plan.exerciseId,
    exerciseName: plan.exerciseName,
    baseUpdatedAt: plan.baseUpdatedAt,
    proposedExercise: plan.action === "archive"
      ? null
      : JSON.parse(plan.proposedInputJson) as CompleteExerciseInput,
    summary: plan.summary,
    rationale: plan.rationale,
    diff: JSON.parse(plan.diffJson) as string[],
    status: plan.status,
    appliedExerciseId: plan.appliedExerciseId,
    originRunId: plan.originRunId,
    originUserMessageId: plan.originUserMessageId,
    appliedAs: plan.appliedAs,
    supersedesPlanId: plan.supersedesPlanId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

async function resetRoutinePlanToPending(env: WorkerEnv, ownerEmail: string, planId: string) {
  await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'pending', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying'`).bind(new Date().toISOString(), planId, ownerEmail).run();
}

async function markRoutinePlanStale(env: WorkerEnv, ownerEmail: string, planId: string) {
  await env.DB.prepare(`UPDATE assistant_change_plans SET status = 'stale', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying'`).bind(new Date().toISOString(), planId, ownerEmail).run();
}

async function resetExercisePlanToPending(env: WorkerEnv, ownerEmail: string, planId: string) {
  await env.DB.prepare(`UPDATE assistant_exercise_change_plans SET status = 'pending', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying'`).bind(new Date().toISOString(), planId, ownerEmail).run();
}

async function markExercisePlanStale(env: WorkerEnv, ownerEmail: string, planId: string) {
  await env.DB.prepare(`UPDATE assistant_exercise_change_plans SET status = 'stale', updated_at = ?
    WHERE id = ? AND owner_email = ? AND status = 'applying'`).bind(new Date().toISOString(), planId, ownerEmail).run();
}

async function recordToolCall(
  env: WorkerEnv,
  ownerEmail: string,
  threadId: string,
  toolName: string,
  argumentsValue: unknown,
  output: unknown,
  status: string,
  id: string = crypto.randomUUID(),
) {
  const compact = (value: unknown) => {
    const json = JSON.stringify(value);
    return json.length <= 30_000 ? json : JSON.stringify({ omitted: true, originalCharacters: json.length });
  };
  await env.DB.prepare(`INSERT OR IGNORE INTO assistant_tool_calls (
    id, owner_email, thread_id, tool_name, arguments_json, output_json, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, ownerEmail, threadId, toolName, compact(argumentsValue),
    compact(output), status, new Date().toISOString(),
  ).run();
}
