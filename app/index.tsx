import { Redirect } from "expo-router";
import { useAuth } from "../src/auth/auth-context";

export default function IndexRoute() {
  const { user } = useAuth();
  return (
    <Redirect
      href={user?.trainingProfile.onboardingCompleted ? "/routines" : "/onboarding"}
    />
  );
}
