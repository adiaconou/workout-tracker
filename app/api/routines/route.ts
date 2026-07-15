import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

export async function GET(request: Request) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
  return Response.json({ routines: await getEntityServices().routines.list(user.email, includeArchived) });
}

export async function POST(request: Request) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const payload = await request.json() as { code?: string; version?: unknown };
    if (!payload.code || !payload.version) return Response.json({ error: "Routine code and version are required." }, { status: 400 });
    const routine = await getEntityServices().routines.create(user.email, payload.code, payload.version as never);
    return Response.json({ routine }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Routine could not be created." }, { status: 400 });
  }
}

