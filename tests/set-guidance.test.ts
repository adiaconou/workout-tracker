import assert from "node:assert/strict";
import test from "node:test";
import { buildCompactSetDetails } from "../src/client/workouts/set-guidance";

test("removes the duplicate guidance shown by normalized workout fallbacks", () => {
  const details = buildCompactSetDetails({
    primaryValues: ["1 light set × 10", "90 sec"],
    details: [
      { id: "effort", label: "Effort", value: "Fast, crisp reps" },
      { id: "load", label: "Load", value: "1 light set × 10" },
      { id: "instructions", label: "Cue", value: "Fast, crisp reps" },
      { id: "purpose", label: "Why", value: "Trains explosive hip extension" },
      { id: "set-notes", label: "Set note", value: "Trains explosive hip extension" },
      { id: "exercise-notes", label: "Notes", value: "Trains explosive hip extension" },
    ],
  });

  assert.deepEqual(details, [
    { id: "effort", label: "Effort", value: "Fast, crisp reps" },
    { id: "purpose", label: "Why", value: "Trains explosive hip extension" },
  ]);
});

test("deduplicates case and whitespace variants and omits blank details", () => {
  const details = buildCompactSetDetails({
    primaryValues: ["10 reps", "60 sec"],
    details: [
      { id: "load", label: "Load", value: "  10 REPS. " },
      { id: "effort", label: "Effort", value: "Controlled reps" },
      { id: "instructions", label: "Cue", value: " controlled   REPS. " },
      { id: "notes", label: "Notes", value: "   " },
    ],
  });

  assert.deepEqual(details, [
    { id: "effort", label: "Effort", value: "Controlled reps" },
  ]);
});

test("retains every genuinely unique detail in its original order", () => {
  const details = buildCompactSetDetails({
    primaryValues: ["8 reps", "2 min"],
    details: [
      { id: "effort", label: "Effort", value: "2 RIR" },
      { id: "load", label: "Load", value: "Use the blue band" },
      { id: "sides", label: "Sides", value: "Per side" },
      { id: "tempo", label: "Tempo", value: "3-1-1" },
      { id: "instructions", label: "Cue", value: "Pause at the bottom" },
      { id: "purpose", label: "Why", value: "Build control" },
      { id: "notes", label: "Notes", value: "Keep the ribs down" },
    ],
  });

  assert.deepEqual(
    details.map((detail) => detail.id),
    ["effort", "load", "sides", "tempo", "instructions", "purpose", "notes"],
  );
});

test("does not hide similar but distinct coaching cues", () => {
  const details = buildCompactSetDetails({
    primaryValues: ["8 reps"],
    details: [
      { id: "first", label: "Cue", value: "Pause at the bottom" },
      { id: "second", label: "Set note", value: "Pause near the bottom" },
    ],
  });

  assert.equal(details.length, 2);
});
