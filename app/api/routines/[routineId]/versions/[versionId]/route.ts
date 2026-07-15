import { getWorkoutUser } from "@/app/chatgpt-auth";
import { getEntityServices } from "@/application/services";

type Context = { params: Promise<{ routineId: string; versionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const { routineId, versionId } = await params;
  const version = await getEntityServices().routines.getVersion(user.email, routineId, versionId);
  return version ? Response.json({ version }) : Response.json({ error: "Routine version not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { routineId, versionId } = await params;
    const version = await getEntityServices().routines.updateVersion(user.email, routineId, versionId, await request.json());
    return version ? Response.json({ version }) : Response.json({ error: "Routine version not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Routine version could not be updated." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getWorkoutUser();
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const { routineId, versionId } = await params;
    const deleted = await getEntityServices().routines.deleteVersion(user.email, routineId, versionId);
    return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Routine version not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Routine version could not be deleted." }, { status: 400 });
  }
}

