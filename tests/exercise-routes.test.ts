import assert from "node:assert/strict";
import test from "node:test";
import { exerciseDetailHref, exerciseIdFromParam } from "../src/features/exercises/exercise-routes";

test("passes encoded catalog IDs to Expo Router as raw route parameters", () => {
  const exerciseId = "owner@example.com::home-gym::machine%20chest%20press";
  assert.deepEqual(exerciseDetailHref(exerciseId), {
    pathname: "/exercises/[exerciseId]",
    params: { exerciseId },
  });
});

test("normalizes exercise route parameters before loading the detail screen", () => {
  assert.equal(exerciseIdFromParam("exercise-1"), "exercise-1");
  assert.equal(exerciseIdFromParam(["exercise-1", "ignored"]), "exercise-1");
  assert.equal(exerciseIdFromParam(undefined), "");
});
