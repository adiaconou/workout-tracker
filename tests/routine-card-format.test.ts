import assert from "node:assert/strict";
import test from "node:test";
import type { RoutineRecommendation } from "../src/domain/recommendations";
import {
  routineAvailabilityKind,
  routineDurationLabel,
  routineLastDoneLabel,
  routineMuscleTitle,
  sortRoutinesByLastDone,
} from "../src/client/routines/routine-card-format";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function guidance(
  overrides: Partial<RoutineRecommendation> = {},
): RoutineRecommendation {
  return {
    code: "A",
    availability: "available",
    availabilityLabel: "Lower logged overlap",
    availabilityReason: "Reason",
    equipmentCompatible: true,
    missingEquipment: [],
    goalReason: "Goal",
    isRecommended: false,
    isNextInSequence: false,
    ...overrides,
  };
}

test("shows a compact calendar date and whole calendar days since completion", () => {
  assert.equal(
    routineLastDoneLabel("2026-08-06T23:30:00.000Z", {
      now: NOW,
      timeZone: "UTC",
    }),
    "08/06/26 · 2 days ago",
  );
  assert.equal(
    routineLastDoneLabel("2026-08-08T08:00:00.000Z", {
      now: NOW,
      timeZone: "America/Los_Angeles",
    }),
    "08/08/26 · 0 days ago",
  );
  assert.equal(
    routineLastDoneLabel("2026-08-07T23:30:00.000Z", {
      now: NOW,
      timeZone: "America/Los_Angeles",
    }),
    "08/07/26 · 1 day ago",
  );
  assert.equal(
    routineLastDoneLabel("2026-08-09T12:00:00.000Z", { now: NOW, timeZone: "UTC" }),
    "08/09/26 · 0 days ago",
  );
});

test("uses clear placeholders for missing and invalid completion dates", () => {
  assert.equal(routineLastDoneLabel(null, { now: NOW }), "--/--/-- · Never");
  assert.equal(routineLastDoneLabel("not-a-date", { now: NOW }), "--/--/-- · Unknown");
});

test("shows actual average duration with its sample count and falls back to the estimate", () => {
  assert.equal(routineDurationLabel(3_121, 1, 60), "Avg 52 min");
  assert.equal(routineDurationLabel(3_121, 6, 60), "Avg 52 min");
  assert.equal(routineDurationLabel(null, 0, 60), "Est. 60 min");
});

test("uses canonical muscle-only titles and safe muscle-only fallbacks", () => {
  assert.equal(
    routineMuscleTitle(
      "Pull-up and pressing strength",
      "Balanced chest and back volume, plus core and triceps.",
    ),
    "Back, chest, arms & core",
  );
  assert.equal(
    routineMuscleTitle(
      "Pull-up volume and upper-body muscle",
      "Shoulders, upper chest, back, arms, and abs.",
    ),
    "Back, chest, shoulders & arms",
  );
  assert.equal(routineMuscleTitle("Dumbbell leg strength and core"), "Legs & core");
  assert.equal(routineMuscleTitle("Pull-up density, back, arms, and core"), "Back, arms & core");
  assert.equal(routineMuscleTitle("Legs, back, chest and core"), "Back, chest, legs & core");
  assert.equal(routineMuscleTitle("Leg press strength"), "Legs");
  assert.equal(
    routineMuscleTitle("Shoulder, hamstring, forearm, chest and core work"),
    "Chest, shoulders, legs & core",
  );
  assert.equal(routineMuscleTitle("Conditioning"), "Muscle groups not set");
  assert.ok(routineMuscleTitle("Back chest shoulders arms legs core").length <= 30);
});

test("sorts by most recent completion without mutating input and keeps never-done ties stable", () => {
  const routines = [
    { code: "never", lastWorkoutAt: null },
    { code: "older", lastWorkoutAt: "2026-08-01T12:00:00.000Z" },
    { code: "invalid", lastWorkoutAt: "not-a-date" },
    { code: "newer", lastWorkoutAt: "2026-08-07T12:00:00.000Z" },
  ];
  assert.deepEqual(
    sortRoutinesByLastDone(routines).map(({ code }) => code),
    ["newer", "older", "never", "invalid"],
  );
  assert.deepEqual(routines.map(({ code }) => code), ["never", "older", "invalid", "newer"]);
});

test("reduces recommendation guidance to the icon states shown in the routines list", () => {
  assert.equal(routineAvailabilityKind(undefined), "not_assessed");
  assert.equal(routineAvailabilityKind(guidance({ equipmentCompatible: false })), "equipment");
  assert.equal(routineAvailabilityKind(guidance({ isRecommended: true })), "recommended");
  assert.equal(
    routineAvailabilityKind(guidance({ availability: "caution", isRecommended: true })),
    "recommended_caution",
  );
  assert.equal(
    routineAvailabilityKind(guidance({ availability: "recovering", isRecommended: true })),
    "recovery",
  );
  assert.equal(routineAvailabilityKind(guidance({ availability: "caution" })), "caution");
  assert.equal(routineAvailabilityKind(guidance()), "available");
});
