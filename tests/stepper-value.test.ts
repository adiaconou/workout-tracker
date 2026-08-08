import assert from "node:assert/strict";
import test from "node:test";
import { stepNumericText } from "../src/client/ui/stepper-value";

test("steps whole-number rep values up and down by one", () => {
  assert.equal(stepNumericText("8", 1), "9");
  assert.equal(stepNumericText("8", -1), "7");
});

test("preserves fractional weight values while stepping by one", () => {
  assert.equal(stepNumericText("22.5", 1), "23.5");
  assert.equal(stepNumericText("22.5", -1), "21.5");
});

test("uses zero for an empty value and never steps below the minimum", () => {
  assert.equal(stepNumericText("", 1), "1");
  assert.equal(stepNumericText("", -1), "0");
  assert.equal(stepNumericText("0", -1), "0");
});
