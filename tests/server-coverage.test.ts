import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SignJWT } from "jose";
import type {
  Exercise,
  RoutineExercise,
  RoutineSet,
  RoutineVersion,
} from "../src/domain/entities";
import { isRoutineVersionSemanticallyEqual } from "../src/domain/routines/comparison";
import {
  assistantModelOption,
  fallbackAssistantModels,
  isCompatibleAssistantModel,
  reasoningEffortsForModel,
} from "../src/server/coach/models";
import {
  authenticateRequest,
  createNativeSession,
  ensureAppUser,
  isAllowedUserEmail,
  linkGoogleIdentity,
  revokeNativeSession,
  rotateNativeSession,
} from "../src/server/auth/auth";
import {
  buildExerciseChangeDiff,
  completeExerciseInput,
  exerciseInputSnapshot,
} from "../src/server/coach/exercise-change";
import {
  buildRoutineChangeDiff,
  buildRoutineCreationDiff,
  completeRoutineChangeProposal,
  completeRoutineCreationProposal,
  type CoachRoutineProposal,
} from "../src/server/coach/routine-change";
import {
  CoachToolLoopError,
  runCoachToolLoop,
  type CoachResponse,
} from "../src/server/coach/tool-loop";
import { validateGoogleClaims, verifyGoogleIdToken } from "../src/server/auth/google";
import {
  apiError,
  apiResponse,
  errorMessage,
  preflightResponse,
  readJson,
} from "../src/server/http";
import { handleOnboardingRequest, sessionUser } from "../src/server/profile/onboarding";
import { getUserProfile, updateUserProfile, validateProfilePatch } from "../src/server/profile/profile";
import {
  accessTokenExpiresIn,
  hashRefreshToken,
  issueAccessToken,
  refreshExpiration,
  verifyAccessToken,
} from "../src/server/auth/session-tokens";
import type { ApiUser, WorkerEnv } from "../src/server/types";

type SqliteValue = null | number | bigint | string | Uint8Array;

function sqliteValue(value: unknown): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    typeof value === "number"
    || typeof value === "bigint"
    || typeof value === "string"
    || value instanceof Uint8Array
  ) return value;
  return String(value);
}

class SqliteStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  private boundValues() {
    return this.values.map(sqliteValue);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.boundValues());
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async all<T>() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.boundValues()) as T[],
    };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.boundValues()) as T | undefined) ?? null;
  }
}

class SqliteD1 {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements: SqliteStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

const ownerEmail = "owner@example.com";
const otherEmail = "other@example.com";
const sessionSecret = "server-coverage-secret-that-is-at-least-thirty-two-bytes";

function databaseEnvironment() {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite);
  const env = {
    DB: d1 as unknown as D1Database,
    ALLOWED_USER_EMAILS: `${ownerEmail}; ${otherEmail}`,
    OWNER_EMAIL: " owner@example.com ",
    AUTH_SESSION_SECRET: sessionSecret,
  } as unknown as WorkerEnv;
  return { sqlite, d1, env };
}

function apiUserFromAppUser(
  user: Awaited<ReturnType<typeof ensureAppUser>>,
  provider: ApiUser["provider"] = "chatgpt",
  sessionId: string | null = null,
): ApiUser {
  return {
    id: user.id,
    email: user.ownerEmail,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    trainingProfile: user.trainingProfile,
    provider,
    sessionId,
  };
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

test("assistant model helpers cover compatibility and label edge cases", () => {
  assert.deepEqual(reasoningEffortsForModel("gpt-5.3"), ["auto"]);
  assert.deepEqual(reasoningEffortsForModel("o9-reasoning"), ["auto", "low", "medium", "high"]);
  assert.deepEqual(reasoningEffortsForModel("custom"), ["auto"]);
  assert.equal(isCompatibleAssistantModel("chat-latest"), true);
  assert.equal(isCompatibleAssistantModel("gpt-5.6-search"), false);
  assert.equal(isCompatibleAssistantModel("claude-4"), false);
  assert.deepEqual(assistantModelOption("chat-latest", 0), {
    id: "chat-latest",
    label: "Chat Latest",
    created: 0,
    reasoningEfforts: ["auto"],
  });
  assert.deepEqual(fallbackAssistantModels().map((model) => model.created), [3, 2, 1]);
});

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "exercise-1",
    ownerEmail,
    name: "Bench Press",
    normalizedName: "bench press",
    equipment: "barbell",
    movementPattern: "push",
    trackingType: "reps",
    defaultLoadType: "external",
    sideMode: "bilateral",
    instructions: "Pause.",
    muscles: [{ muscleGroup: "chest", role: "primary", weight: 1 }],
    isFavorite: false,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("exercise change helpers reject incomplete states and disclose every field", () => {
  for (const invalid of [null, [], "exercise"]) {
    assert.throws(() => completeExerciseInput(invalid), /complete proposed exercise/i);
  }
  assert.throws(() => buildExerciseChangeDiff("create", null, null), /complete definition/i);
  assert.throws(() => buildExerciseChangeDiff("update", null, null), /could not be found/i);
  assert.throws(() => buildExerciseChangeDiff("update", exercise(), null), /complete definition/i);

  const current = exercise();
  const proposed = {
    ...exerciseInputSnapshot(current),
    equipment: "dumbbell",
    movementPattern: "carry",
    trackingType: "duration" as const,
    defaultLoadType: "bodyweight" as const,
    sideMode: "left_right" as const,
    instructions: "",
    muscles: [],
  };
  assert.deepEqual(buildExerciseChangeDiff("update", current, proposed), [
    "Equipment: Barbell → Dumbbell.",
    "Movement: Push → Carry.",
    "Tracking: Reps → Duration.",
    "Loading: External weight → Bodyweight.",
    "Side mode: Bilateral → Left / right.",
    "Instructions: Pause. → None.",
    "Muscles: Chest (Primary, weight 1) → None specified.",
  ]);
  const create = buildExerciseChangeDiff("create", null, proposed).join("\n");
  assert.match(create, /Instructions: None/);
  assert.match(create, /Muscles: None specified/);
});

type ProposedExercise = CoachRoutineProposal["exercises"][number];
type ProposedSet = ProposedExercise["sets"][number];
const timestamp = "2026-08-01T00:00:00.000Z";

function routineSet(overrides: Partial<RoutineSet> = {}): RoutineSet {
  return {
    id: "set-1",
    ownerEmail,
    routineExerciseId: "placement-1",
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "Add weight when ready.",
    sideMode: "bilateral",
    tempo: null,
    notes: "Clean reps.",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function routineExercise(overrides: Partial<RoutineExercise> = {}): RoutineExercise {
  return {
    id: "placement-1",
    ownerEmail,
    routineVersionId: "version-1",
    exerciseId: "bench",
    exerciseName: "Bench Press",
    position: 1,
    supersetGroup: null,
    instructions: "Pause.",
    notes: "Stay tight.",
    sets: [routineSet()],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function routineVersion(exercises: RoutineExercise[] = [routineExercise()]): RoutineVersion {
  return {
    id: "version-1",
    ownerEmail,
    routineId: "routine-1",
    versionNumber: 1,
    status: "published",
    focus: "Strength",
    summary: "Heavy work.",
    durationMin: 60,
    exercises,
    createdAt: timestamp,
    publishedAt: timestamp,
    updatedAt: timestamp,
  };
}

function proposedSet(sourceRoutineSetId: string | null = "set-1", overrides: Partial<ProposedSet> = {}): ProposedSet {
  return {
    sourceRoutineSetId,
    position: 1,
    setType: "regular",
    targetType: "reps",
    targetMin: 8,
    targetMax: 10,
    targetDisplay: "8-10 reps",
    targetRirMin: 1,
    targetRirMax: 2,
    restAfterSec: 90,
    restRule: "standard",
    loadInstruction: "Add weight when ready.",
    sideMode: "bilateral",
    tempo: null,
    notes: "Clean reps.",
    ...overrides,
  };
}

function proposedExercise(overrides: Partial<ProposedExercise> = {}): ProposedExercise {
  return {
    sourceRoutineExerciseId: "placement-1",
    exerciseId: "bench",
    position: 1,
    supersetGroup: null,
    instructions: "Pause.",
    notes: "Stay tight.",
    sets: [proposedSet()],
    ...overrides,
  };
}

function routineProposal(exercises: ProposedExercise[] = [proposedExercise()]): CoachRoutineProposal {
  return { focus: "Strength", summary: "Heavy work.", durationMin: 60, exercises };
}

test("routine proposal validation rejects malformed and cross-version identities", () => {
  const current = routineVersion();
  for (const invalid of [null, [], "routine"]) {
    assert.throws(() => completeRoutineChangeProposal(current, invalid), /complete proposed routine/i);
  }
  assert.throws(
    () => completeRoutineChangeProposal(current, { focus: "x" }),
    /needs exercises/i,
  );
  for (const invalidExercise of [null, [], "exercise"]) {
    assert.throws(
      () => completeRoutineChangeProposal(current, routineProposal([invalidExercise as never])),
      /Proposed exercise 1 is invalid/i,
    );
  }

  const invalidSource = routineProposal([{ ...proposedExercise(), sourceRoutineExerciseId: " " }]);
  assert.throws(() => completeRoutineChangeProposal(current, invalidSource), /must be an ID or null/i);
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([{ ...proposedExercise(), sourceRoutineExerciseId: "other" }])),
    /outside the current routine version/i,
  );
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([proposedExercise(), proposedExercise()])),
    /placement can be referenced only once/i,
  );
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([{ ...proposedExercise(), sets: undefined as never }])),
    /needs sets/i,
  );
  for (const invalidSet of [null, [], "set"]) {
    assert.throws(
      () => completeRoutineChangeProposal(current, routineProposal([{ ...proposedExercise(), sets: [invalidSet as never] }])),
      /Proposed set 1.*is invalid/i,
    );
  }
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([{ ...proposedExercise(), sets: [proposedSet("other")] }])),
    /outside its current routine exercise/i,
  );
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([{
      ...proposedExercise(),
      sourceRoutineExerciseId: null,
      sets: [proposedSet("set-1")],
    }])),
    /outside its current routine exercise/i,
  );
  assert.throws(
    () => completeRoutineChangeProposal(current, routineProposal([{
      ...proposedExercise(),
      sets: [proposedSet(), proposedSet()],
    }])),
    /set can be referenced only once/i,
  );

  const trimmed = completeRoutineChangeProposal(current, routineProposal([{
    ...proposedExercise(),
    sourceRoutineExerciseId: " placement-1 ",
    sets: [proposedSet(" set-1 ")],
  }]));
  assert.equal(trimmed.proposal.exercises[0]?.sourceRoutineExerciseId, "placement-1");
  assert.equal(trimmed.proposal.exercises[0]?.sets[0]?.sourceRoutineSetId, "set-1");
});

test("routine diff fallbacks and semantic defaults are observable", () => {
  const creation = completeRoutineCreationProposal(routineProposal([{
    ...proposedExercise(),
    sourceRoutineExerciseId: null,
    exerciseId: "unknown",
    sets: [proposedSet(null)],
  }])).proposal;
  assert.match(buildRoutineCreationDiff("NEW", creation, []).join("\n"), /Add exercise: unknown \(position 1\)/);

  const current = routineVersion();
  const aggregate = {
    id: "routine-1",
    ownerEmail,
    code: "A",
    currentVersionId: current.id,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentVersion: current,
  };
  const unchanged = routineProposal();
  assert.equal(isRoutineVersionSemanticallyEqual(current, unchanged), true);
  assert.equal(isRoutineVersionSemanticallyEqual(current, { ...unchanged, durationMin: 45 }), false);

  const noCurrent = { ...aggregate, currentVersionId: null, currentVersion: null };
  const noCurrentText = buildRoutineChangeDiff(noCurrent, creation, []).join("\n");
  assert.match(noCurrentText, /Routine name: Not set/);
  assert.match(noCurrentText, /Add exercise: unknown \(position 1\)/);

  const withoutLibraryName = buildRoutineChangeDiff(aggregate, routineProposal([{
    ...proposedExercise(),
    exerciseId: "missing-library-entry",
  }]), []).join("\n");
  assert.doesNotMatch(withoutLibraryName, /exercise:/i);

  const missingOptionalText = buildRoutineChangeDiff(aggregate, routineProposal([{
    ...proposedExercise(),
    instructions: undefined as never,
    notes: undefined as never,
  }]), []).join("\n");
  assert.match(missingOptionalText, /Instructions: Pause\. → None/i);
  assert.match(missingOptionalText, /Notes: Stay tight\. → None/i);
  assert.match(buildRoutineCreationDiff("OPTIONAL", routineProposal([{
    ...proposedExercise(),
    sourceRoutineExerciseId: null,
    instructions: undefined as never,
    notes: undefined as never,
    sets: [proposedSet(null)],
  }]), []).join("\n"), /Instructions: None; Notes: None/i);

  const sparseCurrent = routineVersion([routineExercise({
    instructions: undefined as never,
    notes: undefined as never,
    sets: [routineSet({
      targetMin: undefined as never,
      targetMax: undefined as never,
      targetRirMin: undefined as never,
      targetRirMax: undefined as never,
      loadInstruction: undefined as never,
      tempo: undefined as never,
      notes: undefined as never,
    })],
  })]);
  const normalizedSparse = routineProposal([proposedExercise({
    instructions: "",
    notes: "",
    sets: [proposedSet("set-1", {
      targetMin: null,
      targetMax: null,
      targetRirMin: null,
      targetRirMax: null,
      loadInstruction: "",
      tempo: null,
      notes: "",
    })],
  })]);
  assert.equal(isRoutineVersionSemanticallyEqual(sparseCurrent, normalizedSparse), true);
  const sparseDiff = buildRoutineChangeDiff(
    { ...aggregate, currentVersion: sparseCurrent },
    normalizedSparse,
    [],
  ).join("\n");
  assert.match(sparseDiff, /Minimum target: Not set → Not set/i);
});

const formatLoopError = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
);

function loopInput(responses: CoachResponse[]) {
  return {
    conversation: [] as unknown[],
    createResponse: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => ({ ok: true }),
    recordToolCall: async () => undefined,
    formatError: formatLoopError,
  };
}

test("coach tool loop rejects every invalid terminal provider response", async () => {
  const cases: Array<[CoachResponse, RegExp]> = [
    [{ id: "", status: "completed", output: [] }, /invalid response/i],
    [{ id: "incomplete", status: "incomplete", incomplete_details: { reason: "other" } }, /incomplete coaching response/i],
    [{ id: "failed", status: "failed", error: { message: "provider failed" } }, /provider failed/i],
    [{ id: "completed-error", status: "completed", error: { message: "late provider error" } }, /late provider error/i],
    [{ id: "empty", status: "completed" }, /no coaching response/i],
    [{ id: "empty-content", status: "completed", output: [
      { type: "reasoning" },
      { type: "message" },
      { type: "message", content: [{ type: "refusal" }, { type: "output_text" }] },
    ] }, /no coaching response/i],
  ];
  for (const [response, expected] of cases) {
    await assert.rejects(runCoachToolLoop(loopInput([response])), expected);
  }
});

test("coach tool loop validates calls, canonicalizes nested arguments, and joins messages", async () => {
  for (const call of [
    { type: "function_call", name: "lookup", arguments: "{}" },
    { type: "function_call", call_id: "call", arguments: "{}" },
  ]) {
    await assert.rejects(
      runCoachToolLoop(loopInput([{ id: "invalid-call", status: "completed", output: [call] }])),
      /invalid tool call/i,
    );
  }

  const records: unknown[] = [];
  const conversations: unknown[][] = [];
  const responses: CoachResponse[] = [
    {
      id: "tool",
      status: "completed",
      output: [{
        type: "function_call",
        call_id: "call",
        name: "lookup",
        arguments: '{"z":[null,true,2,{"b":"x","a":1}],"a":null}',
      }],
    },
    {
      id: "final",
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: " First " }] },
        { type: "message", content: [{ type: "output_text", text: "Second" }] },
      ],
    },
  ];
  const result = await runCoachToolLoop({
    ...loopInput(responses),
    createResponse: async (conversation) => {
      conversations.push([...conversation]);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async (call) => call.argumentsValue,
    recordToolCall: async (record) => { records.push(record); },
  });
  assert.equal(result.text, "First \nSecond");
  assert.equal(result.responseId, "final");
  assert.equal(records.length, 1);
  assert.equal(conversations.length, 2);
});

test("coach tool loop handles non-object arguments, default arguments, and forced tool misuse", async () => {
  const badArguments = ["null", "[]", "1"];
  for (const [index, argumentsText] of badArguments.entries()) {
    const records: Array<{ status: string; output: unknown }> = [];
    const responses: CoachResponse[] = [
      { id: `bad-${index}`, status: "completed", output: [{
        type: "function_call", call_id: `call-${index}`, name: "lookup", arguments: argumentsText,
      }] },
      { id: `final-${index}`, status: "completed", output: [{
        type: "message", content: [{ type: "output_text", text: "Done" }],
      }] },
    ];
    const result = await runCoachToolLoop({
      ...loopInput(responses),
      recordToolCall: async (record) => { records.push(record); },
    });
    assert.equal(result.text, "Done");
    assert.equal(records[0]?.status, "failed");
  }

  const defaultArgumentRecords: Array<{ argumentsValue: Record<string, unknown> }> = [];
  const defaultResponses: CoachResponse[] = [
    { id: "default-args", status: "completed", output: [{
      type: "function_call", call_id: "default", name: "lookup",
    }] },
    { id: "default-final", status: "completed", output: [{
      type: "message", content: [{ type: "output_text", text: "Done" }],
    }] },
  ];
  await runCoachToolLoop({
    ...loopInput(defaultResponses),
    recordToolCall: async (record) => { defaultArgumentRecords.push(record); },
  });
  assert.deepEqual(defaultArgumentRecords[0]?.argumentsValue, {});

  const forcedTimes = [0, 1];
  await assert.rejects(runCoachToolLoop({
    ...loopInput([{ id: "forced", status: "completed", output: [{
      type: "function_call", call_id: "call", name: "lookup", arguments: "{}",
    }] }]),
    maxRunDurationMs: 1,
    now: () => forcedTimes.shift() ?? 1,
  }), /tools were disabled/i);
});

test("Google claim validation covers issuer, audience arrays, required fields, and optional metadata", () => {
  const base = {
    iss: "accounts.google.com",
    aud: ["other", "client"],
    sub: "subject",
    email: ownerEmail,
    email_verified: true,
  };
  assert.deepEqual(validateGoogleClaims({ ...base, name: 12, picture: false }, "client"), {
    sub: "subject",
    email: ownerEmail,
    email_verified: true,
    name: undefined,
    picture: undefined,
  });
  assert.throws(() => validateGoogleClaims({ ...base, iss: "issuer" }, "client"), /unexpected token issuer/i);
  assert.throws(() => validateGoogleClaims({ ...base, sub: "" }, "client"), /identifier is missing/i);
  assert.throws(() => validateGoogleClaims({ ...base, sub: 1 as unknown as string }, "client"), /identifier is missing/i);
  assert.throws(() => validateGoogleClaims({ ...base, email: "" }, "client"), /email is missing/i);
  assert.throws(() => validateGoogleClaims({ ...base, email: 1 }, "client"), /email is missing/i);
  assert.throws(() => validateGoogleClaims({ ...base, email_verified: undefined }, "client"), /not verified/i);
});

test("Google ID token verification accepts a locally supplied matching JWKS", async () => {
  const keyPair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "test-key", alg: "RS256", use: "sig" });
  const token = await new SignJWT({
    email: ownerEmail,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience("client")
    .setSubject("subject")
    .setExpirationTime("5m")
    .sign(keyPair.privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [publicJwk] });
  try {
    const claims = await verifyGoogleIdToken(token, "client");
    assert.equal(claims.sub, "subject");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP helpers produce JSON, request IDs, errors, preflight CORS, and validation", async () => {
  const sameOrigin = new Request("https://app.example/api", {
    headers: { origin: "https://app.example", "x-request-id": "request-1" },
  });
  const response = apiResponse(sameOrigin, { ok: true }, {
    status: 201,
    headers: { "x-extra": "yes" },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), "request-1");
  assert.equal(response.headers.get("x-extra"), "yes");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(response.headers.get("vary"), "origin");
  assert.deepEqual(await responseJson(response), { ok: true });

  const local = new Request("https://app.example/api", { headers: { origin: "http://localhost:8081" } });
  assert.equal(apiResponse(local, null).headers.get("access-control-allow-origin"), "http://localhost:8081");
  const foreign = new Request("https://app.example/api", { headers: { origin: "https://evil.example" } });
  assert.equal(apiResponse(foreign, null).headers.get("access-control-allow-origin"), null);
  const noOrigin = new Request("https://app.example/api");
  assert.equal(apiResponse(noOrigin, null).headers.get("access-control-allow-origin"), null);
  assert.ok(apiResponse(noOrigin, null).headers.get("x-request-id"));

  assert.deepEqual(await responseJson(apiError(noOrigin, 409, "conflict", "Conflict")), {
    error: { code: "conflict", message: "Conflict", retryable: false },
  });
  assert.deepEqual(await responseJson(apiError(noOrigin, 503, "later", "Later", true)), {
    error: { code: "later", message: "Later", retryable: true },
  });
  const preflight = preflightResponse(local);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET,POST,PATCH,DELETE,OPTIONS");
  assert.equal(preflight.headers.get("access-control-max-age"), "86400");
  assert.equal(preflightResponse(foreign).headers.get("access-control-allow-origin"), null);

  const jsonRequest = new Request("https://app.example/api", {
    method: "POST",
    headers: { "content-type": "Application/JSON; Charset=UTF-8" },
    body: JSON.stringify({ value: 1 }),
  });
  assert.deepEqual(await readJson(jsonRequest), { value: 1 });
  await assert.rejects(
    readJson(new Request("https://app.example/api", { method: "POST", body: "x" })),
    /JSON request body/i,
  );
  await assert.rejects(
    readJson(new Request("https://app.example/api", { method: "POST" })),
    /JSON request body/i,
  );
  assert.equal(errorMessage(new Error("specific"), "fallback"), "specific");
  assert.equal(errorMessage(new Error(""), "fallback"), "fallback");
  assert.equal(errorMessage("not an error", "fallback"), "fallback");
});

test("session token helpers reject weak secrets and missing access claims", async () => {
  await assert.rejects(issueAccessToken("short", { id: "user", email: ownerEmail }, "session"), /at least 32 bytes/i);
  await assert.rejects(verifyAccessToken("short", "token"), /at least 32 bytes/i);
  assert.equal(accessTokenExpiresIn, 900);
  assert.equal(refreshExpiration(0), "1970-01-31T00:00:00.000Z");
  assert.match(await hashRefreshToken("token"), /^[A-Za-z0-9_-]+$/);

  async function token(payload: Record<string, unknown>, subject?: string) {
    let jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("workout-tracker-api")
      .setAudience("workout-tracker-app")
      .setExpirationTime("5m");
    if (subject !== undefined) jwt = jwt.setSubject(subject);
    return jwt.sign(new TextEncoder().encode(sessionSecret));
  }
  await assert.rejects(verifyAccessToken(sessionSecret, await token({ email: ownerEmail, sid: "session" })), /missing required claims/i);
  await assert.rejects(verifyAccessToken(sessionSecret, await token({ sid: "session" }, "user")), /missing required claims/i);
  await assert.rejects(verifyAccessToken(sessionSecret, await token({ email: ownerEmail }, "user")), /missing required claims/i);
});

test("auth lifecycle covers hosted, bearer, Google, rotation, and revocation branches", async () => {
  const { sqlite, d1, env } = databaseEnvironment();
  try {
    assert.equal(isAllowedUserEmail(env, " OWNER@EXAMPLE.COM "), true);
    assert.equal(isAllowedUserEmail(env, "missing@example.com"), false);
    assert.equal(isAllowedUserEmail({ ...env, ALLOWED_USER_EMAILS: undefined }, ownerEmail), true);
    assert.throws(
      () => isAllowedUserEmail({ DB: env.DB } as WorkerEnv, ownerEmail),
      /not configured/i,
    );

    const owner = await ensureAppUser(env, " OWNER@example.com ");
    assert.equal(owner.displayName, ownerEmail);
    assert.equal(owner.photoUrl, null);
    assert.equal((await ensureAppUser(env, ownerEmail, " ", "not-a-url")).displayName, ownerEmail);
    const updated = await ensureAppUser(env, ownerEmail, " Owner Name ", " https://example.com/photo ");
    assert.equal(updated.displayName, "Owner Name");
    assert.equal(updated.photoUrl, "https://example.com/photo");
    assert.deepEqual(await ensureAppUser(env, ownerEmail, "Owner Name"), updated);

    const missing = await authenticateRequest(new Request("https://app.example/api"), env);
    assert.equal(missing, null);
    const disallowed = await authenticateRequest(new Request("https://app.example/api", {
      headers: { "oai-authenticated-user-email": "blocked@example.com" },
    }), env);
    assert.equal(disallowed, null);
    const hosted = await authenticateRequest(new Request("https://app.example/api", { headers: {
      "oai-authenticated-user-email": otherEmail,
      "oai-authenticated-user-full-name": "Other%20Person",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    } }), env);
    assert.equal(hosted?.displayName, "Other Person");
    assert.equal(hosted?.provider, "chatgpt");
    const malformedName = await authenticateRequest(new Request("https://app.example/api", { headers: {
      "oai-authenticated-user-email": "third@example.com",
      "oai-authenticated-user-full-name": "%E0%A4%A",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    } }), { ...env, ALLOWED_USER_EMAILS: `${env.ALLOWED_USER_EMAILS},third@example.com` });
    assert.equal(malformedName?.displayName, "third@example.com");

    const session = await createNativeSession(env, owner, " ");
    assert.equal(session.expiresIn, accessTokenExpiresIn);
    const bearer = await authenticateRequest(new Request("https://app.example/api", {
      headers: { authorization: `Bearer ${session.accessToken}` },
    }), env);
    assert.equal(bearer?.provider, "session");
    assert.ok(bearer?.sessionId);
    assert.equal(await authenticateRequest(new Request("https://app.example/api", {
      headers: { authorization: "Bearer invalid" },
    }), env), null);
    assert.equal(await authenticateRequest(new Request("https://app.example/api", {
      headers: { authorization: "Bearer invalid" },
    }), { ...env, AUTH_SESSION_SECRET: undefined }), null);
    const wrongEmailToken = await issueAccessToken(sessionSecret, { id: owner.id, email: otherEmail }, bearer!.sessionId!);
    assert.equal(await authenticateRequest(new Request("https://app.example/api", {
      headers: { authorization: `Bearer ${wrongEmailToken}` },
    }), env), null);
    const missingSessionToken = await issueAccessToken(sessionSecret, { id: owner.id, email: ownerEmail }, "missing-session");
    assert.equal(await authenticateRequest(new Request("https://app.example/api", {
      headers: { authorization: `Bearer ${missingSessionToken}` },
    }), env), null);

    const rotated = await rotateNativeSession(env, session.refreshToken);
    assert.ok(rotated);
    assert.equal(await rotateNativeSession(env, session.refreshToken), null);

    const compareAndSwapSession = await createNativeSession(env, owner, "race");
    const noChangeDatabase = {
      prepare(sql: string) {
        if (sql.includes("UPDATE auth_sessions SET refresh_token_hash")) {
          return {
            bind() {
              return {
                async run() {
                  return { success: true, meta: {} };
                },
              };
            },
          };
        }
        return d1.prepare(sql);
      },
    } as unknown as D1Database;
    assert.equal(await rotateNativeSession(
      { ...env, DB: noChangeDatabase },
      compareAndSwapSession.refreshToken,
    ), null);

    assert.equal(await revokeNativeSession(env, bearer!.sessionId!), true);
    assert.equal(await revokeNativeSession(env, bearer!.sessionId!), false);
    const noMetadataDatabase = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: {} };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    assert.equal(await revokeNativeSession({ ...env, DB: noMetadataDatabase }, "session"), false);

    const linked = await linkGoogleIdentity(env, {
      sub: "google-owner", email: ownerEmail, email_verified: true,
      name: "Google Owner", picture: "https://example.com/google",
    });
    assert.equal(linked.displayName, "Google Owner");
    await linkGoogleIdentity(env, {
      sub: "google-owner", email: ownerEmail, email_verified: true,
      name: "Google Owner", picture: "https://example.com/google",
    });
    await assert.rejects(linkGoogleIdentity(env, {
      sub: "blocked", email: "blocked@example.com", email_verified: true,
    }), /not authorized/i);
    const other = await ensureAppUser(env, otherEmail, "Other");
    await d1.prepare(`INSERT INTO auth_identities (
      id, user_id, provider, provider_subject, email, email_verified, created_at, last_seen_at
    ) VALUES ('identity-conflict', ?, 'google', 'conflict', ?, 1, ?, ?)`)
      .bind(other.id, otherEmail, timestamp, timestamp).run();
    await assert.rejects(linkGoogleIdentity(env, {
      sub: "conflict", email: ownerEmail, email_verified: true,
    }), /different account/i);

    const disallowedEnv = { ...env, ALLOWED_USER_EMAILS: "someone@example.com", OWNER_EMAIL: undefined };
    await assert.rejects(createNativeSession(disallowedEnv, owner, "phone"), /not authorized/i);
    const disallowedSession = await createNativeSession(env, owner, "phone");
    assert.equal(await rotateNativeSession(disallowedEnv, disallowedSession.refreshToken), null);
    const revoked = await d1.prepare("SELECT revoked_at AS revokedAt FROM auth_sessions WHERE refresh_token_hash = ?")
      .bind(await hashRefreshToken(disallowedSession.refreshToken)).first<{ revokedAt: string | null }>();
    assert.ok(revoked?.revokedAt);
  } finally {
    sqlite.close();
  }
});

test("onboarding handles reads, methods, invalid input, first completion, repeat completion, and missing users", async () => {
  const { sqlite, d1, env } = databaseEnvironment();
  try {
    env.OPENAI_DEFAULT_MODEL = " ";
    const appUser = await ensureAppUser(env, ownerEmail, "Owner");
    let user = apiUserFromAppUser(appUser);
    const getResponse = await handleOnboardingRequest(new Request("https://app.example/onboarding"), env, user);
    assert.equal(getResponse.status, 200);
    assert.deepEqual((await responseJson(getResponse)).trainingProfile, user.trainingProfile);
    const methodResponse = await handleOnboardingRequest(new Request("https://app.example/onboarding", {
      method: "DELETE",
    }), env, user);
    assert.equal(methodResponse.status, 405);

    const invalid = await handleOnboardingRequest(new Request("https://app.example/onboarding", {
      method: "PUT",
      body: "not json",
    }), env, user);
    assert.equal(invalid.status, 400);
    assert.equal((await responseJson(invalid)).error.code, "onboarding_invalid");

    const put = (body: unknown) => new Request("https://app.example/onboarding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const completed = await handleOnboardingRequest(put({
      equipment: ["bodyweight", "dumbbells"], sessionDurationMin: 45,
    }), env, user);
    assert.equal(completed.status, 200);
    const completedBody = await responseJson(completed);
    assert.equal(completedBody.firstCompletion, true);
    assert.equal(completedBody.user.trainingProfile.onboardingCompleted, true);
    user = { ...user, trainingProfile: completedBody.user.trainingProfile };
    const firstCompletedAt = user.trainingProfile.onboardingCompletedAt;
    const repeated = await handleOnboardingRequest(put({
      equipment: ["bodyweight"], sessionDurationMin: 60,
    }), env, user);
    const repeatedBody = await responseJson(repeated);
    assert.equal(repeatedBody.firstCompletion, false);
    assert.equal(repeatedBody.user.trainingProfile.onboardingCompletedAt, firstCompletedAt);
    assert.deepEqual(sessionUser(user), {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      trainingProfile: user.trainingProfile,
    });
    const coach = await d1.prepare("SELECT model, equipment FROM coach_profiles WHERE owner_email = ?")
      .bind(ownerEmail).first<{ model: string; equipment: string }>();
    assert.equal(coach?.model, "gpt-5.6-terra");
    assert.equal(coach?.equipment, "Bodyweight");

    const missingCompletionTimestamp = await handleOnboardingRequest(put({
      equipment: ["bodyweight"], sessionDurationMin: 60,
    }), env, {
      ...user,
      trainingProfile: {
        ...user.trainingProfile,
        onboardingCompleted: true,
        onboardingCompletedAt: null,
      },
    });
    const missingTimestampBody = await responseJson(missingCompletionTimestamp);
    assert.equal(missingTimestampBody.firstCompletion, false);
    assert.ok(missingTimestampBody.user.trainingProfile.onboardingCompletedAt);

    const missingUser = { ...user, id: "missing" };
    const notFound = await handleOnboardingRequest(put({
      equipment: ["bodyweight"], sessionDurationMin: 30,
    }), env, missingUser);
    assert.equal(notFound.status, 404);
    assert.equal((await responseJson(notFound)).error.code, "user_not_found");

    const emptyBatchDatabase = {
      prepare() {
        return {
          bind() {
            return this;
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;
    const emptyBatch = await handleOnboardingRequest(put({
      equipment: ["bodyweight"], sessionDurationMin: 30,
    }), { ...env, DB: emptyBatchDatabase }, user);
    assert.equal(emptyBatch.status, 404);
  } finally {
    sqlite.close();
  }
});

test("profile validation and missing-profile behavior cover every optional branch", async () => {
  for (const invalid of [null, [], "patch"]) {
    assert.throws(() => validateProfilePatch(invalid), /JSON object/i);
  }
  assert.deepEqual(validateProfilePatch({}), {});
  assert.deepEqual(validateProfilePatch({ heightCm: null, bodyWeightKg: null }), {
    heightCm: null,
    bodyWeightKg: null,
  });
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "180"]) {
    assert.throws(() => validateProfilePatch({ heightCm: value }), /positive finite number/i);
  }
  assert.throws(() => validateProfilePatch({ measurementSystem: null }), /imperial or metric/i);
  assert.throws(() => validateProfilePatch({ id: "new" }), /read-only or unsupported/i);

  const { sqlite, env } = databaseEnvironment();
  try {
    const owner = await ensureAppUser(env, ownerEmail, "Owner");
    assert.equal(await getUserProfile(env, { id: owner.id, email: otherEmail }), null);
    assert.equal(await updateUserProfile(env, { id: owner.id, email: otherEmail }, {}), null);
    const unchanged = await updateUserProfile(env, { id: owner.id, email: ownerEmail }, {});
    assert.equal(unchanged?.measurementSystem, "imperial");
  } finally {
    sqlite.close();
  }
});
