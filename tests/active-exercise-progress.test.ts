import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLineChartGeometry,
  progressTrend,
} from "../src/features/workouts/active-exercise-progress";

test("classifies empty, one-point, equal, rising, and falling progress", () => {
  assert.equal(progressTrend([]), "empty");
  assert.equal(progressTrend([100]), "one");
  assert.equal(progressTrend([100, 100]), "equal");
  assert.equal(progressTrend([100, 110]), "up");
  assert.equal(progressTrend([110, 100]), "down");
});

test("lays out a true line with a centered one-point baseline", () => {
  const single = buildLineChartGeometry([100], 200, 80);
  assert.equal(single.length, 1);
  assert.equal(single[0]!.x, 100);
  assert.equal(single[0]!.y, 40);

  const rising = buildLineChartGeometry([100, 110, 120], 200, 80);
  assert.ok(rising[0]!.x < rising[1]!.x && rising[1]!.x < rising[2]!.x);
  assert.ok(rising[0]!.y > rising[1]!.y && rising[1]!.y > rising[2]!.y);

  const equal = buildLineChartGeometry([100, 100, 100], 200, 80);
  assert.equal(new Set(equal.map((point) => point.y)).size, 1);
});

test("spaces points by workout time when valid timestamps are available", () => {
  const day = 24 * 60 * 60 * 1000;
  const points = buildLineChartGeometry(
    [100, 105, 110],
    216,
    80,
    8,
    10,
    [0, day, day * 10],
  );

  assert.ok(points[1]!.x - points[0]!.x < points[2]!.x - points[1]!.x);
  assert.equal(points[0]!.x, 8);
  assert.equal(points[2]!.x, 208);
});
