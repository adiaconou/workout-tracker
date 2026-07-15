import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkoutUser } from "@/app/chatgpt-auth";
import { getWorkoutSession } from "@/lib/store";
import { ActiveWorkout } from "./active-workout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Active workout",
  description: "Log each set and follow the prescribed rest timer.",
};

export default async function ActiveWorkoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await requireWorkoutUser(`/workouts/${sessionId}`);
  const workout = await getWorkoutSession(user.email, sessionId);
  if (!workout) notFound();
  return <ActiveWorkout initialWorkout={workout} />;
}
