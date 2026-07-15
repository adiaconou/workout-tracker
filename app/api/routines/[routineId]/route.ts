import { getChatGPTUser } from "../../../chatgpt-auth";
import { updateRoutine } from "../../../../lib/store";

export async function PATCH(request: Request, { params }: { params: Promise<{ routineId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const { routineId } = await params;
    const payload = await request.json();
    const routine = await updateRoutine(user.email, routineId, payload);
    if (!routine) return Response.json({ error: "Routine not found." }, { status: 404 });
    return Response.json({ routine });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The routine could not be saved." }, { status: 400 });
  }
}
