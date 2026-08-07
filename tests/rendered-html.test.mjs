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
    routineCardFormat,
    routineDetail,
    exerciseLibrary,
    exerciseDetail,
    history,
    historyDetail,
    activeWorkout,
    coach,
    coachMarkdown,
    discardWorkoutModal,
    accountMenu,
    authContext,
    serverAuth,
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
    readFile(new URL("src/features/routines/routine-card-format.ts", root), "utf8"),
    readFile(new URL("src/features/routines/routine-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/exercises/exercise-library-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/exercises/exercise-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/history/history-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/history/workout-history-detail-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/workouts/active-workout-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/coach/coach-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/coach/coach-markdown.tsx", root), "utf8"),
    readFile(new URL("src/features/workouts/discard-workout-modal.tsx", root), "utf8"),
    readFile(new URL("src/components/account-menu.tsx", root), "utf8"),
    readFile(new URL("src/auth/auth-context.tsx", root), "utf8"),
    readFile(new URL("server/auth.ts", root), "utf8"),
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
  assert.match(rootLayout, /header: \(\) => <AccountHeader/);
  assert.match(rootLayout, /name="routines\/\[routineId\]" options=\{accountHeaderOptions\}/);
  assert.match(rootLayout, /name="exercises\/\[exerciseId\]" options=\{accountHeaderOptions\}/);
  assert.match(rootLayout, /name="history\/\[workoutId\]" options=\{accountHeaderOptions\}/);
  assert.doesNotMatch(tabs, /AccountHeader/);
  assert.match(accountMenu, /Account menu for/);
  assert.match(accountMenu, /ProfileAvatar/);
  assert.match(accountMenu, /Sign out/);
  assert.match(accountMenu, /accessibilityViewIsModal/);
  assert.match(routines, /<Heading>Routines<\/Heading>/);
  assert.doesNotMatch(routines, /Choose a session, review recovery/);
  assert.doesNotMatch(routines, /<Heading size="small">Your routines<\/Heading>/);
  assert.doesNotMatch(routines, /accessibilityLabel="Sign out"/);
  assert.match(routines, /tableHeader/);
  assert.match(routines, /compactLayout/);
  assert.match(routines, /styles\.planCell/);
  assert.doesNotMatch(routines, /<Heading>Today<\/Heading>|todayCard/);
  assert.match(routines, /Recommended today/);
  assert.match(routines, /recommendedRoutineRow/);
  assert.match(routines, /Why Routine/);
  assert.match(routines, /routine\.durationMin/);
  assert.match(routines, /routineLastDoneLabel\(routine\.lastWorkoutAt, \{ now: renderedAt \}\)/);
  assert.match(routineCardFormat, /Last done/);
  assert.match(routineCardFormat, /Not done yet/);
  assert.match(routineCardFormat, /plural\(days, "day"\)/);
  assert.match(routineCardFormat, /plural\(hours, "hour"\)/);
  assert.match(routines, /guidance\.availabilityLabel/);
  assert.match(routines, /<AvailabilityLabel/);
  assert.match(routines, /!routine\.lastWorkoutAt && styles\.routineStatusLineWithoutHistory/);
  assert.match(routines, /routineStatusLineWithoutHistory: \{ flexDirection: "column"/);
  assert.match(routines, /How availability works/);
  assert.match(routines, /do\s+not measure soreness, pain, sleep, stress, injury, warm-up performance/);
  assert.match(routines, /No routines yet/);
  assert.match(routines, /temporarily unavailable/);
  assert.match(routines, /AppState\.addEventListener\("change"/);
  assert.match(routines, /window\.addEventListener\("focus"/);
  assert.match(routines, /document\.addEventListener\("visibilitychange"/);
  assert.match(routines, /latestRequest/);
  assert.match(routines, /setData\(next\);\s*setError\(""\);/);
  assert.match(routines, /focusedAction === "resume"[\s\S]*styles\.webFocusRing/);
  assert.match(routines, /focusedAction === "availability-help"[\s\S]*styles\.webFocusRing/);
  assert.match(routines, /recommendedBadgeText:[\s\S]*fontSize: 8/);
  assert.match(routines, /routineRow: \{[\s\S]*minHeight: 54/);
  assert.match(routines, /accessibilityRole="progressbar"/);
  assert.doesNotMatch(routines, /A → B → C → D/);
  assert.doesNotMatch(routines, /Install the Android APK/);
  assert.match(routines, /Discard workout/);
  assert.match(routines, /DiscardWorkoutModal/);
  const routineListStart = routines.indexOf("{data.routines.map");
  const routineListEnd = routines.indexOf("<Eyebrow>Start your program</Eyebrow>", routineListStart);
  assert.ok(routineListStart >= 0 && routineListEnd > routineListStart);
  const routineList = routines.slice(routineListStart, routineListEnd);
  assert.match(routineList, /AvailabilityLabel/);
  assert.match(routineList, /guidance\.availabilityLabel/);
  assert.doesNotMatch(routineList, /availabilityReason/);
  assert.match(routineDetail, /Start workout/);
  assert.match(routineDetail, /Edit routine/);
  assert.match(routineDetail, /Add exercise from library/);
  assert.match(routineDetail, /expandedExerciseIds/);
  assert.match(routineDetail, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(routineDetail, /expanded \? "Collapse" : "Expand"/);
  assert.ok(
    routineDetail.indexOf("<Heading size=\"small\">Add exercise</Heading>") <
      routineDetail.indexOf("{visibleExercises.map"),
  );
  assert.match(routineDetail, /title="Move up" accessibilityLabel=\{`Move \$\{exerciseName\} up`\}/);
  assert.match(routineDetail, /title="Move down" accessibilityLabel=\{`Move \$\{exerciseName\} down`\}/);
  assert.match(routineDetail, /title="Remove" accessibilityLabel=\{`Remove \$\{exerciseName\}`\}/);
  assert.match(routineDetail, /useFocusEffect/);
  assert.match(routineDetail, /AppState\.addEventListener\("change"/);
  assert.match(routineDetail, /window\.addEventListener\("focus"/);
  assert.match(routineDetail, /document\.addEventListener\("visibilitychange"/);
  assert.match(routineDetail, /window\.addEventListener\("beforeunload"/);
  assert.match(routineDetail, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(routineDetail, /state\.editing && state\.dirty/);
  assert.match(routineDetail, /Discard edits and reload latest/);
  assert.match(routineDetail, /void load\(true\)/);
  assert.match(routineDetail, /editable=\{!saving\}/);
  assert.match(routineDetail, /disabled=\{saving\}.*ChoiceField|ChoiceField[^\n]*disabled=\{saving\}/);
  assert.match(routineDetail, /accessibilityRole="radiogroup"/);
  assert.match(routineDetail, /accessibilityViewIsModal/);
  assert.match(routineDetail, /NullableNumberField/);
  assert.match(routineDetail, /setText\(nextText\)[\s\S]*Number\(nextText\)/);
  assert.match(routineDetail, /latestRequest\.current \+= 1/);
  assert.match(routineDetail, /expectedRoutineVersionId: startRoutine\.currentVersionId/);
  assert.match(routineDetail, /focusedControl === `exercise:/);
  assert.match(routineDetail, /focusedExerciseId === exercise\.id/);
  assert.match(routineDetail, /libraryDialog: \{[^}]*flexShrink: 1/);
  assert.match(routineDetail, /libraryList: \{[^}]*flexShrink: 1/);
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
  assert.match(coach, /Apply & publish/);
  assert.match(coach, /Save as draft/);
  assert.match(coach, /exerciseApplyLabel/);
  assert.match(coach, /plan\.kind === "routine"/);
  assert.match(coach, /plan\.kind === "exercise"/);
  assert.match(coach, /plan\.diff\.map/);
  assert.doesNotMatch(coach, /plan\.diff\.slice\(0, 4\)/);
  assert.match(coach, /Nothing changes until you choose an action/);
  assert.match(coach, /Only the action buttons make changes/);
  assert.match(coach, /catch \(caught\) \{\s+const message = caught.*await load\(data\.thread\.id\);\s+setError\(message\);/s);
  assert.match(coach, /title="Dismiss"/);
  assert.match(coach, /\/plans\/\$\{encodeURIComponent\(planId\)\}\/\$\{action\}/);
  assert.match(coach, /OPENAI_API_KEY/);
  assert.match(coach, /<CoachMarkdown content=\{message\.content\} \/>/);
  assert.match(coachMarkdown, /EnrichedMarkdownText/);
  assert.match(coachMarkdown, /flavor="github"/);
  assert.match(coachMarkdown, /md4cFlags=\{\{ latexMath: false \}\}/);
  assert.match(coachMarkdown, /isSafeCoachMarkdownLink/);
  assert.match(coachMarkdown, /sanitizeCoachMarkdown\(content\)/);
  assert.match(coachMarkdown, /onAuxClickCapture/);
  assert.match(coachMarkdown, /onContextMenuCapture/);
  assert.match(packageJson, /"react-native-enriched-markdown": "0\.7\.4"/);
  assert.match(appConfig, /"react-native-enriched-markdown"/);
  assert.match(appConfig, /enableMath: false/);
  assert.doesNotMatch(coach, /Coaching profile/);
  assert.doesNotMatch(coach, /Readiness check-in/);
  assert.match(discardWorkoutModal, /Discard this workout/);
  assert.match(discardWorkoutModal, /cannot\s+be undone/);
  assert.match(authContext, /SecureStore|session-storage/);
  assert.match(authContext, /google\/exchange/);
  assert.match(serverAuth, /claims\.picture/);
  assert.match(serverAuth, /photo_url AS photoUrl/);
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
