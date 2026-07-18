import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/auth-context";
import { LoadingView } from "../src/components/ui";
import { colors } from "../src/theme/tokens";

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
          <StatusBar style="light" />
          <AuthenticatedNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AuthenticatedNavigator() {
  const { isLoading, user } = useAuth();
  if (isLoading) return <LoadingView label="Opening Workout Tracker…" />;

  return (
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
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="routines/[routineId]" />
        <Stack.Screen name="exercises/[exerciseId]" />
        <Stack.Screen name="history/[workoutId]" />
        <Stack.Screen name="workouts/[sessionId]" options={{ gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}
