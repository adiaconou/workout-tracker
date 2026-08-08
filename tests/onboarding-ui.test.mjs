import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("routes incomplete users through accessible training setup", async () => {
  const [layout, index, onboarding, auth, accountMenu, exercises, coach] = await Promise.all([
    readFile(new URL("app/_layout.tsx", root), "utf8"),
    readFile(new URL("app/index.tsx", root), "utf8"),
    readFile(new URL("src/features/onboarding/onboarding-screen.tsx", root), "utf8"),
    readFile(new URL("src/auth/auth-context.tsx", root), "utf8"),
    readFile(new URL("src/components/account-menu.tsx", root), "utf8"),
    readFile(new URL("src/features/exercises/exercise-library-screen.tsx", root), "utf8"),
    readFile(new URL("src/features/coach/coach-screen.tsx", root), "utf8"),
  ]);

  assert.match(layout, /name="onboarding" options=\{accountHeaderOptions\}/);
  assert.match(layout, /user\?\.trainingProfile\.onboardingCompleted/);
  assert.match(index, /onboardingCompleted \? "\/routines" : "\/onboarding"/);

  assert.match(auth, /completeTrainingSetup/);
  assert.match(auth, /"\/api\/v1\/onboarding"/);
  assert.match(onboarding, /accessibilityRole="checkbox"/);
  assert.match(onboarding, /accessibilityState=\{\{ checked \}\}/);
  assert.match(onboarding, /role="radiogroup"/);
  assert.match(onboarding, /accessibilityRole="radio"/);
  assert.match(onboarding, /\[30, 45, 60, 75, 90\]/);
  assert.match(onboarding, /focused exercise library/);
  assert.match(onboarding, /Coach can design custom routines/);
  assert.match(onboarding, /Nothing is created or changed until you approve a review card/);
  assert.match(onboarding, /Save and meet Coach/);
  assert.match(onboarding, /router\.canGoBack\(\)/);
  for (const equipmentId of [
    "bodyweight",
    "dumbbells",
    "bench",
    "barbell",
    "kettlebells",
    "pull_up_station",
    "dip_station",
    "cable_machine",
    "ez_bar",
    "resistance_bands",
  ]) {
    assert.match(onboarding, new RegExp(`id: "${equipmentId}"`));
  }

  assert.match(accountMenu, /Training setup/);
  assert.match(exercises, /Equipment settings/);
  assert.match(coach, /starter !== "routine-design"/);
  assert.match(coach, /Build routines using the equipment and workout length I just selected/);
});
