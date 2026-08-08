import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workout read path exposes recorded set performance keyed by prescribed set", () => {
  const source = readFileSync(new URL("../lib/store.ts", import.meta.url), "utf8");
  assert.match(source, /recordedPerformanceBySetId/);
  assert.match(source, /prescribed_set_id AS prescribedSetId/);
  assert.match(source, /actual_duration_sec AS actualDurationSec/);
  assert.match(source, /status IN \('Completed', 'Skipped'\)/);
});
