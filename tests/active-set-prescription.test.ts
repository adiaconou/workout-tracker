import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSetPrescription,
  specialSetTypeLabel,
} from "../src/client/workouts/active-set-prescription";

type PrescriptionInput = Parameters<typeof activeSetPrescription>[0];

function prescription(overrides: Partial<PrescriptionInput> = {}): PrescriptionInput {
  return {
    effort: "",
    setType: "regular",
    sideMode: "bilateral",
    target: " 6–8 reps ",
    targetRirMax: null,
    targetRirMin: null,
    tempo: null,
    ...overrides,
  };
}

test("active set prescription shows structured RIR and trims the target", () => {
  assert.deepEqual(activeSetPrescription(prescription({
    targetRirMin: 2,
    targetRirMax: 2,
  })), {
    target: "6–8 reps",
    metadata: [{
      text: "RIR 2",
      accessibilityText: "2 repetitions in reserve",
    }],
    accessibilityLabel: "Target, 6–8 reps, 2 repetitions in reserve",
  });
  assert.deepEqual(activeSetPrescription(prescription({
    targetRirMin: 1,
    targetRirMax: 2,
  })).metadata[0], {
    text: "RIR 1–2",
    accessibilityText: "1 to 2 repetitions in reserve",
  });
  assert.equal(activeSetPrescription(prescription({
    targetRirMin: 0,
    targetRirMax: null,
  })).metadata[0]?.text, "RIR 0");
  assert.equal(activeSetPrescription(prescription({
    targetRirMin: null,
    targetRirMax: 3,
  })).metadata[0]?.text, "RIR 3");
});

test("structured RIR wins over legacy effort while legacy RIR remains visible", () => {
  assert.equal(activeSetPrescription(prescription({
    effort: "≈2 RIR",
    targetRirMin: 1,
    targetRirMax: 1,
  })).metadata[0]?.text, "RIR 1");
  assert.deepEqual(activeSetPrescription(prescription({ effort: "≈2 RIR" })).metadata[0], {
    text: "RIR ≈2",
    accessibilityText: "approximately 2 repetitions in reserve",
  });
  assert.equal(
    activeSetPrescription(prescription({ effort: "RIR 1-2" })).metadata[0]?.text,
    "RIR 1–2",
  );
  assert.equal(
    activeSetPrescription(prescription({ effort: "RIR: 2" })).metadata[0]?.text,
    "RIR 2",
  );
  assert.equal(
    activeSetPrescription(prescription({ effort: "Controlled reps" })).metadata.length,
    0,
  );
  assert.equal(activeSetPrescription(prescription({ effort: "No RIR" })).metadata.length, 0);
  assert.equal(
    activeSetPrescription(prescription({ effort: "2 RIR", setType: "warmup" })).metadata.length,
    0,
  );
  assert.equal(
    activeSetPrescription(prescription({ effort: "2 RIR", setType: "emom" })).metadata[0]?.text,
    "RIR 2",
  );
  assert.equal(activeSetPrescription(prescription({ effort: "RIR   " })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({ effort: "   RIR" })).metadata.length, 0);
});

test("side mode is added only when the target does not already explain it", () => {
  assert.equal(activeSetPrescription(prescription({ sideMode: "per_side" })).metadata[0]?.text, "Per side");
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_side",
    target: "8–12/side",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_side",
    target: "8–12 per side",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_side",
    target: "8–12 each side",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({ sideMode: "per_leg" })).metadata[0]?.text, "Per leg");
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_leg",
    target: "8–12/leg",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_leg",
    target: "8–12 per leg",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription({
    sideMode: "per_leg",
    target: "8–12 each leg",
  })).metadata.length, 0);
  assert.deepEqual(activeSetPrescription(prescription({ sideMode: "left_right" })).metadata[0], {
    text: "Left / right",
    accessibilityText: "Left and right",
  });
  assert.equal(activeSetPrescription(prescription({
    sideMode: "left_right",
    target: "8 left and 8 right",
  })).metadata.length, 0);
  assert.equal(activeSetPrescription(prescription()).metadata.length, 0);
});

test("tempo joins the compact metadata without repeating its label", () => {
  assert.equal(activeSetPrescription(prescription({ tempo: " 3-1-1 " })).metadata[0]?.text, "Tempo 3-1-1");
  assert.equal(activeSetPrescription(prescription({ tempo: "tempo 2-0-2" })).metadata[0]?.text, "Tempo 2-0-2");
  assert.equal(activeSetPrescription(prescription({ tempo: "   " })).metadata.length, 0);
  assert.deepEqual(activeSetPrescription(prescription({
    target: " ",
    targetRirMin: 2,
  })), {
    target: "",
    metadata: [{
      text: "RIR 2",
      accessibilityText: "2 repetitions in reserve",
    }],
    accessibilityLabel: "Target, 2 repetitions in reserve",
  });
});

test("only non-default set types receive a visible qualifier", () => {
  assert.equal(specialSetTypeLabel("regular"), null);
  assert.equal(specialSetTypeLabel("warmup"), "Warm-up");
  assert.equal(specialSetTypeLabel("failure"), "Failure");
  assert.equal(specialSetTypeLabel("drop"), "Drop");
  assert.equal(specialSetTypeLabel("emom"), "EMOM");
  assert.equal(specialSetTypeLabel("test"), "Test");
});
