import { getWorkoutUser } from "../../../chatgpt-auth";
import { updateRoutine } from "../../../../lib/store";
import { getEntityServices } from "@/application/services";

type Context = { params: Promise<{ routineId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { routineId } = await params;
  const routine = await getEntityServices().routines.get(user.email, routineId);
  return routine ? Response.json({ routine }) : Response.json({ error: "Routine not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const { routineId } = await params;
    const payload = await request.json();
    const routine = Array.isArray(payload?.exercises) && payload.exercises.some((exercise: Record<string, unknown>) => "regularSets" in exercise)
      ? await updateRoutine(user.email, routineId, payload)
      : await getEntityServices().routines.updateIdentity(user.email, routineId, payload);
    if (!routine) return Response.json({ error: "Routine not found." }, { status: 404 });
    return Response.json({ routine });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The routine could not be saved." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { routineId } = await params;
  const routine = await getEntityServices().routines.archive(user.email, routineId);
  return routine ? Response.json({ archived: true, routine }) : Response.json({ error: "Routine not found." }, { status: 404 });
}
