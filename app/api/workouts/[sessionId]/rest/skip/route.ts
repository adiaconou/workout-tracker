import { getChatGPTUser } from "@/app/chatgpt-auth";
import { skipWorkoutRest } from "@/lib/store";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { sessionId } = await params;
    const result = await skipWorkoutRest(user.email, sessionId);
    if (!result) return Response.json({ error: "Workout not found." }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rest could not be skipped." }, { status: 400 });
  }
}
