import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string; setId: string }> }) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { sessionId, setId } = await params;
    const workout = await getEntityServices().workouts.correctSet(user.email, sessionId, setId, await request.json());
    return workout ? Response.json({ workout }) : Response.json({ error: "Workout set not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Workout set could not be updated." }, { status: 400 });
  }
}
