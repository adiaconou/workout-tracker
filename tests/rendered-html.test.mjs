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
    history,
    historyDetail,
    activeWorkout,
    coach,
    discardWorkoutModal,
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
    readFile(new URL("src/features/history/history-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/history/workout-history-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/workouts/active-workout-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/coach/coach-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/workouts/discard-workout-modal.tsx", root), "utf8"),
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
  assert.match(tabs, /History/);
  assert.match(tabs, /Coach/);
  assert.match(tabs, /useSafeAreaInsets/);
  assert.match(tabs, /tabBarActiveBackgroundColor/);
  assert.match(tabs, /TabGlyph/);
  assert.match(tabs, /Math\.max\(insets\.bottom, 8\)/);
  assert.match(routines, /Recommended today/);
  assert.match(routines, /Why this recommendation/);
  assert.match(routines, /How availability works/);
  assert.match(routines, /accessibilityRole="progressbar"/);
  assert.doesNotMatch(routines, /A → B → C → D/);
  assert.doesNotMatch(routines, /Install the Android APK/);
  assert.match(routines, /Discard workout/);
  assert.match(routines, /DiscardWorkoutModal/);
  assert.match(routineDetail, /Start workout/);
  assert.match(routineDetail, /Edit routine/);
  assert.match(routineDetail, /Add exercise from library/);
  assert.match(routineDetail, /expandedExerciseIds/);
  assert.match(routineDetail, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(routineDetail, /expanded \? "Collapse" : "Expand"/);
  assert.ok(
    routineDetail.indexOf("<Heading size=\"small\">Add another exercise</Heading>") <
      routineDetail.indexOf("{(editing ? draft : routine).exercises.map"),
  );
  assert.match(routineDetail, /Move up/);
  assert.match(routineDetail, /Move down/);
  assert.match(routineDetail, /Remove/);
  assert.match(routineDetail, /\/api\/v1\/exercises/);
  assert.match(routineDetail, /Abandon and start Routine/);
  assert.match(exerciseLibrary, /onChangeText=\{setQuery\}/);
  assert.match(exerciseLibrary, /minHeight: 46/);
  assert.match(exerciseLibrary, /toggleFavorite/);
  assert.match(exerciseLibrary, /exerciseDetailHref\(item\.id\)/);
  assert.doesNotMatch(exerciseLibrary, /encodeURIComponent\(item\.id\)/);
  assert.match(exerciseLibrary, /isFavorite \? "★" : "☆"/);
  assert.match(exerciseDetail, /Used in routines/);
  assert.match(exerciseDetail, /toggleFavorite/);
  assert.match(exerciseDetail, /isFavorite \? "★" : "☆"/);
  assert.match(history, /Workout history/);
  assert.match(history, /Finished early/);
  assert.match(history, /Show more workouts/);
  assert.match(history, /Filter/);
  assert.match(historyDetail, /Workout review/);
  assert.match(historyDetail, /Previous:/);
  assert.match(historyDetail, /expandedExerciseIds/);
  assert.match(historyDetail, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(historyDetail, /Collapse.*Expand|Expand.*Collapse/);
  assert.match(historyDetail, /Save notes/);
  assert.match(historyDetail, /Repeat Routine/);
  assert.match(historyDetail, /Save changes/);
  assert.match(activeWorkout, /Complete set/);
  assert.match(activeWorkout, /Skip this set/);
  assert.match(activeWorkout, /Skip rest/);
  assert.match(activeWorkout, /StepperField/);
  assert.match(activeWorkout, /Last time/);
  assert.match(activeWorkout, /PreviousPerformance/);
  assert.match(activeWorkout, /View full workout/);
  assert.match(activeWorkout, /WorkoutProgressModal/);
  assert.match(activeWorkout, /sets logged/);
  assert.match(activeWorkout, /Built-in stopwatch/);
  assert.match(activeWorkout, /Finish workout early/);
  assert.match(activeWorkout, /\/complete/);
  assert.match(activeWorkout, /Discard workout/);
  assert.match(activeWorkout, /\/discard/);
  assert.match(activeWorkout, /removePendingSetWritesForWorkout/);
  assert.match(activeWorkout, /accessibilityRole="progressbar"/);
  assert.match(coach, /How can I help with your training/);
  assert.match(coach, /Message Coach/);
  assert.match(coach, /New chat/);
  assert.match(coach, /Choose coach model/);
  assert.match(coach, /Reasoning effort/);
  assert.match(coach, /\/api\/v1\/assistant\/models/);
  assert.match(coach, /Save draft/);
  assert.match(coach, /OPENAI_API_KEY/);
  assert.doesNotMatch(coach, /Coaching profile/);
  assert.doesNotMatch(coach, /Readiness check-in/);
  assert.match(discardWorkoutModal, /Discard this workout/);
  assert.match(discardWorkoutModal, /cannot\s+be undone/);
  assert.match(authContext, /SecureStore|session-storage/);
  assert.match(authContext, /google\/exchange/);
  assert.match(pendingWrites, /AsyncStorage/);
  assert.match(pendingWrites, /x-idempotency-key/);
  assert.match(pendingWrites, /removePendingSetWritesForWorkout/);
  assert.match(worker, /handleApiRequest/);
  assert.match(worker, /index\.html/);
  assert.match(buildScript, /expo/);
  assert.match(buildScript, /dist\/server\/index\.js/);
  assert.match(buildScript, /manifest\.webmanifest/);
  assert.match(hosting, /"d1": "DB"/);
});
