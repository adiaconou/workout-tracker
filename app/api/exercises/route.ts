import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

export async function GET(request: Request) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const url = new URL(request.url);
  const exercises = await getEntityServices().exercises.list(user.email, {
    includeArchived: url.searchParams.get("includeArchived") === "true",
    search: url.searchParams.get("search") ?? undefined,
  });
  return Response.json({ exercises });
}

export async function POST(request: Request) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const exercise = await getEntityServices().exercises.create(user.email, await request.json());
    return Response.json({ exercise }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Exercise could not be created." }, { status: 400 });
  }
}

