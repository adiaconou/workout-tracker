import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { getRoutine } from "../../../lib/store";
import { RoutineEditor } from "./routine-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ routineId: string }> }): Promise<Metadata> {
  const { routineId } = await params;
  return { title: `Routine ${routineId.toUpperCase()}` };
}

export default async function RoutineDetailPage({ params }: { params: Promise<{ routineId: string }> }) {
  const { routineId } = await params;
  const code = routineId.toUpperCase();
  const user = await requireChatGPTUser(`/routines/${code}`);
  const routine = await getRoutine(user.email, code);
  if (!routine) notFound();

  return (
    <main className="page routine-detail-page">
      <Link className="back-link" href="/routines">← All routines</Link>
      <RoutineEditor initialRoutine={routine} />
    </main>
  );
}
