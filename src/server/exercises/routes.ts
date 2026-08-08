import { apiError, apiResponse, errorMessage, readJson } from "../http";
import type { RouteContext } from "../route-context";
import { getEntityServices } from "../services";
import {
  exerciseListQuery,
  exerciseProgressQuery,
  exerciseRequestOperation,
} from "./request-policy";

export async function handleExercises({ request, user, segments }: RouteContext) {
  const service = getEntityServices().exercises;
  const operation = exerciseRequestOperation(request.method, segments);
  if (operation.kind === "list") {
    return apiResponse(request, {
      exercises: await service.list(user.email, exerciseListQuery(new URL(request.url))),
    });
  }
  if (operation.kind === "create") {
    try {
      const exercise = await service.create(user.email, await readJson(request));
      return apiResponse(request, { exercise }, { status: 201 });
    } catch (error) {
      return apiError(request, 400, "exercise_invalid", errorMessage(error, "Exercise could not be created."));
    }
  }
  if (operation.kind === "progress") {
    try {
      const progress = await service.progress(
        user.email,
        operation.exerciseId,
        exerciseProgressQuery(new URL(request.url)),
      );
      return progress
        ? apiResponse(request, { progress })
        : apiError(request, 404, "exercise_not_found", "Exercise not found.");
    } catch (error) {
      return apiError(
        request,
        400,
        "exercise_progress_invalid",
        errorMessage(error, "Exercise progress could not be loaded."),
      );
    }
  }
  if (operation.kind === "favorite") {
    const exercise = await service.setFavorite(
      user.email,
      operation.exerciseId,
      operation.favorite,
    );
    return exercise
      ? apiResponse(request, { exercise })
      : apiError(request, 404, "exercise_not_found", "Exercise not found.");
  }
  if (operation.kind === "get") {
    const exercise = await service.get(user.email, operation.exerciseId);
    return exercise
      ? apiResponse(request, { exercise })
      : apiError(request, 404, "exercise_not_found", "Exercise not found.");
  }
  if (operation.kind === "update") {
    try {
      const exercise = await service.update(
        user.email,
        operation.exerciseId,
        await readJson(request),
      );
      return exercise
        ? apiResponse(request, { exercise })
        : apiError(request, 404, "exercise_not_found", "Exercise not found.");
    } catch (error) {
      return apiError(request, 400, "exercise_invalid", errorMessage(error, "Exercise could not be updated."));
    }
  }
  if (operation.kind === "archive") {
    const archived = await service.archive(user.email, operation.exerciseId);
    return archived
      ? apiResponse(request, { archived: true })
      : apiError(request, 404, "exercise_not_found", "Exercise not found.");
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for exercises.");
}
