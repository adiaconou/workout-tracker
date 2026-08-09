import type { RoutineProgramCreateInput } from "../../domain/entities";
import { RoutineProgramInputError } from "../../domain/programs/validation";
import { apiError, apiResponse, errorMessage, readJson } from "../http";
import type { RouteContext } from "../route-context";
import { getEntityServices } from "../services";
import {
  programIdempotencyKey,
  programRequestOperation,
} from "./request-policy";
import { ProgramIdempotencyConflictError } from "./service";

export async function handlePrograms({ request, user, segments }: RouteContext) {
  const service = getEntityServices().programs;
  const operation = programRequestOperation(request.method, segments);

  if (operation.kind === "list") {
    return apiResponse(request, { programs: await service.list(user.email) });
  }
  if (operation.kind === "get") {
    const program = await service.get(user.email, operation.programId);
    return program
      ? apiResponse(request, { program })
      : apiError(request, 404, "program_not_found", "Program not found.");
  }
  if (operation.kind === "create") {
    let input: RoutineProgramCreateInput;
    try {
      input = await readJson<RoutineProgramCreateInput>(request);
    } catch (error) {
      return apiError(
        request,
        400,
        "program_invalid",
        errorMessage(error, "Program details must be valid JSON."),
      );
    }
    try {
      const result = await service.create(
        user.email,
        programIdempotencyKey(request),
        input,
      );
      return apiResponse(
        request,
        { program: result.program },
        { status: result.created ? 201 : 200 },
      );
    } catch (error) {
      if (error instanceof ProgramIdempotencyConflictError) {
        return apiError(request, 409, "program_idempotency_conflict", error.message);
      }
      if (error instanceof RoutineProgramInputError) {
        return apiError(request, 400, "program_invalid", error.message);
      }
      throw error;
    }
  }
  if (operation.kind === "activate") {
    const program = await service.activate(user.email, operation.programId);
    return program
      ? apiResponse(request, { program })
      : apiError(request, 404, "program_not_found", "Program not found.");
  }
  return apiError(request, 405, "method_not_allowed", "Method not allowed for programs.");
}
