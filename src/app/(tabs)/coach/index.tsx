import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useCoachOverlay } from "../../../client/coach/coach-overlay-host";
import { LoadingView } from "../../../client/ui/ui";

export default function CoachRoute() {
  const { starter } = useLocalSearchParams<{ starter?: string }>();
  const { openCoach } = useCoachOverlay();

  useEffect(() => {
    openCoach({ fullScreen: true, starter });
    if (starter === "routine-design" || !router.canGoBack()) {
      router.replace("/routines");
    } else {
      router.back();
    }
  }, [openCoach, starter]);

  return <LoadingView label="Opening Coach." />;
}
