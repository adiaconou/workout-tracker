import {
  completeWorkoutEarly,
  getWorkoutSession,
  recordWorkoutSet,
  skipWorkoutRest,
  startWorkout,
  WorkoutRoutineUnavailableError,
  WorkoutRoutineVersionConflictError,
} from "../db/training-store";
import { apiError, apiResponse, errorMessage, readJson } from "../http";
import type { RouteContext } from "../route-context";
import { getEntityServices } from "../services";
import {
  requestHasJsonBody,
  workoutListRequest,
  workoutRequestOperation,
  workoutStartInput,
} from "./request-policy";

export async function handleWorkouts({ request, user, segments }: RouteContext) {
  const service = getEntityServices().workouts;
  const operation = workoutRequestOperation(request.method, segments);

  if (operation.kind === "list") {
    const url = new URL(request.url);
    const listRequest = workoutListRequest(url);
    if (listRequest.kind === "history") {
      try {
        return apiResponse(request, {
          history: await service.history(user.email, listRequest.query),
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
      workouts: await service.list(user.email, listRequest.query),
    });
  }
  if (operation.kind === "start") {
    try {
      const payload = await readJson<{
        routineId?: string;
        abandonActive?: boolean;
        expectedRoutineVersionId?: string;
      }>(request);
      const input = workoutStartInput(payload);
      if (!input) {
        return apiError(request, 400, "routine_required", "Routine is required.");
      }
      const result = await startWorkout(
        user.email,
        input.routineId,
        input.abandonActive,
        input.expectedRoutineVersionId,
      );
      return result
        ? apiResponse(request, result, { status: result.created ? 201 : 200 })
        : apiError(request, 404, "routine_not_found", "Routine not found.");
    } catch (error) {
      if (error instanceof WorkoutRoutineUnavailableError) {
        return apiError(request, 409, "routine_unavailable", error.message);
      }
      if (error instanceof WorkoutRoutineVersionConflictError) {
        return apiError(request, 409, "routine_version_stale", error.message);
      }
      return apiError(request, 400, "workout_start_failed", errorMessage(error, "The workout could not be started."));
    }
  }
  if (operation.kind === "history_get") {
    const [workout, session] = await Promise.all([
      service.get(user.email, operation.workoutId),
      getWorkoutSession(user.email, operation.workoutId),
    ]);
    return workout
      ? apiResponse(request, {
        workout,
        previousPerformanceByExercise:
          session?.previousPerformanceByExercise ?? {},
      })
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  }
  if (operation.kind === "set_record") {
    try {
      const result = await recordWorkoutSet(
        user.email,
        operation.workoutId,
        await readJson(request),
      );
      return result
        ? apiResponse(request, result)
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(request, 400, "set_save_failed", errorMessage(error, "This set could not be saved."), true);
    }
  }
  if (operation.kind === "set_correct") {
    try {
      const workoutSet = await service.correctSet(
        user.email,
        operation.workoutId,
        operation.setId,
        await readJson(request),
      );
      return workoutSet
        ? apiResponse(request, { set: workoutSet })
        : apiError(request, 404, "workout_set_not_found", "Workout set not found.");
    } catch (error) {
      return apiError(request, 400, "set_correction_failed", errorMessage(error, "The workout set could not be corrected."));
    }
  }
  if (operation.kind === "rest_skip") {
    try {
      const result = await skipWorkoutRest(user.email, operation.workoutId);
      return result
        ? apiResponse(request, result)
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(request, 400, "rest_skip_failed", errorMessage(error, "Rest could not be skipped."));
    }
  }
  if (operation.kind === "complete") {
    try {
      const input = requestHasJsonBody(request.headers.get("content-type"))
        ? await readJson<{ workoutElapsedSeconds?: number | null }>(request)
        : {};
      const result = await completeWorkoutEarly(user.email, operation.workoutId, input);
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
  }
  if (operation.kind === "discard") {
    const result = await service.discard(user.email, operation.workoutId);
    if (result === "discarded") {
      return apiResponse(request, { discarded: true, workoutId: operation.workoutId });
    }
    return result === "not_in_progress"
      ? apiError(
        request,
        409,
        "workout_not_in_progress",
        "Only a workout in progress can be discarded.",
      )
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  }
  if (operation.kind === "get") {
    const workout = await getWorkoutSession(user.email, operation.workoutId);
    return workout
      ? apiResponse(request, { workout })
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  }
  if (operation.kind === "update") {
    try {
      const workout = await service.update(
        user.email,
        operation.workoutId,
        await readJson(request),
      );
      return workout
        ? apiResponse(request, { workout })
        : apiError(request, 404, "workout_not_found", "Workout not found.");
    } catch (error) {
      return apiError(request, 400, "workout_update_failed", errorMessage(error, "Workout could not be updated."));
    }
  }
  if (operation.kind === "archive") {
    const archived = await service.archive(user.email, operation.workoutId);
    return archived
      ? apiResponse(request, { archived: true })
      : apiError(request, 404, "workout_not_found", "Workout not found.");
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for workouts.");
}
