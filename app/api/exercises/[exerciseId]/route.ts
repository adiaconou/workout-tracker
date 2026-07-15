import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

type Context = { params: Promise<{ exerciseId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { exerciseId } = await params;
  const exercise = await getEntityServices().exercises.get(user.email, exerciseId);
  return exercise ? Response.json({ exercise }) : Response.json({ error: "Exercise not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { exerciseId } = await params;
    const exercise = await getEntityServices().exercises.update(user.email, exerciseId, await request.json());
    return exercise ? Response.json({ exercise }) : Response.json({ error: "Exercise not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Exercise could not be updated." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { exerciseId } = await params;
  const archived = await getEntityServices().exercises.archive(user.email, exerciseId);
  return archived ? Response.json({ archived: true }) : Response.json({ error: "Exercise not found." }, { status: 404 });
}

