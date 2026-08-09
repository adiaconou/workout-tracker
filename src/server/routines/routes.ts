import type { RoutineVersionInput } from "../../domain/entities";
import { isRoutineVersionSemanticallyEqual } from "../../domain/routines/comparison";
import { validateRoutineVersionInput } from "../../domain/routines/validation";
import { getRoutine } from "../db/training-store";
import { apiError, apiResponse, errorMessage, readJson } from "../http";
import type { RouteContext } from "../route-context";
import { getEntityServices } from "../services";
import {
  routineCreationInput,
  routineEditorInput,
  routineListIncludesArchived,
  routineRequestOperation,
} from "./request-policy";

export async function handleRoutines({ request, user, segments }: RouteContext) {
  const service = getEntityServices().routines;
  const operation = routineRequestOperation(request.method, segments);

  if (operation.kind === "list") {
    return apiResponse(request, {
      routines: await service.list(
        user.email,
        routineListIncludesArchived(new URL(request.url)),
      ),
    });
  }
  if (operation.kind === "create") {
    try {
      const payload = await readJson<{ code?: string; version?: RoutineVersionInput }>(request);
      const input = routineCreationInput(payload);
      if (!input) {
        return apiError(request, 400, "routine_fields_required", "Routine code and version are required.");
      }
      const routine = await service.create(user.email, input.code, input.version);
      return apiResponse(request, { routine }, { status: 201 });
    } catch (error) {
      return apiError(request, 400, "routine_invalid", errorMessage(error, "Routine could not be created."));
    }
  }
  if (operation.kind === "editor_get") {
    const [routine, versions, activeWorkouts] = await Promise.all([
      service.get(user.email, operation.routineId),
      service.listVersions(user.email, operation.routineId),
      getEntityServices().workouts.list(user.email, { status: "In Progress" }),
    ]);
    if (!routine?.currentVersion) {
      return apiError(request, 404, "routine_not_found", "Routine not found.");
    }
    const activeWorkout = activeWorkouts[0];
    return apiResponse(request, {
      routine,
      versions,
      activeWorkout: activeWorkout
        ? { id: activeWorkout.id, routineCode: activeWorkout.routineCode }
        : null,
    });
  }
  if (operation.kind === "editor_update") {
    try {
      const payload = await readJson<{
        baseVersionId?: string;
        proposedRoutine?: RoutineVersionInput;
      }>(request);
      const input = routineEditorInput(payload);
      if (!input) {
        return apiError(
          request,
          400,
          "routine_editor_fields_required",
          "The current version and complete routine are required.",
        );
      }
      const current = await service.get(user.email, operation.routineId);
      if (!current?.currentVersion) {
        return apiError(request, 404, "routine_not_found", "Routine not found.");
      }
      if (current.currentVersionId !== input.baseVersionId) {
        return routineEditorStale(request);
      }
      const proposed = validateRoutineVersionInput(input.proposedRoutine);
      if (isRoutineVersionSemanticallyEqual(current.currentVersion, proposed)) {
        return apiError(request, 409, "routine_no_changes", "There are no routine changes to save.");
      }

      const version = await service.createVersion(user.email, current.id, proposed);
      let published;
      try {
        published = await service.publish(
          user.email,
          current.id,
          version.id,
          input.baseVersionId,
        );
      } catch (error) {
        await service.deleteVersion(user.email, current.id, version.id).catch(() => false);
        throw error;
      }
      if (!published) {
        await service.deleteVersion(user.email, current.id, version.id).catch(() => false);
        return routineEditorStale(request);
      }
      return apiResponse(request, {
        routine: published,
        versions: await service.listVersions(user.email, current.id),
      });
    } catch (error) {
      return apiError(
        request,
        400,
        "routine_editor_invalid",
        errorMessage(error, "The routine could not be saved."),
      );
    }
  }
  if (operation.kind === "prescription_get") {
    const routine = await getRoutine(user.email, operation.routineId);
    return routine
      ? apiResponse(request, { routine })
      : apiError(request, 404, "routine_not_found", "Routine not found.");
  }
  if (operation.kind === "prescription_legacy_write") {
    return apiError(
      request,
      410,
      "routine_editor_required",
      "Legacy routine writes are disabled. Use the normalized routine editor endpoint.",
    );
  }
  if (operation.kind === "versions_list") {
    const routine = await service.get(user.email, operation.routineId);
    if (!routine) {
      return apiError(request, 404, "routine_not_found", "Routine not found.");
    }
    return apiResponse(request, {
      versions: await service.listVersions(user.email, routine.id),
    });
  }
  if (operation.kind === "version_create") {
    try {
      const version = await service.createVersion(
        user.email,
        operation.routineId,
        await readJson(request),
      );
      return apiResponse(request, { version }, { status: 201 });
    } catch (error) {
      return apiError(request, 400, "routine_version_invalid", errorMessage(error, "Routine version could not be created."));
    }
  }
  if (operation.kind === "version_publish") {
    try {
      const routine = await service.publish(
        user.email,
        operation.routineId,
        operation.versionId,
      );
      return routine
        ? apiResponse(request, { routine })
        : apiError(
          request,
          404,
          "routine_version_not_found",
          "Routine version not found.",
        );
    } catch (error) {
      return apiError(request, 400, "routine_publish_failed", errorMessage(error, "Routine version could not be published."));
    }
  }
  if (operation.kind === "version_get") {
    const version = await service.getVersion(
      user.email,
      operation.routineId,
      operation.versionId,
    );
    return version
      ? apiResponse(request, { version })
      : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
  }
  if (operation.kind === "version_update") {
    try {
      const version = await service.updateVersion(
        user.email,
        operation.routineId,
        operation.versionId,
        await readJson(request),
      );
      return version
        ? apiResponse(request, { version })
        : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
    } catch (error) {
      return apiError(request, 400, "routine_version_invalid", errorMessage(error, "Routine version could not be updated."));
    }
  }
  if (operation.kind === "version_delete") {
    const deleted = await service.deleteVersion(
      user.email,
      operation.routineId,
      operation.versionId,
    );
    return deleted
      ? apiResponse(request, { deleted: true })
      : apiError(request, 404, "routine_version_not_found", "Routine version not found.");
  }
  if (operation.kind === "get") {
    const routine = await service.get(user.email, operation.routineId);
    return routine
      ? apiResponse(request, { routine })
      : apiError(request, 404, "routine_not_found", "Routine not found.");
  }
  if (operation.kind === "update") {
    const routine = await service.updateIdentity(
      user.email,
      operation.routineId,
      await readJson(request),
    );
    return routine
      ? apiResponse(request, { routine })
      : apiError(request, 404, "routine_not_found", "Routine not found.");
  }
  if (operation.kind === "archive") {
    const routine = await service.archive(user.email, operation.routineId);
    return routine
      ? apiResponse(request, { archived: true, routine })
      : apiError(request, 404, "routine_not_found", "Routine not found.");
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for routines.");
}

function routineEditorStale(request: Request) {
  return apiError(
    request,
    409,
    "routine_version_stale",
    "This routine changed after you started editing. Reload it before saving your changes.",
  );
}
