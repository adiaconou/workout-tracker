import {
  getRoutineList,
  getRoutineRecommendations,
  getWorkoutSession,
} from "../db/training-store";
import { apiError, apiResponse } from "../http";
import { sessionUser } from "../profile/public";
import type { RouteContext } from "../route-context";
import { getEntityServices } from "../services";

export async function handleBootstrap({ request, user }: RouteContext) {
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
    user: sessionUser(user),
    routines,
    recommendations,
    activeWorkout,
  });
}
