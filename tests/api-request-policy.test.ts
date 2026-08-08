import assert from "node:assert/strict";
import test from "node:test";
import {
  authRequestOperation,
  googleExchangeInput,
  refreshTokenInput,
} from "../src/server/auth/request-policy";
import {
  exerciseListQuery,
  exerciseProgressQuery,
  exerciseRequestOperation,
} from "../src/server/exercises/request-policy";
import {
  routineCreationInput,
  routineEditorInput,
  routineListIncludesArchived,
  routineRequestOperation,
} from "../src/server/routines/request-policy";
import {
  apiPathSegments,
  apiRootRoute,
} from "../src/server/routing";
import {
  requestHasJsonBody,
  workoutListRequest,
  workoutRequestOperation,
  workoutStartInput,
} from "../src/server/workouts/request-policy";

test("parses API paths and classifies every root route", () => {
  assert.deepEqual(apiPathSegments("/api/v1/exercises/exercise%201//"), [
    "exercises",
    "exercise 1",
  ]);
  assert.deepEqual(apiPathSegments("/api/v1"), []);
  assert.deepEqual(apiPathSegments("/api/v1/"), []);
  assert.deepEqual(apiPathSegments("/outside"), ["outside"]);
  assert.throws(() => apiPathSegments("/api/v1/exercises/%E0%A4%A"), URIError);

  const cases: Array<[string[], ReturnType<typeof apiRootRoute>]> = [
    [["auth", "google", "exchange"], "google_exchange"],
    [["auth", "google", "other"], "auth"],
    [["auth", "refresh"], "refresh"],
    [["auth"], "auth"],
    [["onboarding"], "onboarding"],
    [["bootstrap"], "bootstrap"],
    [["exercises"], "exercises"],
    [["routines"], "routines"],
    [["workouts"], "workouts"],
    [["assistant"], "assistant"],
    [["unknown"], "not_found"],
    [[], "not_found"],
  ];
  for (const [segments, expected] of cases) {
    assert.equal(apiRootRoute(segments), expected);
  }
});

test("classifies authenticated profile, session, and logout operations", () => {
  const cases: Array<[string, string[], ReturnType<typeof authRequestOperation>]> = [
    ["GET", ["auth", "profile"], "profile_get"],
    ["PATCH", ["auth", "profile"], "profile_update"],
    ["POST", ["auth", "profile"], "profile_method_not_allowed"],
    ["GET", ["auth", "profile", "extra"], "not_found"],
    ["GET", ["auth", "session"], "session_get"],
    ["POST", ["auth", "session"], "not_found"],
    ["POST", ["auth", "logout"], "logout"],
    ["GET", ["auth", "logout"], "not_found"],
    ["GET", ["auth", "unknown"], "not_found"],
  ];
  for (const [method, segments, expected] of cases) {
    assert.equal(authRequestOperation(method, segments), expected);
  }
});

test("classifies every exercise operation without changing legacy detail routing", () => {
  assert.deepEqual(exerciseRequestOperation("GET", ["exercises"]), { kind: "list" });
  assert.deepEqual(exerciseRequestOperation("POST", ["exercises"]), { kind: "create" });
  assert.deepEqual(exerciseRequestOperation("PATCH", ["exercises"]), { kind: "method_not_allowed" });
  assert.deepEqual(exerciseRequestOperation("GET", ["exercises", "one", "progress"]), {
    kind: "progress",
    exerciseId: "one",
  });
  assert.deepEqual(exerciseRequestOperation("POST", ["exercises", "one", "progress"]), {
    kind: "method_not_allowed",
  });
  assert.deepEqual(exerciseRequestOperation("PUT", ["exercises", "one", "favorite"]), {
    kind: "favorite",
    exerciseId: "one",
    favorite: true,
  });
  assert.deepEqual(exerciseRequestOperation("DELETE", ["exercises", "one", "favorite"]), {
    kind: "favorite",
    exerciseId: "one",
    favorite: false,
  });
  assert.deepEqual(exerciseRequestOperation("GET", ["exercises", "one", "favorite"]), {
    kind: "method_not_allowed",
  });
  assert.deepEqual(exerciseRequestOperation("GET", ["exercises", "one"]), {
    kind: "get",
    exerciseId: "one",
  });
  assert.deepEqual(exerciseRequestOperation("PATCH", ["exercises", "one", "legacy-extra"]), {
    kind: "update",
    exerciseId: "one",
  });
  assert.deepEqual(exerciseRequestOperation("DELETE", ["exercises", "one"]), {
    kind: "archive",
    exerciseId: "one",
  });
  assert.deepEqual(exerciseRequestOperation("POST", ["exercises", "one"]), {
    kind: "method_not_allowed",
  });
});

test("parses exercise list and progress queries exactly", () => {
  assert.deepEqual(exerciseListQuery(new URL("https://app/api/v1/exercises")), {
    includeArchived: false,
    search: undefined,
    availableOnly: true,
  });
  assert.deepEqual(exerciseListQuery(new URL(
    "https://app/api/v1/exercises?includeArchived=true&search=press&scope=all",
  )), {
    includeArchived: true,
    search: "press",
    availableOnly: false,
  });
  assert.deepEqual(exerciseProgressQuery(new URL("https://app/progress")), {
    from: undefined,
    limit: 16,
    unit: undefined,
  });
  assert.deepEqual(exerciseProgressQuery(new URL(
    "https://app/progress?from=2026-01-01&limit=4&unit=lb",
  )), {
    from: "2026-01-01",
    limit: 4,
    unit: "lb",
  });
  assert.equal(exerciseProgressQuery(new URL("https://app/progress?unit=kg")).unit, "kg");
  assert.throws(
    () => exerciseProgressQuery(new URL("https://app/progress?unit=stone")),
    /must be lb or kg/i,
  );
});

test("classifies every routine operation", () => {
  const cases: Array<[string, string[], unknown]> = [
    ["GET", ["routines"], { kind: "list" }],
    ["POST", ["routines"], { kind: "create" }],
    ["DELETE", ["routines"], { kind: "method_not_allowed" }],
    ["GET", ["routines", "r1", "editor"], { kind: "editor_get", routineId: "r1" }],
    ["PATCH", ["routines", "r1", "editor"], { kind: "editor_update", routineId: "r1" }],
    ["POST", ["routines", "r1", "editor"], { kind: "method_not_allowed" }],
    ["GET", ["routines", "r1", "prescription"], { kind: "prescription_get", routineId: "r1" }],
    ["PATCH", ["routines", "r1", "prescription"], { kind: "prescription_legacy_write", routineId: "r1" }],
    ["POST", ["routines", "r1", "prescription"], { kind: "method_not_allowed" }],
    ["GET", ["routines", "r1", "versions"], { kind: "versions_list", routineId: "r1" }],
    ["POST", ["routines", "r1", "versions"], { kind: "version_create", routineId: "r1" }],
    ["PATCH", ["routines", "r1", "versions"], { kind: "method_not_allowed" }],
    ["POST", ["routines", "r1", "versions", "v1", "publish"], {
      kind: "version_publish", routineId: "r1", versionId: "v1",
    }],
    ["GET", ["routines", "r1", "versions", "v1", "publish"], {
      kind: "version_get", routineId: "r1", versionId: "v1",
    }],
    ["GET", ["routines", "r1", "versions", "v1"], {
      kind: "version_get", routineId: "r1", versionId: "v1",
    }],
    ["PATCH", ["routines", "r1", "versions", "v1"], {
      kind: "version_update", routineId: "r1", versionId: "v1",
    }],
    ["DELETE", ["routines", "r1", "versions", "v1"], {
      kind: "version_delete", routineId: "r1", versionId: "v1",
    }],
    ["POST", ["routines", "r1", "versions", "v1", "other"], {
      kind: "method_not_allowed",
    }],
    ["GET", ["routines", "r1"], { kind: "get", routineId: "r1" }],
    ["PATCH", ["routines", "r1", "legacy-extra"], { kind: "update", routineId: "r1" }],
    ["DELETE", ["routines", "r1"], { kind: "archive", routineId: "r1" }],
    ["POST", ["routines", "r1"], { kind: "method_not_allowed" }],
  ];
  for (const [method, segments, expected] of cases) {
    assert.deepEqual(routineRequestOperation(method, segments), expected);
  }
});

test("parses routine query and payload decisions", () => {
  assert.equal(routineListIncludesArchived(new URL("https://app/routines")), false);
  assert.equal(routineListIncludesArchived(new URL("https://app/routines?includeArchived=true")), true);

  const version = { focus: "A" } as never;
  assert.equal(routineCreationInput({}), null);
  assert.equal(routineCreationInput({ code: "", version }), null);
  assert.equal(routineCreationInput({ code: "A" }), null);
  assert.deepEqual(routineCreationInput({ code: "A", version }), { code: "A", version });

  assert.equal(routineEditorInput({}), null);
  assert.equal(routineEditorInput({ baseVersionId: "  ", proposedRoutine: version }), null);
  assert.equal(routineEditorInput({ baseVersionId: 1 as never, proposedRoutine: version }), null);
  assert.equal(routineEditorInput({ baseVersionId: "v1" }), null);
  assert.deepEqual(routineEditorInput({ baseVersionId: " v1 ", proposedRoutine: version }), {
    baseVersionId: "v1",
    proposedRoutine: version,
  });
});

test("classifies every workout operation and rejects near misses", () => {
  const cases: Array<[string, string[], unknown]> = [
    ["GET", ["workouts"], { kind: "list" }],
    ["POST", ["workouts"], { kind: "start" }],
    ["PATCH", ["workouts"], { kind: "method_not_allowed" }],
    ["GET", ["workouts", "w1", "history"], { kind: "history_get", workoutId: "w1" }],
    ["GET", ["workouts", "w1", "history", "extra"], { kind: "method_not_allowed" }],
    ["POST", ["workouts", "w1", "sets"], { kind: "set_record", workoutId: "w1" }],
    ["PATCH", ["workouts", "w1", "sets", "s1"], {
      kind: "set_correct", workoutId: "w1", setId: "s1",
    }],
    ["GET", ["workouts", "w1", "sets", "s1"], { kind: "method_not_allowed" }],
    ["POST", ["workouts", "w1", "rest", "skip"], { kind: "rest_skip", workoutId: "w1" }],
    ["POST", ["workouts", "w1", "rest", "other"], { kind: "method_not_allowed" }],
    ["POST", ["workouts", "w1", "complete"], { kind: "complete", workoutId: "w1" }],
    ["POST", ["workouts", "w1", "complete", "extra"], { kind: "method_not_allowed" }],
    ["DELETE", ["workouts", "w1", "discard"], { kind: "discard", workoutId: "w1" }],
    ["POST", ["workouts", "w1", "discard"], { kind: "method_not_allowed" }],
    ["GET", ["workouts", "w1"], { kind: "get", workoutId: "w1" }],
    ["PATCH", ["workouts", "w1"], { kind: "update", workoutId: "w1" }],
    ["DELETE", ["workouts", "w1"], { kind: "archive", workoutId: "w1" }],
    ["POST", ["workouts", "w1"], { kind: "method_not_allowed" }],
  ];
  for (const [method, segments, expected] of cases) {
    assert.deepEqual(workoutRequestOperation(method, segments), expected);
  }
});

test("parses workout list modes and payload decisions", () => {
  assert.deepEqual(workoutListRequest(new URL("https://app/workouts")), {
    kind: "list",
    query: { includeArchived: false, status: undefined },
  });
  assert.deepEqual(workoutListRequest(new URL(
    "https://app/workouts?includeArchived=true&status=Completed",
  )), {
    kind: "list",
    query: { includeArchived: true, status: "Completed" },
  });
  assert.deepEqual(workoutListRequest(new URL("https://app/workouts?view=history")), {
    kind: "history",
    query: {
      from: undefined,
      to: undefined,
      routineCode: undefined,
      status: undefined,
      exerciseSearch: undefined,
      limit: 20,
      offset: 0,
    },
  });
  assert.deepEqual(workoutListRequest(new URL(
    "https://app/workouts?view=history&from=a&to=b&routineCode=A&status=Partial&exercise=press&limit=5&offset=10",
  )), {
    kind: "history",
    query: {
      from: "a",
      to: "b",
      routineCode: "A",
      status: "Partial",
      exerciseSearch: "press",
      limit: 5,
      offset: 10,
    },
  });

  assert.equal(workoutStartInput({}), null);
  assert.equal(workoutStartInput({ routineId: "" }), null);
  assert.deepEqual(workoutStartInput({ routineId: "r1" }), {
    routineId: "r1",
    abandonActive: false,
    expectedRoutineVersionId: undefined,
  });
  assert.deepEqual(workoutStartInput({
    routineId: "r1", abandonActive: true, expectedRoutineVersionId: "v1",
  }), {
    routineId: "r1",
    abandonActive: true,
    expectedRoutineVersionId: "v1",
  });

  assert.equal(requestHasJsonBody(null), false);
  assert.equal(requestHasJsonBody("text/plain"), false);
  assert.equal(requestHasJsonBody("Application/JSON; Charset=UTF-8"), true);
  assert.equal(googleExchangeInput({}), null);
  assert.equal(googleExchangeInput({ idToken: "" }), null);
  assert.deepEqual(googleExchangeInput({ idToken: "token" }), {
    idToken: "token",
    deviceName: "Android device",
  });
  assert.deepEqual(googleExchangeInput({ idToken: "token", deviceName: "Pixel" }), {
    idToken: "token",
    deviceName: "Pixel",
  });
  assert.equal(refreshTokenInput({}), null);
  assert.equal(refreshTokenInput({ refreshToken: "" }), null);
  assert.equal(refreshTokenInput({ refreshToken: "refresh" }), "refresh");
});
