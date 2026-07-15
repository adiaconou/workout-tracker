import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

export async function POST(_request: Request, { params }: { params: Promise<{ routineId: string; versionId: string }> }) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { routineId, versionId } = await params;
  const routine = await getEntityServices().routines.publish(user.email, routineId, versionId);
  return routine ? Response.json({ routine }) : Response.json({ error: "Routine version not found." }, { status: 404 });
}

