import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("replaces the starter with the workout tracker product", async () => {
  const [layout, page, auth, routines, routineLayout, appHeader, installButton, detail, exerciseLibraryPage, exerciseLibrary, exerciseDetail, activeWorkout, workoutApi, store, recommendations, manifest, serviceWorker, hosting] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/chatgpt-auth.ts", root), "utf8"),
    readFile(new URL("app/routines/page.tsx", root), "utf8"),
    readFile(new URL("app/routines/layout.tsx", root), "utf8"),
    readFile(new URL("app/app-header.tsx", root), "utf8"),
    readFile(new URL("app/routines/install-app-button.tsx", root), "utf8"),
    readFile(new URL("app/routines/[routineId]/routine-editor.tsx", root), "utf8"),
    readFile(new URL("app/exercises/page.tsx", root), "utf8"),
    readFile(new URL("app/exercises/exercise-library.tsx", root), "utf8"),
    readFile(new URL("app/exercises/[exerciseId]/page.tsx", root), "utf8"),
    readFile(new URL("app/workouts/[sessionId]/active-workout.tsx", root), "utf8"),
    readFile(new URL("app/api/workouts/route.ts", root), "utf8"),
    readFile(new URL("lib/store.ts", root), "utf8"),
    readFile(new URL("lib/recommendations.ts", root), "utf8"),
    readFile(new URL("public/manifest.webmanifest", root), "utf8"),
    readFile(new URL("public/sw.js", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(layout, /Workout Tracker/);
  assert.match(layout, /mobile-web-app-capable/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project|_sites-preview/);
  assert.match(page, /redirect\("\/routines"\)/);
  assert.match(auth, /isWorkoutOwnerEmail/);
  assert.match(auth, /OWNER_EMAIL/);
  assert.match(routines, /requireWorkoutUser/);
  assert.match(routines, /getRoutineRecommendations/);
  assert.match(routines, /Best today/);
  assert.match(workoutApi, /getWorkoutUser/);
  assert.match(routines, /A → B → C → D → repeat/);
  assert.match(routineLayout, /AppHeader/);
  assert.match(appHeader, /InstallAppButton/);
  assert.match(appHeader, /href="\/exercises"/);
  assert.match(installButton, /beforeinstallprompt/);
  assert.match(detail, /Start workout/);
  assert.match(detail, /Edit routine/);
  assert.match(detail, /Abandon and start Routine/);
  assert.match(detail, /requiresConfirmation/);
  assert.match(detail, /abandonActive/);
  assert.match(detail, /router\.push\(`\/workouts\/\$\{payload\.session\.id\}`\)/);
  assert.match(exerciseLibraryPage, /Exercise Library/);
  assert.match(exerciseLibraryPage, /getEntityServices\(\)\.exercises\.list/);
  assert.match(exerciseLibrary, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
  assert.match(exerciseLibrary, /matchesQuery/);
  assert.match(exerciseLibrary, /encodeURIComponent\(exercise\.id\)/);
  assert.match(exerciseLibrary, /exercise-library-row/);
  assert.match(exerciseDetail, /services\.exercises\.get/);
  assert.match(exerciseDetail, /Used in routines/);
  assert.match(exerciseDetail, /Muscle groups/);
  assert.match(activeWorkout, /Complete set/);
  assert.match(activeWorkout, /Skip this set/);
  assert.match(activeWorkout, /Skip rest/);
  assert.match(activeWorkout, /Overall workout progress/);
  assert.match(store, /set_performances/);
  assert.match(store, /rest_ends_at/);
  assert.match(store, /status = 'Abandoned'/);
  assert.match(store, /requiresConfirmation: true/);
  assert.match(store, /sp\.performed_at >= \?/);
  assert.match(recommendations, /completedSets\.filter/);
  assert.match(recommendations, /72/);
  assert.match(recommendations, /warmup/);
  assert.match(recommendations, /failure.*drop/);
  assert.match(recommendations, /Available with caution/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(serviceWorker, /\/offline\.html/);
  assert.doesNotMatch(serviceWorker, /\/api\/workouts/);
  assert.match(hosting, /"d1": "DB"/);
});
