import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { GeneratedRoutineProgram } from "../src/contracts/api";
import {
  D1ProgramGenerationJobRepository,
  type CreateStartingProgramGenerationJobInput,
  type ProgramGenerationJobError,
} from "../src/server/db/program-generation-job-repository";

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
    private readonly sql: string,
    private readonly values: unknown[],
    private readonly resultMeta: (changes: number) => { changes?: number },
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values, this.resultMeta);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values.map(sqliteValue));
    return { success: true, meta: this.resultMeta(Number(result.changes)) };
  }

  async all<T>() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values.map(sqliteValue)) as T[],
    };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values.map(sqliteValue)) as T | undefined) ?? null;
  }
}

class SqliteD1 {
  private omitNextChanges = false;

  constructor(private readonly database: DatabaseSync) {}

  omitNextChangeCount() {
    this.omitNextChanges = true;
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql, [], (changes) => {
      if (!this.omitNextChanges) return { changes };
      this.omitNextChanges = false;
      return {};
    });
  }

  async batch(statements: SqliteStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const owner = "owner@example.com";
const otherOwner = "other@example.com";
const createdAt = "2026-08-09T20:00:00.000Z";
const validationClaimedAt = "2026-08-09T20:00:01.000Z";
const validationReclaimedAt = "2026-08-09T20:01:01.000Z";
const pendingExpiresAt = "2026-08-09T20:10:00.000Z";
const terminalExpiresAt = "2026-08-10T20:00:00.000Z";

function startingInput(
  id: string,
  idempotencyKey = `idempotency-${id}`,
  requestFingerprint = `fingerprint-${id}`,
): CreateStartingProgramGenerationJobInput {
  return {
    id,
    idempotencyKey,
    requestFingerprint,
    requestJson: JSON.stringify({ goal: `Goal ${id}` }),
    createdAt,
    expiresAt: pendingExpiresAt,
  };
}

const program: GeneratedRoutineProgram = {
  name: "Generated plan",
  summary: "A generated test plan.",
  warnings: [],
  routines: [],
};

const retryableError: ProgramGenerationJobError = {
  code: "generation_failed",
  message: "Generation failed.",
  retryable: true,
};

function repositoryFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const d1 = new SqliteD1(sqlite);
  const repository = new D1ProgramGenerationJobRepository(d1 as unknown as D1Database);
  return { sqlite, d1, repository };
}

test("repository readiness retries after schema failure and reports a missing inserted job", async () => {
  let schemaAttempts = 0;
  const unavailableRepository = new D1ProgramGenerationJobRepository({
    prepare: () => ({}),
    batch: async () => {
      schemaAttempts += 1;
      throw new Error("Schema unavailable.");
    },
  } as unknown as D1Database);
  await assert.rejects(() => unavailableRepository.ready(), /schema unavailable/i);
  await assert.rejects(() => unavailableRepository.ready(), /schema unavailable/i);
  assert.equal(schemaAttempts, 2);

  const { sqlite, repository } = repositoryFixture();
  try {
    repository.getByIdempotency = async () => null;
    await assert.rejects(
      () => repository.createStarting(owner, startingInput("missing-created-job")),
      /could not be created/i,
    );
  } finally {
    sqlite.close();
  }
});

test("missing D1 change metadata is treated as no reported change", async () => {
  const { sqlite, d1, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("missing-change-count"));
    d1.omitNextChangeCount();
    assert.equal(await repository.beginCancel(owner, "missing-change-count", createdAt), false);
    assert.equal((await repository.get(owner, "missing-change-count"))?.status, "cancelling");

    await repository.createStarting(owner, {
      ...startingInput("missing-prune-count"),
      expiresAt: "2026-08-09T00:00:00.000Z",
    });
    await repository.fail(
      owner,
      "missing-prune-count",
      retryableError,
      "2026-08-08T20:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
    );
    d1.omitNextChangeCount();
    assert.equal(await repository.pruneExpired(createdAt), 0);
    assert.equal(await repository.get(owner, "missing-prune-count"), null);
  } finally {
    sqlite.close();
  }
});

test("program generation jobs initialize lazily and preserve owner-scoped idempotency", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.ready();
    await repository.ready();

    const created = await repository.createStarting(owner, startingInput("job-1", "request-key"));
    assert.equal(created.kind, "created");
    assert.deepEqual(created.job, {
      id: "job-1",
      ownerEmail: owner,
      idempotencyKey: "request-key",
      requestFingerprint: "fingerprint-job-1",
      openAIResponseId: null,
      status: "starting",
      requestJson: JSON.stringify({ goal: "Goal job-1" }),
      resultJson: null,
      errorCode: null,
      errorMessage: null,
      errorRetryable: false,
      createdAt,
      updatedAt: createdAt,
      expiresAt: pendingExpiresAt,
    });
    assert.deepEqual(await repository.get(owner, "job-1"), created.job);
    assert.equal(await repository.get(otherOwner, "job-1"), null);
    assert.equal(await repository.getByIdempotency(otherOwner, "request-key"), null);

    const replayed = await repository.createStarting(
      owner,
      startingInput("job-2", "request-key", "fingerprint-job-1"),
    );
    assert.equal(replayed.kind, "replayed");
    assert.equal(replayed.job.id, "job-1");

    const conflict = await repository.createStarting(
      owner,
      startingInput("job-3", "request-key", "different-fingerprint"),
    );
    assert.equal(conflict.kind, "conflict");
    assert.equal(conflict.job.id, "job-1");

    const otherCreated = await repository.createStarting(
      otherOwner,
      startingInput("other-job", "request-key"),
    );
    assert.equal(otherCreated.kind, "created");
    assert.equal(otherCreated.job.ownerEmail, otherOwner);
  } finally {
    sqlite.close();
  }
});

test("pending program generation transitions are owner-scoped and terminal success is immutable", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("success-job"));
    assert.equal(await repository.setPending(owner, "success-job", "queued", createdAt), false);
    assert.equal(
      await repository.attachResponse(otherOwner, "success-job", "response-success", "queued", createdAt),
      false,
    );
    assert.equal(
      await repository.attachResponse(owner, "success-job", "response-success", "queued", createdAt),
      true,
    );
    assert.equal(
      await repository.attachResponse(owner, "success-job", "response-repeated", "queued", createdAt),
      false,
    );
    assert.equal(await repository.setPending(owner, "success-job", "in_progress", createdAt), true);
    assert.equal(await repository.setPending(owner, "success-job", "queued", createdAt), false);
    assert.equal(
      await repository.claimValidation(otherOwner, "success-job", validationClaimedAt, createdAt),
      false,
    );
    assert.equal(
      await repository.claimValidation(owner, "success-job", validationClaimedAt, createdAt),
      true,
    );
    assert.equal(
      await repository.succeed(
        otherOwner,
        "success-job",
        validationClaimedAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
    assert.equal(
      await repository.succeed(
        owner,
        "success-job",
        validationClaimedAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      true,
    );

    const succeeded = await repository.get(owner, "success-job");
    assert.equal(succeeded?.status, "succeeded");
    assert.deepEqual(JSON.parse(succeeded!.resultJson!), program);
    assert.equal(succeeded?.requestJson, "{}");
    assert.equal(succeeded?.expiresAt, terminalExpiresAt);
    assert.equal(await repository.setPending(owner, "success-job", "queued", createdAt), false);
    assert.equal(await repository.beginCancel(owner, "success-job", createdAt), false);
    assert.equal(await repository.cancel(owner, "success-job", createdAt, terminalExpiresAt), false);
    assert.equal(await repository.fail(owner, "success-job", retryableError, createdAt, terminalExpiresAt), false);
    assert.equal(await repository.expire(owner, "success-job", retryableError, createdAt, terminalExpiresAt), false);
    assert.equal(
      await repository.succeed(
        owner,
        "success-job",
        validationClaimedAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
  } finally {
    sqlite.close();
  }
});

test("validation claims are owner-scoped, reclaimable, and fence obsolete finalizers", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("validation-lease"));
    await repository.attachResponse(
      owner,
      "validation-lease",
      "response-validation-lease",
      "in_progress",
      createdAt,
    );
    assert.equal(
      await repository.claimValidation(otherOwner, "validation-lease", validationClaimedAt, createdAt),
      false,
    );
    assert.equal(
      await repository.claimValidation(owner, "validation-lease", validationClaimedAt, createdAt),
      true,
    );
    assert.equal((await repository.get(owner, "validation-lease"))?.status, "validating");
    assert.equal(await repository.setPending(owner, "validation-lease", "in_progress", createdAt), false);
    assert.equal(
      await repository.claimValidation(
        owner,
        "validation-lease",
        validationReclaimedAt,
        "2026-08-09T20:00:00.999Z",
      ),
      false,
    );
    assert.equal(
      await repository.claimValidation(
        owner,
        "validation-lease",
        validationReclaimedAt,
        validationClaimedAt,
      ),
      true,
    );
    assert.equal(
      await repository.succeed(
        owner,
        "validation-lease",
        validationClaimedAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
    assert.equal(
      await repository.fail(
        owner,
        "validation-lease",
        retryableError,
        createdAt,
        terminalExpiresAt,
        validationClaimedAt,
      ),
      false,
    );
    assert.equal(
      await repository.expire(
        owner,
        "validation-lease",
        retryableError,
        createdAt,
        terminalExpiresAt,
        validationClaimedAt,
      ),
      false,
    );
    assert.equal(
      await repository.succeed(
        owner,
        "validation-lease",
        validationReclaimedAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      true,
    );
  } finally {
    sqlite.close();
  }
});

test("failure, cancellation, and expiry preserve cancellation intent", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("failed-starting"));
    assert.equal(
      await repository.fail(owner, "failed-starting", retryableError, createdAt, terminalExpiresAt),
      true,
    );
    const failed = await repository.get(owner, "failed-starting");
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.errorCode, retryableError.code);
    assert.equal(failed?.errorMessage, retryableError.message);
    assert.equal(failed?.errorRetryable, true);
    assert.equal(failed?.requestJson, "{}");

    await repository.createStarting(owner, startingInput("lost-start"));
    assert.equal(
      await repository.failUnattachedStart(
        otherOwner,
        "lost-start",
        retryableError,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
    assert.equal(
      await repository.failUnattachedStart(
        owner,
        "lost-start",
        retryableError,
        createdAt,
        terminalExpiresAt,
      ),
      true,
    );
    assert.equal((await repository.get(owner, "lost-start"))?.status, "failed");

    await repository.createStarting(owner, startingInput("attached-start"));
    await repository.attachResponse(owner, "attached-start", "response-attached-start", "queued", createdAt);
    assert.equal(
      await repository.failUnattachedStart(
        owner,
        "attached-start",
        retryableError,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
    assert.equal((await repository.get(owner, "attached-start"))?.status, "queued");

    for (const [id, prepare] of [
      ["failed-queued", async () => repository.attachResponse(owner, "failed-queued", "response-fail-q", "queued", createdAt)],
      ["failed-progress", async () => repository.attachResponse(owner, "failed-progress", "response-fail-p", "in_progress", createdAt)],
    ] as const) {
      await repository.createStarting(owner, startingInput(id));
      await prepare();
      assert.equal(await repository.fail(owner, id, retryableError, createdAt, terminalExpiresAt), true);
      assert.equal((await repository.get(owner, id))?.status, "failed");
    }
    await repository.createStarting(owner, startingInput("failed-validating"));
    await repository.attachResponse(owner, "failed-validating", "response-fail-v", "queued", createdAt);
    await repository.claimValidation(owner, "failed-validating", validationClaimedAt, createdAt);
    assert.equal(
      await repository.fail(
        owner,
        "failed-validating",
        retryableError,
        createdAt,
        terminalExpiresAt,
        validationClaimedAt,
      ),
      true,
    );
    assert.equal((await repository.get(owner, "failed-validating"))?.status, "failed");

    for (const [id, prepare] of [
      ["cancel-starting", async () => undefined],
      ["cancel-queued", async () => repository.attachResponse(owner, "cancel-queued", "response-cancel-q", "queued", createdAt)],
      ["cancel-progress", async () => repository.attachResponse(owner, "cancel-progress", "response-cancel-p", "in_progress", createdAt)],
      ["cancel-validating", async () => {
        await repository.attachResponse(owner, "cancel-validating", "response-cancel-v", "queued", createdAt);
        await repository.claimValidation(owner, "cancel-validating", validationClaimedAt, createdAt);
      }],
      ["cancel-cancelling", async () => repository.beginCancel(owner, "cancel-cancelling", createdAt)],
    ] as const) {
      await repository.createStarting(owner, startingInput(id));
      await prepare();
      assert.equal(await repository.cancel(owner, id, createdAt, terminalExpiresAt), true);
      const cancelled = await repository.get(owner, id);
      assert.equal(cancelled?.status, "cancelled");
      assert.equal(cancelled?.requestJson, "{}");
      assert.equal(await repository.cancel(owner, id, createdAt, terminalExpiresAt), false);
    }

    for (const [id, prepare] of [
      ["expire-starting", async () => undefined],
      ["expire-queued", async () => repository.attachResponse(owner, "expire-queued", "response-expire-q", "queued", createdAt)],
      ["expire-progress", async () => repository.attachResponse(owner, "expire-progress", "response-expire-p", "in_progress", createdAt)],
    ] as const) {
      await repository.createStarting(owner, startingInput(id));
      await prepare();
      assert.equal(
        await repository.expire(owner, id, retryableError, createdAt, terminalExpiresAt),
        true,
      );
      assert.equal((await repository.get(owner, id))?.status, "expired");
      assert.equal(await repository.expire(owner, id, retryableError, createdAt, terminalExpiresAt), false);
    }
    await repository.createStarting(owner, startingInput("expire-validating"));
    await repository.attachResponse(owner, "expire-validating", "response-expire-v", "queued", createdAt);
    await repository.claimValidation(owner, "expire-validating", validationClaimedAt, createdAt);
    assert.equal(
      await repository.expire(
        owner,
        "expire-validating",
        retryableError,
        createdAt,
        terminalExpiresAt,
        validationClaimedAt,
      ),
      true,
    );
    const expiredValidation = await repository.get(owner, "expire-validating");
    assert.equal(expiredValidation?.status, "expired");
    assert.equal(expiredValidation?.requestJson, "{}");

    await repository.createStarting(owner, startingInput("cancel-flow"));
    assert.equal(await repository.beginCancel(otherOwner, "cancel-flow", createdAt), false);
    assert.equal(await repository.beginCancel(owner, "cancel-flow", createdAt), true);
    assert.equal(await repository.beginCancel(owner, "cancel-flow", createdAt), false);
    assert.equal(await repository.setPending(owner, "cancel-flow", "in_progress", createdAt), false);
    assert.equal(
      await repository.claimValidation(owner, "cancel-flow", validationClaimedAt, createdAt),
      false,
    );
    assert.equal(
      await repository.fail(owner, "cancel-flow", { ...retryableError, retryable: false }, createdAt, terminalExpiresAt),
      false,
    );
    assert.equal(
      await repository.fail(
        owner,
        "cancel-flow",
        retryableError,
        createdAt,
        terminalExpiresAt,
        createdAt,
      ),
      false,
    );
    assert.equal(
      await repository.expire(owner, "cancel-flow", retryableError, createdAt, terminalExpiresAt),
      false,
    );
    assert.equal(
      await repository.expire(
        owner,
        "cancel-flow",
        retryableError,
        createdAt,
        terminalExpiresAt,
        createdAt,
      ),
      false,
    );
    assert.equal(
      await repository.succeed(
        owner,
        "cancel-flow",
        createdAt,
        program,
        createdAt,
        terminalExpiresAt,
      ),
      false,
    );
    assert.equal((await repository.get(owner, "cancel-flow"))?.status, "cancelling");
    assert.equal(await repository.cancel(owner, "cancel-flow", createdAt, terminalExpiresAt), true);

    for (const [id, responseId, status, validate] of [
      ["begin-cancel-queued", "response-begin-cancel-q", "queued", false],
      ["begin-cancel-progress", "response-begin-cancel-p", "in_progress", false],
      ["begin-cancel-validating", "response-begin-cancel-v", "queued", true],
    ] as const) {
      await repository.createStarting(owner, startingInput(id));
      await repository.attachResponse(owner, id, responseId, status, createdAt);
      if (validate) await repository.claimValidation(owner, id, validationClaimedAt, createdAt);
      assert.equal(await repository.beginCancel(owner, id, createdAt), true);
      assert.equal((await repository.get(owner, id))?.status, "cancelling");
    }
  } finally {
    sqlite.close();
  }
});

test("a response can attach after cancellation starts without losing cancellation intent", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("cancel-attach"));
    assert.equal(await repository.beginCancel(owner, "cancel-attach", createdAt), true);
    assert.equal(
      await repository.attachResponse(
        otherOwner,
        "cancel-attach",
        "response-cancel-attach",
        "queued",
        validationClaimedAt,
      ),
      false,
    );
    assert.equal(
      await repository.attachResponse(
        owner,
        "cancel-attach",
        "response-cancel-attach",
        "queued",
        validationClaimedAt,
      ),
      true,
    );
    const cancelling = await repository.get(owner, "cancel-attach");
    assert.equal(cancelling?.status, "cancelling");
    assert.equal(cancelling?.openAIResponseId, "response-cancel-attach");
    assert.equal(cancelling?.updatedAt, validationClaimedAt);
    assert.equal(
      await repository.attachResponse(
        owner,
        "cancel-attach",
        "response-cancel-attach-repeated",
        "in_progress",
        validationReclaimedAt,
      ),
      false,
    );
  } finally {
    sqlite.close();
  }
});

test("response identifiers are unique and pruning retains active jobs for reconciliation", async () => {
  const { sqlite, repository } = repositoryFixture();
  try {
    await repository.createStarting(owner, startingInput("response-1"));
    await repository.createStarting(otherOwner, startingInput("response-2"));
    assert.equal(
      await repository.attachResponse(owner, "response-1", "shared-response", "queued", createdAt),
      true,
    );
    await assert.rejects(
      () => repository.attachResponse(otherOwner, "response-2", "shared-response", "queued", createdAt),
      /UNIQUE constraint failed/,
    );

    await repository.createStarting(owner, startingInput("old-terminal"));
    await repository.fail(
      owner,
      "old-terminal",
      retryableError,
      "2026-08-08T20:00:00.000Z",
      "2026-08-09T00:00:00.000Z",
    );
    await repository.createStarting(owner, startingInput("fresh-terminal"));
    await repository.cancel(owner, "fresh-terminal", createdAt, terminalExpiresAt);
    await repository.createStarting(owner, {
      ...startingInput("old-active"),
      expiresAt: "2026-08-09T00:00:00.000Z",
    });

    assert.equal(await repository.pruneExpired(createdAt), 1);
    assert.equal(await repository.get(owner, "old-terminal"), null);
    assert.equal((await repository.get(owner, "fresh-terminal"))?.status, "cancelled");
    assert.equal((await repository.get(owner, "old-active"))?.status, "starting");
  } finally {
    sqlite.close();
  }
});
