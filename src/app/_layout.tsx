import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../client/auth/auth-context";
import { AccountHeader } from "../client/auth/account-menu";
import { LoadingView } from "../client/ui/ui";
import { colors } from "../client/ui/tokens";
import { ProfileProvider } from "../client/profile/profile-context";
import { CoachOverlayProvider } from "../client/coach/coach-overlay-host";

export default function RootLayout() {
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ProfileProvider>
            <StatusBar style="light" />
            <AuthenticatedNavigator />
          </ProfileProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AuthenticatedNavigator() {
  const { isLoading, user } = useAuth();
  if (isLoading) return <LoadingView label="Opening Workout Tracker…" />;

  const accountHeaderOptions = {
    headerShown: true,
    header: () => <AccountHeader />,
  };

  return (
    <CoachOverlayProvider
      enabled={Boolean(user?.trainingProfile.onboardingCompleted)}
      sessionKey={user?.id}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Protected guard={!user}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(user)}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={accountHeaderOptions} />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(user?.trainingProfile.onboardingCompleted)}>
          <Stack.Screen name="(tabs)" options={accountHeaderOptions} />
          <Stack.Screen name="routines/new" options={accountHeaderOptions} />
          <Stack.Screen name="routines/[routineId]" options={accountHeaderOptions} />
          <Stack.Screen name="exercises/new" options={accountHeaderOptions} />
          <Stack.Screen name="exercises/[exerciseId]" options={accountHeaderOptions} />
          <Stack.Screen name="history/[workoutId]" options={accountHeaderOptions} />
          <Stack.Screen name="profile" options={accountHeaderOptions} />
          <Stack.Screen name="workouts/[sessionId]" options={{ gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </CoachOverlayProvider>
  );
}
