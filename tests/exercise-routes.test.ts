import assert from "node:assert/strict";
import test from "node:test";
import { resolveHref } from "expo-router/build/link/href.js";
import { exerciseDetailHref, exerciseIdFromParam } from "../src/features/exercises/exercise-routes";

function roundTripThroughExpo(exerciseId: string) {
  const href = resolveHref(exerciseDetailHref(exerciseId));
  const routeSegment = href.slice(href.lastIndexOf("/") + 1);
  const navigationParam = decodeURIComponent(routeSegment);
  const localSearchParam = decodeURIComponent(navigationParam);
  return {
    exerciseId: exerciseIdFromParam(localSearchParam),
    href,
  };
}

test("round-trips stored exercise IDs through Expo Router's two decode stages", () => {
  const exerciseIds = [
    "owner@example.com::home-gym::machine%20chest%20press",
    "owner@example.com::catalog::percent%25slash%2Funicode-%F0%9F%8F%8B%EF%B8%8F~%3F%23",
    "9f7241b7-3d6f-42f8-a9fd-7ab9fc097943",
  ];

  for (const exerciseId of exerciseIds) {
    const result = roundTripThroughExpo(exerciseId);
    assert.equal(result.exerciseId, exerciseId);
    assert.match(result.href, /^\/exercises\/v1\./u);
  }
});

test("normalizes exercise route parameters before loading the detail screen", () => {
  assert.equal(exerciseIdFromParam("exercise-1"), "exercise-1");
  assert.equal(exerciseIdFromParam(["exercise-1", "ignored"]), "exercise-1");
  assert.equal(exerciseIdFromParam("v1.invalid~escape~ZZ"), "");
  assert.equal(exerciseIdFromParam(undefined), "");
});
