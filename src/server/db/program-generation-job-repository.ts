import type {
  GeneratedRoutineProgram,
  ProgramGenerationStatus,
} from "../../contracts/api";
import { ensureEntitySchema } from "./entity-schema";

export type ProgramGenerationJobError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type StoredProgramGenerationStatus = ProgramGenerationStatus | "validating";

export type StoredProgramGenerationJob = {
  id: string;
  ownerEmail: string;
  idempotencyKey: string;
  requestFingerprint: string;
  openAIResponseId: string | null;
  status: StoredProgramGenerationStatus;
  requestJson: string;
  resultJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type CreateStartingProgramGenerationJobInput = {
  id: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestJson: string;
  createdAt: string;
  expiresAt: string;
};

export type CreateStartingProgramGenerationJobResult =
  | { kind: "created" | "replayed"; job: StoredProgramGenerationJob }
  | { kind: "conflict"; job: StoredProgramGenerationJob };

type ProgramGenerationJobRow = Omit<StoredProgramGenerationJob, "errorRetryable"> & {
  errorRetryable: number;
};

const jobSelect = `SELECT id, owner_email AS ownerEmail,
  idempotency_key AS idempotencyKey, request_fingerprint AS requestFingerprint,
  openai_response_id AS openAIResponseId, status, request_json AS requestJson,
  result_json AS resultJson, error_code AS errorCode, error_message AS errorMessage,
  error_retryable AS errorRetryable, created_at AS createdAt,
  updated_at AS updatedAt, expires_at AS expiresAt
  FROM assistant_program_generation_jobs`;

const activeStatuses = "('starting', 'queued', 'in_progress')";
const cancellableStatuses = "('starting', 'queued', 'in_progress', 'validating', 'cancelling')";

function storedJob(row: ProgramGenerationJobRow): StoredProgramGenerationJob {
  return { ...row, errorRetryable: Boolean(Number(row.errorRetryable)) };
}

function changed(result: D1Result<unknown>) {
  return Number(result.meta.changes ?? 0) > 0;
}

export class D1ProgramGenerationJobRepository {
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly d1: D1Database) {}

  async ready() {
    this.readyPromise ??= ensureEntitySchema(this.d1).catch((error: unknown) => {
      this.readyPromise = null;
      throw error;
    });
    await this.readyPromise;
  }

  async createStarting(
    ownerEmail: string,
    input: CreateStartingProgramGenerationJobInput,
  ): Promise<CreateStartingProgramGenerationJobResult> {
    await this.ready();
    const inserted = await this.d1.prepare(`INSERT OR IGNORE INTO assistant_program_generation_jobs (
      id, owner_email, idempotency_key, request_fingerprint, openai_response_id,
      status, request_json, result_json, error_code, error_message, error_retryable,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, NULL, 'starting', ?, NULL, NULL, NULL, 0, ?, ?, ?)`)
      .bind(
        input.id,
        ownerEmail,
        input.idempotencyKey,
        input.requestFingerprint,
        input.requestJson,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
      )
      .run();
    const job = await this.getByIdempotency(ownerEmail, input.idempotencyKey);
    if (!job) throw new Error("The program generation job could not be created.");
    if (job.requestFingerprint !== input.requestFingerprint) return { kind: "conflict", job };
    return { kind: changed(inserted) ? "created" : "replayed", job };
  }

  async get(ownerEmail: string, jobId: string) {
    await this.ready();
    const row = await this.d1.prepare(`${jobSelect} WHERE id = ? AND owner_email = ?`)
      .bind(jobId, ownerEmail)
      .first<ProgramGenerationJobRow>();
    return row ? storedJob(row) : null;
  }

  async getByIdempotency(ownerEmail: string, key: string) {
    await this.ready();
    const row = await this.d1.prepare(`${jobSelect} WHERE owner_email = ? AND idempotency_key = ?`)
      .bind(ownerEmail, key)
      .first<ProgramGenerationJobRow>();
    return row ? storedJob(row) : null;
  }

  async attachResponse(
    ownerEmail: string,
    jobId: string,
    responseId: string,
    status: "queued" | "in_progress",
    updatedAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET openai_response_id = ?,
        status = CASE WHEN status = 'starting' THEN ? ELSE status END,
        updated_at = ?
      WHERE id = ? AND owner_email = ?
        AND status IN ('starting', 'cancelling') AND openai_response_id IS NULL`, [
      responseId,
      status,
      updatedAt,
      jobId,
      ownerEmail,
    ]);
    return changed(result);
  }

  async setPending(
    ownerEmail: string,
    jobId: string,
    status: "queued" | "in_progress",
    updatedAt: string,
  ) {
    const allowedStatuses = status === "queued" ? "('queued')" : "('queued', 'in_progress')";
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND status IN ${allowedStatuses}`, [
      status,
      updatedAt,
      jobId,
      ownerEmail,
    ]);
    return changed(result);
  }

  async claimValidation(
    ownerEmail: string,
    jobId: string,
    claimedAt: string,
    staleBefore: string,
  ) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'validating', updated_at = ?
      WHERE id = ? AND owner_email = ? AND (
        status IN ('queued', 'in_progress')
        OR (status = 'validating' AND updated_at <= ?)
      )`, [
      claimedAt,
      jobId,
      ownerEmail,
      staleBefore,
    ]);
    return changed(result);
  }

  async succeed(
    ownerEmail: string,
    jobId: string,
    validationClaimedAt: string,
    program: GeneratedRoutineProgram,
    updatedAt: string,
    expiresAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'succeeded', request_json = '{}', result_json = ?, error_code = NULL,
        error_message = NULL, error_retryable = 0, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'validating' AND updated_at = ?`, [
      JSON.stringify(program),
      updatedAt,
      expiresAt,
      jobId,
      ownerEmail,
      validationClaimedAt,
    ]);
    return changed(result);
  }

  async fail(
    ownerEmail: string,
    jobId: string,
    error: ProgramGenerationJobError,
    updatedAt: string,
    expiresAt: string,
    validationClaimedAt?: string,
  ) {
    const statusPredicate = validationClaimedAt === undefined
      ? `status IN ${activeStatuses}`
      : "status = 'validating' AND updated_at = ?";
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'failed', request_json = '{}', result_json = NULL,
        error_code = ?, error_message = ?,
        error_retryable = ?, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND ${statusPredicate}`, [
      error.code,
      error.message,
      Number(error.retryable),
      updatedAt,
      expiresAt,
      jobId,
      ownerEmail,
      ...(validationClaimedAt === undefined ? [] : [validationClaimedAt]),
    ]);
    return changed(result);
  }

  async failUnattachedStart(
    ownerEmail: string,
    jobId: string,
    error: ProgramGenerationJobError,
    updatedAt: string,
    expiresAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'failed', request_json = '{}', result_json = NULL,
        error_code = ?, error_message = ?, error_retryable = ?, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'starting' AND openai_response_id IS NULL`, [
      error.code,
      error.message,
      Number(error.retryable),
      updatedAt,
      expiresAt,
      jobId,
      ownerEmail,
    ]);
    return changed(result);
  }

  async beginCancel(ownerEmail: string, jobId: string, updatedAt: string) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'cancelling', updated_at = ?
      WHERE id = ? AND owner_email = ? AND status IN ('starting', 'queued', 'in_progress', 'validating')`, [
      updatedAt,
      jobId,
      ownerEmail,
    ]);
    return changed(result);
  }

  async cancel(
    ownerEmail: string,
    jobId: string,
    updatedAt: string,
    expiresAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'cancelled', request_json = '{}', result_json = NULL, error_code = NULL,
        error_message = NULL, error_retryable = 0, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND status IN ${cancellableStatuses}`, [
      updatedAt,
      expiresAt,
      jobId,
      ownerEmail,
    ]);
    return changed(result);
  }

  async expire(
    ownerEmail: string,
    jobId: string,
    error: ProgramGenerationJobError,
    updatedAt: string,
    expiresAt: string,
    validationClaimedAt?: string,
  ) {
    const statusPredicate = validationClaimedAt === undefined
      ? `status IN ${activeStatuses}`
      : "status = 'validating' AND updated_at = ?";
    const result = await this.update(`UPDATE assistant_program_generation_jobs
      SET status = 'expired', request_json = '{}', result_json = NULL,
        error_code = ?, error_message = ?,
        error_retryable = ?, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND ${statusPredicate}`, [
      error.code,
      error.message,
      Number(error.retryable),
      updatedAt,
      expiresAt,
      jobId,
      ownerEmail,
      ...(validationClaimedAt === undefined ? [] : [validationClaimedAt]),
    ]);
    return changed(result);
  }

  async pruneExpired(before: string) {
    const result = await this.update(
      `DELETE FROM assistant_program_generation_jobs
        WHERE expires_at <= ? AND status IN ('succeeded', 'failed', 'cancelled', 'expired')`,
      [before],
    );
    return Number(result.meta.changes ?? 0);
  }

  private async update(sql: string, values: unknown[]) {
    await this.ready();
    return this.d1.prepare(sql).bind(...values).run();
  }
}
