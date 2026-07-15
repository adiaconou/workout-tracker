import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { sessionId } = await params;
  const workout = await getEntityServices().workouts.get(user.email, sessionId);
  return workout ? Response.json({ workout }) : Response.json({ error: "Workout not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { sessionId } = await params;
    const workout = await getEntityServices().workouts.update(user.email, sessionId, await request.json());
    return workout ? Response.json({ workout }) : Response.json({ error: "Workout not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Workout could not be updated." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { sessionId } = await params;
  const archived = await getEntityServices().workouts.archive(user.email, sessionId);
  return archived ? Response.json({ archived: true }) : Response.json({ error: "Workout not found." }, { status: 404 });
}

