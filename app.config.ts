import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Workout Tracker",
  slug: "workout-tracker",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "workouttracker",
  newArchEnabled: true,
  platforms: ["android", "web"],
  icon: "./public/icons/icon-512.png",
  experiments: {
    typedRoutes: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-dev-client",
    [
      "react-native-nitro-google-signin",
      {
        iosUrlScheme: "com.googleusercontent.apps.workout-tracker-placeholder",
      },
    ],
  ],
  android: {
    package: "com.adiaconou.workouttracker",
    adaptiveIcon: {
      foregroundImage: "./public/icons/icon-maskable-512.png",
      backgroundColor: "#090d14",
    },
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./public/icons/icon-192.png",
    name: "Workout Tracker",
    shortName: "Workout",
    lang: "en",
    themeColor: "#090d14",
    backgroundColor: "#090d14",
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  },
};

export default config;
