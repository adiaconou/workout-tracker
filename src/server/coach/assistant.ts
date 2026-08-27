import { validateRoutineVersionInput } from "../../domain/routines/validation";
import { isRoutineVersionSemanticallyEqual } from "../../domain/routines/comparison";
import type {
  GeneratedRoutineProgram as GeneratedRoutineProgramPayload,
  ProgramGenerationJob,
} from "../../contracts/api";
import {
  ROUTINE_DURATION_ESTIMATE_ASSUMPTIONS,
  ROUTINE_DURATION_ESTIMATE_TOLERANCE,
  routineDurationToleranceMinutes,
} from "../../domain/routines/duration";
import { getEntityServices } from "../services";
import { getProgramGenerationJobRepository } from "../db";
import type { StoredProgramGenerationJob } from "../db/program-generation-job-repository";
import {
  muscleGroups,
  normalizeExerciseName,
  type Exercise,
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
  CoachToolLoopError,
  runCoachToolLoop,
  type CoachResponse,
  type CoachToolActivity,
  type CoachToolChoice,
} from "./tool-loop";
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
  const [messages, plans, checkIns, modelCatalog] = await Promise.all([
    listMessages(env, user.email, thread.id),
    listChangePlans(env, user.email, thread.id),
    listCheckIns(env, user.email),
    listModelCatalog(env),
  ]);
  return apiResponse(request, {
    profile,
    threads: threads.some((candidate) => candidate.id === thread.id) ? threads : [thread, ...threads],
    thread,
    messages,
    plans,
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
  try {
    const input = await readJson<{
      threadId?: string;
      content?: string;
      model?: string;
      reasoningEffort?: string;
    }>(request);
    const content = cleanRequiredText(input.content, "Message", 4_000);
    const thread = input.threadId ? await getThread(env, user.email, input.threadId) : await insertThread(env, user.email);
    if (!thread) {
      return apiError(request, 404, "assistant_thread_not_found", "Coaching conversation not found.");
    }
    const profile = await ensureCoachProfile(env, user.email);
    const catalog = await listModelCatalog(env);
    const model = cleanModel(input.model ?? profile.model ?? pickDefaultModel(env, catalog.models));
    const availableModel = catalog.models.find((option) => option.id === model);
    if (!availableModel) {
      return apiError(request, 400, "assistant_model_unavailable", "That model is not available for this API key.");
    }
    const reasoningEffort = cleanReasoningEffort(input.reasoningEffort ?? profile.reasoningEffort, availableModel.reasoningEfforts);
    const now = new Date().toISOString();
    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      threadId: thread.id,
      role: "user",
      content,
      model: null,
      reasoningEffort: null,
      createdAt: now,
    };
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO assistant_messages (
        id, owner_email, thread_id, role, content, model, reasoning_effort, response_id, created_at
      ) VALUES (?, ?, ?, 'user', ?, NULL, NULL, NULL, ?)`)
        .bind(userMessage.id, user.email, thread.id, content, now),
      env.DB.prepare(`UPDATE assistant_threads SET title = CASE
        WHEN title = 'New coaching conversation' THEN ? ELSE title END,
        updated_at = ? WHERE id = ? AND owner_email = ?`)
        .bind(content.slice(0, 64), now, thread.id, user.email),
      env.DB.prepare(`UPDATE coach_profiles SET model = ?, reasoning_effort = ?, updated_at = ?
        WHERE owner_email = ?`).bind(model, reasoningEffort, now, user.email),
    ]);

    const history = await listMessages(env, user.email, thread.id, 50);
    const checkIns = await listCheckIns(env, user.email);
    const result = await runCoach({
      env,
      user,
      thread,
      profile: { ...profile, model, reasoningEffort },
      history,
      checkIns,
      model,
      reasoningEffort,
    });
    const assistantMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      threadId: thread.id,
      role: "assistant",
      content: result.text,
      activities: result.activities,
      model,
      reasoningEffort,
      createdAt: new Date().toISOString(),
    };
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO assistant_messages (
        id, owner_email, thread_id, role, content, model, reasoning_effort,
        response_id, activities_json, created_at
      ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`)
        .bind(
          assistantMessage.id,
          user.email,
          thread.id,
          assistantMessage.content,
          model,
          reasoningEffort,
          result.responseId,
          JSON.stringify(result.activities),
          assistantMessage.createdAt,
        ),
      env.DB.prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ? AND owner_email = ?")
        .bind(assistantMessage.createdAt, thread.id, user.email),
    ]);
    return apiResponse(request, {
      thread: { ...thread, title: thread.title === "New coaching conversation" ? content.slice(0, 64) : thread.title },
      userMessage,
      assistantMessage,
      plans: await listChangePlans(env, user.email, thread.id),
    }, { status: 201 });
  } catch (error) {
    const status = error instanceof OpenAIRequestError ? error.status : 400;
    return apiError(
      request,
      status,
      error instanceof OpenAIRequestError ? "coach_model_request_failed" : "coach_message_invalid",
      errorMessage(error, "The coach could not respond."),
      status === 429 || status >= 500,
    );
  }
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
      applied_version_id = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
      .bind(version.id, now, plan.id, user.email).run();
    return apiResponse(request, {
      plan: { ...serializeRoutinePlan(plan), status: "applied", appliedVersionId: version.id, updatedAt: now },
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
    routine_id = ?, applied_version_id = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
    .bind(routine.id, version.id, now, plan.id, user.email).run();
  return apiResponse(request, {
    plan: {
      ...serializeRoutinePlan({ ...plan, routineId: routine.id, status: "applied", updatedAt: now }),
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
      routine_id = ?, applied_version_id = ?, updated_at = ?
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
      routine_id = ?, applied_version_id = ?, updated_at = ?
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
          routine_id = ?, applied_version_id = ?, updated_at = ?
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

async function runCoach(input: {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  profile: CoachProfile;
  history: AssistantMessage[];
  checkIns: CoachCheckIn[];
  model: string;
  reasoningEffort: string;
}) {
  try {
    return await runCoachToolLoop({
      conversation: input.history.map((message) => ({ role: message.role, content: message.content })),
      createResponse: (conversation, toolChoice) => createOpenAIResponse(input.env, {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        safetyIdentifier: input.user.id,
        instructions: coachInstructions(input.profile, input.checkIns),
        input: conversation,
        tools: coachTools,
        toolChoice,
      }),
      executeTool: ({ name, argumentsValue }) => executeCoachTool({
        env: input.env,
        user: input.user,
        thread: input.thread,
        name,
        argumentsValue,
      }),
      recordToolCall: ({ name, argumentsValue, output, status }) => recordToolCall(
        input.env,
        input.user.email,
        input.thread.id,
        name,
        argumentsValue,
        output,
        status,
      ),
      formatError: errorMessage,
      isProposalTool: (name) => ["propose_new_routine", "propose_routine_change", "propose_exercise_change"].includes(name),
      proposalCompletionText,
      reportAuditError: (error) => console.error("Coach tool-call audit failed", error),
    });
  } catch (error) {
    if (error instanceof CoachToolLoopError) throw new OpenAIRequestError(error.message);
    throw error;
  }
}

function proposalCompletionText(name: string) {
  if (name === "propose_new_routine") {
    return "I prepared a new routine for review. Nothing has changed yet.";
  }
  if (name === "propose_routine_change") {
    return "I prepared a routine change for review. Nothing has changed yet.";
  }
  return null;
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
    metadata?: Record<string, string>;
    textVerbosity?: "low" | "medium" | "high";
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
        tools: input.tools,
        tool_choice: input.toolChoice,
        parallel_tool_calls: false,
        reasoning,
        text: { verbosity: input.textVerbosity ?? "medium" },
        max_output_tokens: outputTokenBudget(input.model),
        safety_identifier: input.safetyIdentifier,
        background: input.background || undefined,
        metadata: input.metadata,
        store: false,
      }),
    },
    input.timeoutMs ?? assistantApiTimeoutMs,
    input.timeoutMessage ?? "The coach took too long to respond. Try again or select a lower reasoning effort.",
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

async function executeCoachTool(input: {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  name: string;
  argumentsValue: Record<string, unknown>;
}) {
  const services = getEntityServices();
  const ownerEmail = input.user.email;
  switch (input.name) {
    case "get_coaching_context": {
      const [routines, history, activeWorkouts, checkIns] = await Promise.all([
        services.routines.list(ownerEmail),
        services.workouts.history(ownerEmail, { limit: 12, offset: 0 }),
        services.workouts.list(ownerEmail, { status: "In Progress" }),
        listCheckIns(input.env, ownerEmail),
      ]);
      return { routines, history, activeWorkout: activeWorkouts[0] ?? null, checkIns };
    }
    case "get_routine":
      return { routine: await services.routines.get(ownerEmail, cleanRequiredText(input.argumentsValue.routineId, "Routine", 100)) };
    case "list_routine_versions":
      return { versions: await services.routines.listVersions(ownerEmail, cleanRequiredText(input.argumentsValue.routineId, "Routine", 100)) };
    case "search_exercises": {
      const query = typeof input.argumentsValue.query === "string" ? input.argumentsValue.query : undefined;
      return { exercises: await services.exercises.list(ownerEmail, {
        search: query,
        includeArchived: input.argumentsValue.includeArchived === true,
        availableOnly: true,
      }) };
    }
    case "get_exercise":
      return { exercise: await services.exercises.get(ownerEmail, cleanRequiredText(input.argumentsValue.exerciseId, "Exercise", 160)) };
    case "get_workout_history": {
      const limit = boundedInteger(input.argumentsValue.limit, 1, 30, "History limit");
      const routineCode = typeof input.argumentsValue.routineCode === "string" ? input.argumentsValue.routineCode : undefined;
      return { history: await services.workouts.history(ownerEmail, { limit, offset: 0, routineCode }) };
    }
    case "get_active_workout": {
      const workouts = await services.workouts.list(ownerEmail, { status: "In Progress" });
      return { workout: workouts[0] ?? null };
    }
    case "propose_new_routine":
      return proposeNewRoutine(input);
    case "propose_routine_change":
      return proposeRoutineChange(input);
    case "propose_exercise_change":
      return proposeExerciseChange(input);
    default:
      throw new Error(`Unknown coach tool: ${input.name}`);
  }
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

async function proposeNewRoutine(input: {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  argumentsValue: Record<string, unknown>;
}) {
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
  if (existing) return routineProposalToolResult(existing, instruction);
  const now = new Date().toISOString();
  const planId = crypto.randomUUID();
  await input.env.DB.prepare(`INSERT INTO assistant_change_plans (
    id, owner_email, thread_id, routine_id, routine_code, base_version_id,
    proposed_input_json, summary, rationale, diff_json, status,
    applied_version_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
    .bind(
      planId,
      input.user.email,
      input.thread.id,
      planId,
      routineCode,
      proposedInputJson,
      summary,
      rationale,
      JSON.stringify(diff),
      now,
      now,
    )
    .run();
  return routineProposalToolResult({
    id: planId,
    routineCode,
    summary,
    rationale,
    diffJson: JSON.stringify(diff),
  }, instruction);
}

async function proposeRoutineChange(input: {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  argumentsValue: Record<string, unknown>;
}) {
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
  if (existing) return routineProposalToolResult(existing, instruction);
  const now = new Date().toISOString();
  const planId = crypto.randomUUID();
  await input.env.DB.prepare(`INSERT INTO assistant_change_plans (
    id, owner_email, thread_id, routine_id, routine_code, base_version_id,
    proposed_input_json, summary, rationale, diff_json, status,
    applied_version_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
    .bind(planId, input.user.email, input.thread.id, routine.id, routine.code, baseVersionId, proposedInputJson, summary, rationale, JSON.stringify(diff), now, now)
    .run();
  return routineProposalToolResult({
    id: planId,
    routineCode: routine.code,
    summary,
    rationale,
    diffJson: JSON.stringify(diff),
  }, instruction);
}

async function proposeExerciseChange(input: {
  env: WorkerEnv;
  user: ApiUser;
  thread: AssistantThread;
  argumentsValue: Record<string, unknown>;
}) {
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
  const planId = crypto.randomUUID();
  await input.env.DB.prepare(`INSERT INTO assistant_exercise_change_plans (
    id, owner_email, thread_id, action, exercise_id, exercise_name,
    base_updated_at, base_input_json, proposed_input_json, summary, rationale,
    diff_json, status, applied_exercise_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
    .bind(
      planId,
      input.user.email,
      input.thread.id,
      action,
      exerciseId,
      exerciseName,
      baseUpdatedAt,
      current ? JSON.stringify(exerciseInputSnapshot(current)) : null,
      JSON.stringify(proposed ?? {}),
      summary,
      rationale,
      JSON.stringify(diff),
      now,
      now,
    )
    .run();
  return {
    planId,
    status: "ready_for_review",
    action,
    exerciseName,
    summary,
    rationale,
    diff,
    instruction: "Tell the user the review card is ready and nothing has changed yet. Do not ask for verbal approval.",
  };
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

const routineSetSchema = {
  type: "object",
  properties: {
    sourceRoutineSetId: { type: ["string", "null"], description: "Current set ID, or null only for a newly added set." },
    position: { type: "integer", minimum: 1 },
    setType: { type: "string", enum: ["warmup", "regular", "failure", "drop", "emom", "test"] },
    targetType: { type: "string", enum: ["reps", "duration", "rounds"] },
    targetMin: { type: ["number", "null"] },
    targetMax: { type: ["number", "null"] },
    targetDisplay: { type: "string" },
    targetRirMin: { type: ["number", "null"] },
    targetRirMax: { type: ["number", "null"] },
    restAfterSec: { type: "integer", minimum: 0 },
    restRule: { type: "string", enum: ["standard", "after_both_sides", "no_rest_before_drop", "emom", "after_superset"] },
    loadInstruction: { type: "string" },
    sideMode: { type: "string", enum: ["bilateral", "per_side", "per_leg", "left_right"] },
    tempo: { type: ["string", "null"] },
    notes: { type: "string" },
  },
  required: [
    "sourceRoutineSetId", "position", "setType", "targetType", "targetMin", "targetMax", "targetDisplay",
    "targetRirMin", "targetRirMax", "restAfterSec", "restRule", "loadInstruction",
    "sideMode", "tempo", "notes",
  ],
  additionalProperties: false,
} as const;

const newRoutineSetSchema = {
  ...routineSetSchema,
  properties: {
    ...routineSetSchema.properties,
    sourceRoutineSetId: { type: "null", description: "Always null because this set does not exist yet." },
  },
} as const;

const routineExerciseSchema = {
  type: "object",
  properties: {
    sourceRoutineExerciseId: { type: ["string", "null"], description: "Current routine placement ID, or null only for a newly added exercise." },
    exerciseId: { type: "string" },
    position: { type: "integer", minimum: 1 },
    supersetGroup: { type: ["string", "null"] },
    instructions: { type: "string" },
    notes: { type: "string" },
    sets: { type: "array", minItems: 1, items: routineSetSchema },
  },
  required: ["sourceRoutineExerciseId", "exerciseId", "position", "supersetGroup", "instructions", "notes", "sets"],
  additionalProperties: false,
} as const;

const newRoutineExerciseSchema = {
  ...routineExerciseSchema,
  properties: {
    ...routineExerciseSchema.properties,
    sourceRoutineExerciseId: { type: "null", description: "Always null because this routine placement does not exist yet." },
    sets: { type: "array", minItems: 1, items: newRoutineSetSchema },
  },
} as const;

const routineProposalSchema = {
  type: "object",
  properties: {
    focus: { type: "string" },
    summary: { type: "string" },
    durationMin: { type: "integer", minimum: 5, maximum: 300 },
    exercises: { type: "array", minItems: 1, items: routineExerciseSchema },
  },
  required: ["focus", "summary", "durationMin", "exercises"],
  additionalProperties: false,
} as const;

const newRoutineProposalSchema = {
  ...routineProposalSchema,
  properties: {
    ...routineProposalSchema.properties,
    exercises: { type: "array", minItems: 1, items: newRoutineExerciseSchema },
  },
} as const;

const proposedExerciseSchema = {
  type: ["object", "null"],
  properties: {
    name: { type: "string" },
    equipment: { type: "string" },
    movementPattern: { type: "string" },
    trackingType: { type: "string", enum: ["reps", "duration", "rounds"] },
    defaultLoadType: { type: "string", enum: ["external", "bodyweight", "added", "assistance"] },
    sideMode: { type: "string", enum: ["bilateral", "per_side", "per_leg", "left_right"] },
    instructions: { type: "string" },
    muscles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          muscleGroup: { type: "string", enum: [...muscleGroups] },
          role: { type: "string", enum: ["primary", "secondary"] },
          weight: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        },
        required: ["muscleGroup", "role", "weight"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "name", "equipment", "movementPattern", "trackingType", "defaultLoadType",
    "sideMode", "instructions", "muscles",
  ],
  additionalProperties: false,
} as const;

const coachTools = [
  functionTool("get_coaching_context", "Get routines, recent workout history, active workout, and readiness check-ins.", emptySchema()),
  functionTool("get_routine", "Get one routine and its complete current structured prescription.", objectSchema({ routineId: { type: "string", description: "Routine code or ID." } }, ["routineId"])),
  functionTool("list_routine_versions", "List saved versions for one routine.", objectSchema({ routineId: { type: "string", description: "Routine code or ID." } }, ["routineId"])),
  functionTool("search_exercises", "Search active exercises supported by the user's selected equipment for substitutions or additions.", objectSchema({
    query: { type: ["string", "null"] },
    includeArchived: { type: "boolean" },
  }, ["query", "includeArchived"])),
  functionTool("get_exercise", "Get one exact exercise-library record, including its current fields, muscles, active state, and updated timestamp.", objectSchema({
    exerciseId: { type: "string" },
  }, ["exerciseId"])),
  functionTool("get_workout_history", "Get recent workout history and aggregate performance totals.", objectSchema({
    limit: { type: "integer", minimum: 1, maximum: 30 },
    routineCode: { type: ["string", "null"] },
  }, ["limit", "routineCode"])),
  functionTool("get_active_workout", "Get the workout currently in progress, if any.", emptySchema()),
  functionTool("propose_new_routine", "Stage a pending review card for a brand-new routine the user clearly requested. Inspect current routines and the equipment-filtered exercise library first, use only returned exercise IDs, and target the user's session duration. Prior chat approval is not required. This stores only the proposal and cannot create or publish the routine. The user must choose Create routine in the UI.", objectSchema({
    routineCode: { type: "string", minLength: 1, maxLength: 20, description: "A short unique label for the new routine." },
    proposedRoutine: newRoutineProposalSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["routineCode", "proposedRoutine", "summary", "rationale"])),
  functionTool("propose_routine_change", "Stage a pending review card for a routine change the user clearly requested. Call after reading the current routine; prior chat approval is not required. This stores only the proposal and cannot create or publish a routine version or change the current routine. The user must choose Apply & publish or Save as draft in the UI.", objectSchema({
    routineId: { type: "string" },
    baseVersionId: { type: "string" },
    proposedRoutine: routineProposalSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["routineId", "baseVersionId", "proposedRoutine", "summary", "rationale"])),
  functionTool("propose_exercise_change", "Stage a pending review card for an exercise-library change the user clearly requested. Inspect the exact target or search the proposed name first, and keep created or changed equipment within the user's selected equipment. Prior chat approval is not required. This stores only the proposal and cannot create, update, or archive an exercise. The user must choose the action in the UI.", objectSchema({
    action: { type: "string", enum: ["create", "update", "archive"] },
    exerciseId: { type: ["string", "null"], description: "Null only when creating an exercise." },
    baseUpdatedAt: { type: ["string", "null"], description: "The exact current updatedAt value, or null when creating." },
    proposedExercise: proposedExerciseSchema,
    summary: { type: "string" },
    rationale: { type: "string" },
  }, ["action", "exerciseId", "baseUpdatedAt", "proposedExercise", "summary", "rationale"])),
];

function functionTool(name: string, description: string, parameters: unknown) {
  return { type: "function", name, description, parameters, strict: true };
}

function emptySchema() {
  return { type: "object", properties: {}, required: [], additionalProperties: false };
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
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
    env.DB.prepare(`SELECT id, thread_id AS threadId,
      routine_id AS routineId, routine_code AS routineCode,
      base_version_id AS baseVersionId, proposed_input_json AS proposedInputJson,
      summary, rationale, diff_json AS diffJson, status,
      applied_version_id AS appliedVersionId, created_at AS createdAt, updated_at AS updatedAt
      FROM assistant_change_plans WHERE owner_email = ? AND thread_id = ?
      ORDER BY created_at DESC LIMIT 20`).bind(ownerEmail, threadId).all<ChangePlanRow>(),
    env.DB.prepare(`SELECT id, thread_id AS threadId, action,
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
  const rows = await env.DB.prepare(`SELECT id, thread_id AS threadId,
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
  return env.DB.prepare(`SELECT id, thread_id AS threadId,
    routine_id AS routineId, routine_code AS routineCode,
    base_version_id AS baseVersionId, proposed_input_json AS proposedInputJson,
    summary, rationale, diff_json AS diffJson, status,
    applied_version_id AS appliedVersionId, created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_change_plans WHERE id = ? AND owner_email = ?`).bind(planId, ownerEmail).first<ChangePlanRow>();
}

async function getExerciseChangePlan(env: WorkerEnv, ownerEmail: string, planId: string) {
  return env.DB.prepare(`SELECT id, thread_id AS threadId, action,
    exercise_id AS exerciseId, exercise_name AS exerciseName,
    base_updated_at AS baseUpdatedAt, base_input_json AS baseInputJson,
    proposed_input_json AS proposedInputJson, summary, rationale,
    diff_json AS diffJson, status, applied_exercise_id AS appliedExerciseId,
    created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_exercise_change_plans WHERE id = ? AND owner_email = ?`)
    .bind(planId, ownerEmail).first<ExerciseChangePlanRow>();
}

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
) {
  const compact = (value: unknown) => JSON.stringify(value).slice(0, 30_000);
  await env.DB.prepare(`INSERT INTO assistant_tool_calls (
    id, owner_email, thread_id, tool_name, arguments_json, output_json, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), ownerEmail, threadId, toolName, compact(argumentsValue),
    compact(output), status, new Date().toISOString(),
  ).run();
}
