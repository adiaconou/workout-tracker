import { getEntityServices } from "../application/services";
import {
  completeWorkoutEarly,
  getRoutine,
  getRoutineList,
  getRoutineRecommendations,
  getWorkoutSession,
  recordWorkoutSet,
  skipWorkoutRest,
  startWorkout,
  updateRoutine,
} from "../lib/store";
import {
  authenticateRequest,
  createNativeSession,
  linkGoogleIdentity,
  revokeNativeSession,
  rotateNativeSession,
} from "./auth";
import {
  apiError,
  apiResponse,
  errorMessage,
  preflightResponse,
  readJson,
} from "./http";
import type { ApiUser, WorkerEnv } from "./types";
import { verifyGoogleIdToken } from "./google";
import { handleAssistantRequest } from "./assistant";

type RouteContext = {
  request: Request;
  env: WorkerEnv;
  user: ApiUser;
  segments: string[];
};

export async function handleApiRequest(request: Request, env: WorkerEnv) {
  if (request.method === "OPTIONS") return preflightResponse(request);
  const url = new URL(request.url);
  const segments = url.pathname
    .replace(/^\/api\/v1\/?/u, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  try {
    if (
      segments[0] === "auth" &&
      segments[1] === "google" &&
      segments[2] === "exchange"
    ) {
      return handleGoogleExchange(request, env);
    }
    if (segments[0] === "auth" && segments[1] === "refresh") {
      return handleRefresh(request, env);
    }

    const user = await authenticateRequest(request, env);
    if (!user) {
      return apiError(request, 401, "authentication_required", "Sign in is required.");
    }
    const context = { request, env, user, segments };

    if (segments[0] === "auth") return handleAuthenticatedAuth(context);
    if (segments[0] === "bootstrap") return handleBootstrap(context);
    if (segments[0] === "exercises") return handleExercises(context);
    if (segments[0] === "routines") return handleRoutines(context);
    if (segments[0] === "workouts") return handleWorkouts(context);
    if (segments[0] === "assistant") return handleAssistantRequest(context);

    return apiError(request, 404, "route_not_found", "API route not found.");
  } catch (error) {
    return apiError(
      request,
      500,
      "internal_error",
      errorMessage(error, "The request could not be completed."),
      true,
    );
  }
}

async function handleGoogleExchange(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") {
    return apiError(request, 405, "method_not_allowed", "Use POST for Google sign-in.");
  }
  try {
    const payload = await readJson<{ idToken?: string; deviceName?: string }>(request);
    if (!payload.idToken) {
      return apiError(request, 400, "id_token_required", "A Google ID token is required.");
    }
    if (!env.GOOGLE_WEB_CLIENT_ID) {
      return apiError(request, 503, "google_auth_unavailable", "Google sign-in is not configured.");
    }
    const claims = await verifyGoogleIdToken(payload.idToken, env.GOOGLE_WEB_CLIENT_ID);
    const user = await linkGoogleIdentity(env, claims);
    const session = await createNativeSession(env, user, payload.deviceName ?? "Android device");
    return apiResponse(request, session, { status: 201 });
  } catch (error) {
    return apiError(request, 401, "google_sign_in_failed", errorMessage(error, "Google sign-in failed."));
  }
}

async function handleRefresh(request: Request, env: WorkerEnv) {
  if (request.method !== "POST") {
    return apiError(request, 405, "method_not_allowed", "Use POST to refresh a session.");
  }
  try {
    const payload = await readJson<{ refreshToken?: string }>(request);
    if (!payload.refreshToken) {
      return apiError(request, 400, "refresh_token_required", "A refresh token is required.");
    }
    const session = await rotateNativeSession(env, payload.refreshToken);
    return session
      ? apiResponse(request, session)
      : apiError(request, 401, "refresh_session_invalid", "The device session has expired or was revoked.");
  } catch (error) {
    return apiError(request, 400, "refresh_failed", errorMessage(error, "The session could not be refreshed."));
  }
}

async function handleAuthenticatedAuth({ request, env, user, segments }: RouteContext) {
  if (segments[1] === "session" && request.method === "GET") {
    return apiResponse(request, {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      provider: user.provider,
    });
  }
  if (segments[1] === "logout" && request.method === "POST") {
    if (user.sessionId) await revokeNativeSession(env, user.sessionId);
    return apiResponse(request, { signedOut: true });
  }
  return apiError(request, 404, "auth_route_not_found", "Authentication route not found.");
}

async function handleBootstrap({ request, user }: RouteContext) {
  if (request.method !== "GET") {
    return apiError(request, 405, "method_not_allowed", "Use GET for application bootstrap.");
  }
  const services = getEntityServices();
  const [routines, recommendations, active] = await Promise.all([
    getRoutineList(user.email),
    getRoutineRecommendations(user.email),
    services.workouts.list(user.email, { status: "In Progress" }),
  ]);
  const activeWorkout = active[0]
    ? await getWorkoutSession(user.email, active[0].id)
    : null;
  return apiResponse(request, {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    routines,
    recommendations,
    activeWorkout,
  });
}

async function handleExercises({ request, user, segments }: RouteContext) {
  const service = getEntityServices().exercises;
  const exerciseId = segments[1];
  const action = segments[2];
  if (!exerciseId) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      return apiResponse(request, {
        exercises: await service.list(user.email, {
          includeArchived: url.searchParams.get("includeArchived") === "true",
          search: url.searchParams.get("search") ?? undefined,
        }),
      });
    }
    if (request.method === "POST") {
      try {
        const exercise = await service.create(user.email, await readJson(request));
        return apiResponse(request, { exercise }, { status: 201 });
      } catch (error) {
        return apiError(request, 400, "exercise_invalid", errorMessage(error, "Exercise could not be created."));
      }
    }
  } else if (action === "favorite") {
    if (request.method === "PUT" || request.method === "DELETE") {
      const exercise = await service.setFavorite(
        user.email,
        exerciseId,
        request.method === "PUT",
      );
      return exercise
        ? apiResponse(request, { exercise })
        : apiError(request, 404, "exercise_not_found", "Exercise not found.");
    }
  } else {
    if (request.method === "GET") {
      const exercise = await service.get(user.email, exerciseId);
      return exercise
        ? apiResponse(request, { exercise })
        : apiError(request, 404, "exercise_not_found", "Exercise not found.");
    }
    if (request.method === "PATCH") {
      try {
        const exercise = await service.update(user.email, exerciseId, await readJson(request));
        return exercise
          ? apiResponse(request, { exercise })
          : apiError(request, 404, "exercise_not_found", "Exercise not found.");
      } catch (error) {
        return apiError(request, 400, "exercise_invalid", errorMessage(error, "Exercise could not be updated."));
      }
    }
    if (request.method === "DELETE") {
      const archived = await service.archive(user.email, exerciseId);
      return archived
        ? apiResponse(request, { archived: true })
        : apiError(request, 404, "exercise_not_found", "Exercise not found.");
    }
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for exercises.");
}

async function handleRoutines({ request, user, segments }: RouteContext) {
  const service = getEntityServices().routines;
  const routineId = segments[1];
  const child = segments[2];
  const childId = segments[3];
  const action = segments[4];

  if (!routineId) {
    if (request.method === "GET") {
      const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
      return apiResponse(request, {
        routines: await service.list(user.email, includeArchived),
      });
    }
    if (request.method === "POST") {
      try {
        const payload = await readJson<{ code?: string; version?: never }>(request);
        if (!payload.code || !payload.version) {
          return apiError(request, 400, "routine_fields_required", "Routine code and version are required.");
        }
        const routine = await service.create(user.email, payload.code, payload.version);
        return apiResponse(request, { routine }, { status: 201 });
      } catch (error) {
        return apiError(request, 400, "routine_invalid", errorMessage(error, "Routine could not be created."));
      }
    }
  } else if (child === "prescription") {
    if (request.method === "GET") {
      const routine = await getRoutine(user.email, routineId);
      return routine
        ? apiResponse(request, { routine })
        : apiError(request, 404, "routine_not_found", "Routine not found.");
    }
    if (request.method === "PATCH") {
      try {
        const routine = await updateRoutine(user.email, routineId, await readJson(request));
        return routine
          ? apiResponse(request, { routine })
          : apiError(request, 404, "routine_not_found", "Routine not found.");
      } catch (error) {
        return apiError(request, 400, "routine_invalid", errorMessage(error, "The routine could not be saved."));
      }
    }
  } else if (child === "versions") {
    if (!childId) {
      if (request.method === "GET") {
        return apiResponse(request, {
          versions: await service.listVersions(user.email, routineId),
        });
      }
      if (request.method === "POST") {
        try {
          const version = await service.createVersion(user.email, routineId, await readJson(request));
          return apiResponse(request, { version }, { status: 201 });
        } catch (error) {
          return apiError(request, 400, "routine_version_invalid", errorMessage(error, "Routine version could not be created."));
        }
      }
    } else if (action === "publish" && request.method === "POST") {
      try {
        const routine = await service.publish(user.email, routineId, childId);
        return apiResponse(request, { routine });
      } catch (error) {
        return apiError(request, 400, "routine_publish_failed", errorMessage(error, "Routine version could not be published."));
      }
    } else if (request.method === "GET") {
      const version = await service.getVersion(user.email, routineId, childId);
      return version
        ? apiResponse(request, { version })
        : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
    } else if (request.method === "PATCH") {
      try {
        const version = await service.updateVersion(user.email, routineId, childId, await readJson(request));
        return version
          ? apiResponse(request, { version })
          : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
      } catch (error) {
        return apiError(request, 400, "routine_version_invalid", errorMessage(error, "Routine version could not be updated."));
      }
    } else if (request.method === "DELETE") {
      const deleted = await service.deleteVersion(user.email, routineId, childId);
      return deleted
        ? apiResponse(request, { deleted: true })
        : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
    }
  } else {
    if (request.method === "GET") {
      const routine = await service.get(user.email, routineId);
      return routine
        ? apiResponse(request, { routine })
        : apiError(request, 404, "routine_not_found", "Routine not found.");
    }
    if (request.method === "PATCH") {
      const routine = await service.updateIdentity(user.email, routineId, await readJson(request));
      return routine
        ? apiResponse(request, { routine })
        : apiError(request, 404, "routine_not_found", "Routine not found.");
    }
    if (request.method === "DELETE") {
      const routine = await service.archive(user.email, routineId);
      return routine
        ? apiResponse(request, { archived: true, routine })
        : apiError(request, 404, "routine_not_found", "Routine not found.");
    }
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for routines.");
}

async function handleWorkouts({ request, user, segments }: RouteContext) {
  const service = getEntityServices().workouts;
  const workoutId = segments[1];
  const child = segments[2];
  const childId = segments[3];

  if (!workoutId) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("view") === "history") {
        try {
          return apiResponse(request, {
            history: await service.history(user.email, {
              from: url.searchParams.get("from") ?? undefined,
              to: url.searchParams.get("to") ?? undefined,
              routineCode: url.searchParams.get("routineCode") ?? undefined,
              status: url.searchParams.get("status") ?? undefined,
              exerciseSearch: url.searchParams.get("exercise") ?? undefined,
              limit: Number(url.searchParams.get("limit") ?? 20),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }),
          });
        } catch (error) {
          return apiError(
            request,
            400,
            "workout_history_invalid",
            errorMessage(error, "Workout history could not be loaded."),
          );
        }
      }
      return apiResponse(request, {
        workouts: await service.list(user.email, {
          includeArchived: url.searchParams.get("includeArchived") === "true",
          status: url.searchParams.get("status") ?? undefined,
        }),
      });
    }
    if (request.method === "POST") {
      try {
        const payload = await readJson<{ routineId?: string; abandonActive?: boolean }>(request);
        if (!payload.routineId) {
          return apiError(request, 400, "routine_required", "Routine is required.");
        }
        const result = await startWorkout(user.email, payload.routineId, Boolean(payload.abandonActive));
        return result
          ? apiResponse(request, result, { status: result.created ? 201 : 200 })
          : apiError(request, 404, "routine_not_found", "Routine not found.");
      } catch (error) {
        return apiError(request, 400, "workout_start_failed", errorMessage(error, "The workout could not be started."));
      }
    }
  } else if (child === "history" && !childId && request.method === "GET") {
    const [workout, session] = await Promise.all([
      service.get(user.email, workoutId),
      getWorkoutSession(user.email, workoutId),
    ]);
    return workout
      ? apiResponse(request, {
        workout,
        previousPerformanceByExercise:
          session?.previousPerformanceByExercise ?? {},
      })
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  } else if (child === "sets" && !childId && request.method === "POST") {
    try {
      const result = await recordWorkoutSet(user.email, workoutId, await readJson(request));
      return result
        ? apiResponse(request, result)
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(request, 400, "set_save_failed", errorMessage(error, "This set could not be saved."), true);
    }
  } else if (child === "sets" && childId && request.method === "PATCH") {
    try {
      const workoutSet = await service.correctSet(user.email, workoutId, childId, await readJson(request));
      return workoutSet
        ? apiResponse(request, { set: workoutSet })
        : apiError(request, 404, "workout_set_not_found", "Workout set not found.");
    } catch (error) {
      return apiError(request, 400, "set_correction_failed", errorMessage(error, "The workout set could not be corrected."));
    }
  } else if (child === "rest" && childId === "skip" && request.method === "POST") {
    try {
      const result = await skipWorkoutRest(user.email, workoutId);
      return result
        ? apiResponse(request, result)
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(request, 400, "rest_skip_failed", errorMessage(error, "Rest could not be skipped."));
    }
  } else if (child === "complete" && !childId && request.method === "POST") {
    try {
      const result = await completeWorkoutEarly(user.email, workoutId);
      return result
        ? apiResponse(request, result)
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(
        request,
        400,
        "workout_complete_failed",
        errorMessage(error, "The workout could not be completed early."),
      );
    }
  } else if (child === "discard" && !childId && request.method === "DELETE") {
    const result = await service.discard(user.email, workoutId);
    if (result === "discarded") {
      return apiResponse(request, { discarded: true, workoutId });
    }
    return result === "not_in_progress"
      ? apiError(
        request,
        409,
        "workout_not_in_progress",
        "Only a workout in progress can be discarded.",
      )
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  } else if (!child) {
    if (request.method === "GET") {
      const workout = await getWorkoutSession(user.email, workoutId);
      return workout
        ? apiResponse(request, { workout })
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    }
    if (request.method === "PATCH") {
      try {
        const workout = await service.update(user.email, workoutId, await readJson(request));
        return workout
          ? apiResponse(request, { workout })
          : apiError(request, 404, "workout_not_found", "Workout not found.");
      } catch (error) {
        return apiError(request, 400, "workout_update_failed", errorMessage(error, "Workout could not be updated."));
      }
    }
    if (request.method === "DELETE") {
      const archived = await service.archive(user.email, workoutId);
      return archived
        ? apiResponse(request, { archived: true })
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    }
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for workouts.");
}
