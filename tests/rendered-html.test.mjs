import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses one Expo Router application for Android and hosted web", async () => {
  const [
    packageJson,
    appConfig,
    rootLayout,
    tabs,
    routines,
    routineDetail,
    exerciseLibrary,
    exerciseDetail,
    activeWorkout,
    authContext,
    pendingWrites,
    worker,
    buildScript,
    hosting,
  ] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app.config.ts", root), "utf8"),
    readFile(new URL("app/_layout.tsx", root), "utf8"),
    readFile(new URL("app/(tabs)/_layout.tsx", root), "utf8"),
    readFile(new URL("src/features/routines/routines-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/routines/routine-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/exercises/exercise-library-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/exercises/exercise-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/workouts/active-workout-screen.tsx", root), "utf8"),
    readFile(new URL("src/auth/auth-context.tsx", root), "utf8"),
    readFile(new URL("src/api/pending-writes.ts", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("scripts/build-sites.mjs", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(packageJson, /expo-router\/entry/);
  assert.doesNotMatch(packageJson, /"next"|"vinext"/);
  assert.match(appConfig, /com\.adiaconou\.workouttracker/);
  assert.match(appConfig, /react-native-nitro-google-signin/);
  assert.match(rootLayout, /Stack\.Protected/);
  assert.match(rootLayout, /AuthProvider/);
  assert.match(rootLayout, /serviceWorker\.register/);
  assert.match(tabs, /Routines/);
  assert.match(tabs, /Exercises/);
  assert.match(routines, /Best today/);
  assert.match(routines, /A → B → C → D/);
  assert.match(routineDetail, /Start workout/);
  assert.match(routineDetail, /Edit routine/);
  assert.match(routineDetail, /Abandon and start Routine/);
  assert.match(exerciseLibrary, /onChangeText=\{setQuery\}/);
  assert.match(exerciseLibrary, /minHeight: 46/);
  assert.match(exerciseDetail, /Used in routines/);
  assert.match(activeWorkout, /Complete set/);
  assert.match(activeWorkout, /Skip this set/);
  assert.match(activeWorkout, /Skip rest/);
  assert.match(activeWorkout, /StepperField/);
  assert.match(activeWorkout, /Last time/);
  assert.match(activeWorkout, /PreviousPerformance/);
  assert.match(activeWorkout, /accessibilityRole="progressbar"/);
  assert.match(authContext, /SecureStore|session-storage/);
  assert.match(authContext, /google\/exchange/);
  assert.match(pendingWrites, /AsyncStorage/);
  assert.match(pendingWrites, /x-idempotency-key/);
  assert.match(worker, /handleApiRequest/);
  assert.match(worker, /index\.html/);
  assert.match(buildScript, /expo/);
  assert.match(buildScript, /dist\/server\/index\.js/);
  assert.match(buildScript, /manifest\.webmanifest/);
  assert.match(hosting, /"d1": "DB"/);
});
