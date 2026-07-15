import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

type Context = { params: Promise<{ routineId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { routineId } = await params;
  return Response.json({ versions: await getEntityServices().routines.listVersions(user.email, routineId) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { routineId } = await params;
    const version = await getEntityServices().routines.createVersion(user.email, routineId, await request.json());
    return Response.json({ version }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Routine version could not be created." }, { status: 400 });
  }
}

