import { getWorkoutUser } from "../../chatgpt-auth";
import { startWorkout } from "../../../lib/store";

export async function POST(request: Request) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const payload = await request.json() as { routineId?: string; abandonActive?: boolean };
    if (!payload.routineId) return Response.json({ error: "Routine is required." }, { status: 400 });
    const result = await startWorkout(user.email, payload.routineId, Boolean(payload.abandonActive));
    if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The workout could not be started." }, { status: 500 });
  }
}
