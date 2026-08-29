import { ensureEntitySchema } from "./entity-schema";

export type MessageRunStatus =
  | "starting"
  | "queued"
  | "in_progress"
  | "processing"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export type MessageRunError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type StoredMessageRun = {
  id: string;
  ownerEmail: string;
  threadId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  userMessageId: string;
  assistantMessageId: string | null;
  status: MessageRunStatus;
  phase: string;
  model: string;
  reasoningEffort: string;
  openAIResponseId: string | null;
  previousResponseId: string | null;
  responseIdsJson: string;
  pendingInputJson: string;
  activitiesJson: string;
  callSignaturesJson: string;
  roundCount: number;
  toolCallCount: number;
  forceFinal: boolean;
  proposalStaged: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type StoredAssistantMessageRun = StoredMessageRun;

export type CreateStartingMessageRunInput = {
  id: string;
  threadId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  userMessageId: string;
  userContent: string;
  model: string;
  reasoningEffort: string;
  createdAt: string;
  expiresAt: string;
};

export type CreateRetryStartingMessageRunInput = Omit<
  CreateStartingMessageRunInput,
  "userContent"
> & {
  sourceRunId: string;
};

export type CreateStartingMessageRunResult =
  | { kind: "created" | "replayed"; run: StoredMessageRun }
  | { kind: "conflict" | "active"; run: StoredMessageRun };

export type AttachMessageRunResponseInput = {
  openAIResponseId: string;
  previousResponseId: string | null;
  responseIdsJson: string;
  pendingInputJson?: string;
  status: "queued" | "in_progress";
  phase: string;
  roundCount: number;
  updatedAt: string;
  leaseToken?: string;
};

export type UpdateProcessingMessageRunInput = {
  phase: string;
  openAIResponseId: string | null;
  previousResponseId: string | null;
  responseIdsJson: string;
  pendingInputJson: string;
  activitiesJson: string;
  callSignaturesJson: string;
  roundCount: number;
  toolCallCount: number;
  forceFinal: boolean;
  proposalStaged: boolean;
  updatedAt: string;
};

export type BeginMessageRunCallInput = {
  id: string;
  callId: string;
  callSignature: string;
  toolName: string;
  argumentsJson: string;
  createdAt: string;
};

export type StoredMessageRunCall = {
  id: string;
  ownerEmail: string;
  runId: string;
  callId: string;
  callSignature: string;
  toolName: string;
  argumentsJson: string;
  outputJson: string | null;
  activityJson: string | null;
  status: "processing" | "succeeded" | "failed";
  errorMessage: string | null;
  leaseToken: string;
  createdAt: string;
  updatedAt: string;
};

export type BeginMessageRunCallResult =
  | { kind: "created" | "reclaimed" | "replayed"; call: StoredMessageRunCall }
  | { kind: "conflict"; call: StoredMessageRunCall }
  | { kind: "rejected"; call: null };

export type FinishMessageRunCallInput = {
  status: "succeeded" | "failed";
  outputJson: string;
  activityJson: string | null;
  errorMessage: string | null;
  activitiesJson: string;
  callSignaturesJson: string;
  toolCallCount: number;
  proposalStaged: boolean;
  phase: string;
  updatedAt: string;
};

export type SucceedMessageRunInput = {
  assistantMessageId: string;
  content: string;
  responseId: string | null;
  runActivitiesJson: string;
  messageActivitiesJson: string;
  createdAt: string;
  expiresAt: string;
};

type MessageRunRow = Omit<StoredMessageRun, "forceFinal" | "proposalStaged" | "errorRetryable"> & {
  forceFinal: number;
  proposalStaged: number;
  errorRetryable: number;
};

type MessageRunCallRow = StoredMessageRunCall;

const runSelect = `SELECT id, owner_email AS ownerEmail, thread_id AS threadId,
  idempotency_key AS idempotencyKey, request_fingerprint AS requestFingerprint,
  user_message_id AS userMessageId, assistant_message_id AS assistantMessageId,
  status, phase, model, reasoning_effort AS reasoningEffort,
  openai_response_id AS openAIResponseId, previous_response_id AS previousResponseId,
  response_ids_json AS responseIdsJson, pending_input_json AS pendingInputJson,
  activities_json AS activitiesJson, call_signatures_json AS callSignaturesJson,
  round_count AS roundCount, tool_call_count AS toolCallCount,
  force_final AS forceFinal, proposal_staged AS proposalStaged,
  error_code AS errorCode, error_message AS errorMessage,
  error_retryable AS errorRetryable, lease_token AS leaseToken,
  lease_expires_at AS leaseExpiresAt, created_at AS createdAt,
  updated_at AS updatedAt, expires_at AS expiresAt
  FROM assistant_message_runs`;

const callSelect = `SELECT id, owner_email AS ownerEmail, run_id AS runId,
  call_id AS callId, call_signature AS callSignature, tool_name AS toolName,
  arguments_json AS argumentsJson, output_json AS outputJson,
  activity_json AS activityJson, status, error_message AS errorMessage,
  lease_token AS leaseToken, created_at AS createdAt, updated_at AS updatedAt
  FROM assistant_message_run_calls`;

const activeStatuses = "('starting', 'queued', 'in_progress', 'processing')";
const terminalStatuses = "('succeeded', 'failed', 'expired', 'cancelled')";

function storedRun(row: MessageRunRow): StoredMessageRun {
  return {
    ...row,
    forceFinal: Boolean(Number(row.forceFinal)),
    proposalStaged: Boolean(Number(row.proposalStaged)),
    errorRetryable: Boolean(Number(row.errorRetryable)),
  };
}

function changed(result: D1Result<unknown>) {
  return Number(result.meta.changes) > 0;
}

export class D1MessageRunRepository {
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
    input: CreateStartingMessageRunInput,
  ): Promise<CreateStartingMessageRunResult> {
    await this.ready();
    const results = await this.d1.batch([
      this.d1.prepare(`INSERT OR IGNORE INTO assistant_message_runs (
        id, owner_email, thread_id, idempotency_key, request_fingerprint,
        user_message_id, assistant_message_id, status, phase, model, reasoning_effort,
        openai_response_id, previous_response_id, response_ids_json, pending_input_json,
        activities_json, call_signatures_json, round_count, tool_call_count,
        force_final, proposal_staged, error_code, error_message, error_retryable,
        lease_token, lease_expires_at, created_at, updated_at, expires_at
      ) SELECT ?, ?, thread.id, ?, ?, ?, NULL, 'starting', 'planning', ?, ?,
        NULL, NULL, '[]', '[]', '[]', '{}', 0, 0, 0, 0, NULL, NULL, 0,
        NULL, NULL, ?, ?, ?
        FROM assistant_threads AS thread
        WHERE thread.id = ? AND thread.owner_email = ?
          AND NOT EXISTS (SELECT 1 FROM assistant_messages WHERE id = ?)`)
        .bind(
          input.id,
          ownerEmail,
          input.idempotencyKey,
          input.requestFingerprint,
          input.userMessageId,
          input.model,
          input.reasoningEffort,
          input.createdAt,
          input.createdAt,
          input.expiresAt,
          input.threadId,
          ownerEmail,
          input.userMessageId,
        ),
      this.d1.prepare(`INSERT INTO assistant_messages (
        id, owner_email, thread_id, role, content, model, reasoning_effort,
        response_id, activities_json, created_at
      ) SELECT run.user_message_id, run.owner_email, run.thread_id, 'user', ?,
        NULL, NULL, NULL, '[]', run.created_at
        FROM assistant_message_runs AS run
        WHERE run.id = ? AND run.owner_email = ? AND run.thread_id = ?
          AND run.idempotency_key = ? AND run.request_fingerprint = ?
          AND run.user_message_id = ?
          AND NOT EXISTS (SELECT 1 FROM assistant_messages WHERE id = run.user_message_id)`)
        .bind(
          input.userContent,
          input.id,
          ownerEmail,
          input.threadId,
          input.idempotencyKey,
          input.requestFingerprint,
          input.userMessageId,
        ),
      this.d1.prepare(`UPDATE assistant_threads SET
        title = CASE WHEN title = 'New coaching conversation' THEN ? ELSE title END,
        updated_at = ?
        WHERE id = ? AND owner_email = ?
          AND EXISTS (SELECT 1 FROM assistant_message_runs
            WHERE id = ? AND owner_email = ? AND user_message_id = ?)`)
        .bind(
          input.userContent.slice(0, 64),
          input.createdAt,
          input.threadId,
          ownerEmail,
          input.id,
          ownerEmail,
          input.userMessageId,
        ),
    ]);
    const run = await this.getByIdempotency(ownerEmail, input.idempotencyKey);
    if (run) {
      if (run.requestFingerprint !== input.requestFingerprint) return { kind: "conflict", run };
      return { kind: changed(results[0]) ? "created" : "replayed", run };
    }
    const active = await this.getActiveForThread(ownerEmail, input.threadId);
    if (active) return { kind: "active", run: active };
    throw new Error("The coaching message run could not be created.");
  }

  async createRetryStarting(
    ownerEmail: string,
    input: CreateRetryStartingMessageRunInput,
  ): Promise<CreateStartingMessageRunResult> {
    await this.ready();
    const inserted = await this.d1.prepare(`INSERT OR IGNORE INTO assistant_message_runs (
      id, owner_email, thread_id, idempotency_key, request_fingerprint,
      user_message_id, assistant_message_id, status, phase, model, reasoning_effort,
      openai_response_id, previous_response_id, response_ids_json, pending_input_json,
      activities_json, call_signatures_json, round_count, tool_call_count,
      force_final, proposal_staged, error_code, error_message, error_retryable,
      lease_token, lease_expires_at, created_at, updated_at, expires_at
    ) SELECT ?, source.owner_email, source.thread_id, ?, ?, source.user_message_id,
      NULL, 'starting', 'planning', ?, ?, NULL, NULL, '[]', '[]', '[]', '{}',
      0, 0, 0, 0, NULL, NULL, 0, NULL, NULL, ?, ?, ?
      FROM assistant_message_runs AS source
      WHERE source.id = ? AND source.owner_email = ? AND source.thread_id = ?
        AND source.status IN ('failed', 'expired')
        AND source.user_message_id = ?
        AND EXISTS (SELECT 1 FROM assistant_messages
          WHERE id = source.user_message_id AND owner_email = source.owner_email
            AND thread_id = source.thread_id AND role = 'user')`)
      .bind(
        input.id,
        input.idempotencyKey,
        input.requestFingerprint,
        input.model,
        input.reasoningEffort,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
        input.sourceRunId,
        ownerEmail,
        input.threadId,
        input.userMessageId,
      )
      .run();
    const run = await this.getByIdempotency(ownerEmail, input.idempotencyKey);
    if (run) {
      if (run.requestFingerprint !== input.requestFingerprint) return { kind: "conflict", run };
      return { kind: changed(inserted) ? "created" : "replayed", run };
    }
    const active = await this.getActiveForThread(ownerEmail, input.threadId);
    if (active) return { kind: "active", run: active };
    throw new Error("The coaching message retry could not be created.");
  }

  async get(ownerEmail: string, runId: string) {
    await this.ready();
    const row = await this.d1.prepare(`${runSelect} WHERE id = ? AND owner_email = ?`)
      .bind(runId, ownerEmail)
      .first<MessageRunRow>();
    return row ? storedRun(row) : null;
  }

  async getByIdempotency(ownerEmail: string, key: string) {
    await this.ready();
    const row = await this.d1.prepare(`${runSelect} WHERE owner_email = ? AND idempotency_key = ?`)
      .bind(ownerEmail, key)
      .first<MessageRunRow>();
    return row ? storedRun(row) : null;
  }

  async getActiveForThread(ownerEmail: string, threadId: string) {
    await this.ready();
    const row = await this.d1.prepare(`${runSelect}
      WHERE owner_email = ? AND thread_id = ? AND status IN ${activeStatuses}
      ORDER BY updated_at DESC LIMIT 1`)
      .bind(ownerEmail, threadId)
      .first<MessageRunRow>();
    return row ? storedRun(row) : null;
  }

  async getLatestForThread(ownerEmail: string, threadId: string) {
    await this.ready();
    const row = await this.d1.prepare(`${runSelect}
      WHERE owner_email = ? AND thread_id = ?
      ORDER BY updated_at DESC, created_at DESC LIMIT 1`)
      .bind(ownerEmail, threadId)
      .first<MessageRunRow>();
    return row ? storedRun(row) : null;
  }

  async claimProcessing(
    ownerEmail: string,
    runId: string,
    leaseToken: string,
    claimedAt: string,
    leaseExpiresAt: string,
    staleBefore: string,
  ) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET status = 'processing', lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND (
        status IN ('starting', 'queued', 'in_progress')
        OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
      )`, [leaseToken, leaseExpiresAt, claimedAt, runId, ownerEmail, staleBefore]);
    return changed(result);
  }

  async releaseProcessing(
    ownerEmail: string,
    runId: string,
    leaseToken: string,
    status: "in_progress",
    phase: string,
    updatedAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET status = ?, phase = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?`, [
      status,
      phase,
      updatedAt,
      runId,
      ownerEmail,
      leaseToken,
    ]);
    return changed(result);
  }

  async attachResponse(
    ownerEmail: string,
    runId: string,
    input: AttachMessageRunResponseInput,
  ) {
    const leasePredicate = input.leaseToken === undefined
      ? "status = 'starting' AND lease_token IS NULL"
      : "status = 'processing' AND lease_token = ?";
    const result = await this.update(`UPDATE assistant_message_runs
      SET openai_response_id = ?, previous_response_id = ?, response_ids_json = ?,
        pending_input_json = ?, status = ?, phase = ?, round_count = ?,
        lease_token = NULL, lease_expires_at = NULL, error_code = NULL,
        error_message = NULL, error_retryable = 0, updated_at = ?
      WHERE id = ? AND owner_email = ? AND ${leasePredicate}`, [
      input.openAIResponseId,
      input.previousResponseId,
      input.responseIdsJson,
      input.pendingInputJson ?? "[]",
      input.status,
      input.phase,
      input.roundCount,
      input.updatedAt,
      runId,
      ownerEmail,
      ...(input.leaseToken === undefined ? [] : [input.leaseToken]),
    ]);
    return changed(result);
  }

  async setPending(
    ownerEmail: string,
    runId: string,
    responseId: string,
    status: "queued" | "in_progress",
    phase: string,
    updatedAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET status = ?, phase = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND openai_response_id = ?
        AND status IN ('queued', 'in_progress')
        AND (status <> ? OR phase <> ?)`, [
      status,
      phase,
      updatedAt,
      runId,
      ownerEmail,
      responseId,
      status,
      phase,
    ]);
    return changed(result);
  }

  async updateProcessing(
    ownerEmail: string,
    runId: string,
    leaseToken: string,
    input: UpdateProcessingMessageRunInput,
  ) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET phase = ?, openai_response_id = ?, previous_response_id = ?, response_ids_json = ?,
        pending_input_json = ?, activities_json = ?, call_signatures_json = ?,
        round_count = ?, tool_call_count = ?, force_final = ?, proposal_staged = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?`, [
      input.phase,
      input.openAIResponseId,
      input.previousResponseId,
      input.responseIdsJson,
      input.pendingInputJson,
      input.activitiesJson,
      input.callSignaturesJson,
      input.roundCount,
      input.toolCallCount,
      Number(input.forceFinal),
      Number(input.proposalStaged),
      input.updatedAt,
      runId,
      ownerEmail,
      leaseToken,
    ]);
    return changed(result);
  }

  async getCall(ownerEmail: string, runId: string, callId: string) {
    await this.ready();
    return await this.d1.prepare(`${callSelect}
      WHERE owner_email = ? AND run_id = ? AND call_id = ?`)
      .bind(ownerEmail, runId, callId)
      .first<MessageRunCallRow>();
  }

  async beginCall(
    ownerEmail: string,
    runId: string,
    leaseToken: string,
    input: BeginMessageRunCallInput,
  ): Promise<BeginMessageRunCallResult> {
    await this.ready();
    const inserted = await this.d1.prepare(`INSERT OR IGNORE INTO assistant_message_run_calls (
      id, owner_email, run_id, call_id, call_signature, tool_name, arguments_json,
      output_json, activity_json, status, error_message, lease_token, created_at, updated_at
    ) SELECT ?, run.owner_email, run.id, ?, ?, ?, ?, NULL, NULL, 'processing', NULL, ?, ?, ?
      FROM assistant_message_runs AS run
      WHERE run.id = ? AND run.owner_email = ? AND run.status = 'processing'
        AND run.lease_token = ?`)
      .bind(
        input.id,
        input.callId,
        input.callSignature,
        input.toolName,
        input.argumentsJson,
        leaseToken,
        input.createdAt,
        input.createdAt,
        runId,
        ownerEmail,
        leaseToken,
      )
      .run();
    let call = await this.getCall(ownerEmail, runId, input.callId);
    if (!call) return { kind: "rejected", call: null };
    if (
      call.callSignature !== input.callSignature
      || call.toolName !== input.toolName
      || call.argumentsJson !== input.argumentsJson
    ) return { kind: "conflict", call };
    if (call.status !== "processing") return { kind: "replayed", call };
    if (changed(inserted)) return { kind: "created", call };
    const reclaimed = await this.update(`UPDATE assistant_message_run_calls
      SET lease_token = ?, updated_at = ?
      WHERE owner_email = ? AND run_id = ? AND call_id = ? AND status = 'processing'
        AND EXISTS (SELECT 1 FROM assistant_message_runs
          WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?)`, [
      leaseToken,
      input.createdAt,
      ownerEmail,
      runId,
      input.callId,
      runId,
      ownerEmail,
      leaseToken,
    ]);
    if (!changed(reclaimed)) return { kind: "rejected", call: null };
    call = await this.getCall(ownerEmail, runId, input.callId);
    return { kind: "reclaimed", call: call! };
  }

  async finishCall(
    ownerEmail: string,
    runId: string,
    callId: string,
    leaseToken: string,
    input: FinishMessageRunCallInput,
  ) {
    await this.ready();
    const results = await this.d1.batch([
      this.d1.prepare(`UPDATE assistant_message_run_calls
        SET status = ?, output_json = ?, activity_json = ?, error_message = ?, updated_at = ?
        WHERE owner_email = ? AND run_id = ? AND call_id = ? AND status = 'processing'
          AND lease_token = ? AND EXISTS (SELECT 1 FROM assistant_message_runs
            WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?)`)
        .bind(
          input.status,
          input.outputJson,
          input.activityJson,
          input.errorMessage,
          input.updatedAt,
          ownerEmail,
          runId,
          callId,
          leaseToken,
          runId,
          ownerEmail,
          leaseToken,
        ),
      this.d1.prepare(`UPDATE assistant_message_runs
        SET activities_json = ?, call_signatures_json = ?, tool_call_count = ?,
          proposal_staged = ?, phase = ?, updated_at = ?
        WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?
          AND EXISTS (SELECT 1 FROM assistant_message_run_calls
            WHERE owner_email = ? AND run_id = ? AND call_id = ? AND lease_token = ?
              AND status = ? AND updated_at = ?)`)
        .bind(
          input.activitiesJson,
          input.callSignaturesJson,
          input.toolCallCount,
          Number(input.proposalStaged),
          input.phase,
          input.updatedAt,
          runId,
          ownerEmail,
          leaseToken,
          ownerEmail,
          runId,
          callId,
          leaseToken,
          input.status,
          input.updatedAt,
        ),
    ]);
    return changed(results[0]) && changed(results[1]);
  }

  async succeed(
    ownerEmail: string,
    runId: string,
    leaseToken: string,
    input: SucceedMessageRunInput,
  ) {
    await this.ready();
    const results = await this.d1.batch([
      this.d1.prepare(`INSERT INTO assistant_messages (
        id, owner_email, thread_id, role, content, model, reasoning_effort,
        response_id, activities_json, created_at
      ) SELECT ?, run.owner_email, run.thread_id, 'assistant', ?, run.model,
        run.reasoning_effort, ?, ?, ?
        FROM assistant_message_runs AS run
        WHERE run.id = ? AND run.owner_email = ? AND run.status = 'processing'
          AND run.lease_token = ? AND run.assistant_message_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM assistant_messages WHERE id = ?)`)
        .bind(
          input.assistantMessageId,
          input.content,
          input.responseId,
          input.messageActivitiesJson,
          input.createdAt,
          runId,
          ownerEmail,
          leaseToken,
          input.assistantMessageId,
        ),
      this.d1.prepare(`UPDATE assistant_message_runs
        SET status = 'succeeded',
          phase = CASE WHEN proposal_staged = 1 THEN 'review_ready' ELSE 'synthesizing' END,
          assistant_message_id = ?,
          activities_json = ?, pending_input_json = '[]', call_signatures_json = '{}',
          error_code = NULL, error_message = NULL, error_retryable = 0,
          lease_token = NULL, lease_expires_at = NULL, updated_at = ?, expires_at = ?
        WHERE id = ? AND owner_email = ? AND status = 'processing' AND lease_token = ?
          AND assistant_message_id IS NULL AND EXISTS (SELECT 1 FROM assistant_messages
            WHERE id = ? AND owner_email = ? AND thread_id = assistant_message_runs.thread_id
              AND role = 'assistant' AND content = ? AND activities_json = ?)`)
        .bind(
          input.assistantMessageId,
          input.runActivitiesJson,
          input.createdAt,
          input.expiresAt,
          runId,
          ownerEmail,
          leaseToken,
          input.assistantMessageId,
          ownerEmail,
          input.content,
          input.messageActivitiesJson,
        ),
      this.d1.prepare(`UPDATE assistant_threads SET updated_at = ?
        WHERE owner_email = ? AND EXISTS (SELECT 1 FROM assistant_message_runs
          WHERE id = ? AND owner_email = ? AND thread_id = assistant_threads.id
            AND status = 'succeeded' AND assistant_message_id = ?)`)
        .bind(input.createdAt, ownerEmail, runId, ownerEmail, input.assistantMessageId),
    ]);
    return changed(results[1]);
  }

  async fail(
    ownerEmail: string,
    runId: string,
    error: MessageRunError,
    updatedAt: string,
    expiresAt: string,
    leaseToken?: string,
  ) {
    return await this.finishTerminal("failed", ownerEmail, runId, error, updatedAt, expiresAt, leaseToken);
  }

  async expire(
    ownerEmail: string,
    runId: string,
    error: MessageRunError,
    updatedAt: string,
    expiresAt: string,
    leaseToken?: string,
  ) {
    return await this.finishTerminal("expired", ownerEmail, runId, error, updatedAt, expiresAt, leaseToken);
  }

  async expireIfPast(
    ownerEmail: string,
    runId: string,
    error: MessageRunError,
    now: string,
    terminalExpiresAt: string,
  ) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET status = 'expired', phase = 'recovering', pending_input_json = '[]',
        call_signatures_json = '{}', error_code = ?, error_message = ?, error_retryable = ?,
        lease_token = NULL, lease_expires_at = NULL, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND status IN ${activeStatuses} AND expires_at <= ?`, [
      error.code,
      error.message,
      Number(error.retryable),
      now,
      terminalExpiresAt,
      runId,
      ownerEmail,
      now,
    ]);
    return changed(result);
  }

  async clearResponseIds(ownerEmail: string, runId: string) {
    const result = await this.update(`UPDATE assistant_message_runs
      SET openai_response_id = NULL, previous_response_id = NULL, response_ids_json = '[]'
      WHERE id = ? AND owner_email = ? AND status IN ${terminalStatuses}`, [runId, ownerEmail]);
    return changed(result);
  }

  async pruneExpired(before: string) {
    const result = await this.update(`DELETE FROM assistant_message_runs
      WHERE expires_at <= ? AND status IN ${terminalStatuses}`, [before]);
    return Number(result.meta.changes);
  }

  private async finishTerminal(
    status: "failed" | "expired",
    ownerEmail: string,
    runId: string,
    error: MessageRunError,
    updatedAt: string,
    expiresAt: string,
    leaseToken?: string,
  ) {
    const statusPredicate = leaseToken === undefined
      ? "status IN ('starting', 'queued', 'in_progress')"
      : "status = 'processing' AND lease_token = ?";
    const result = await this.update(`UPDATE assistant_message_runs
      SET status = ?, phase = 'recovering', pending_input_json = '[]', call_signatures_json = '{}',
        error_code = ?, error_message = ?, error_retryable = ?,
        lease_token = NULL, lease_expires_at = NULL, updated_at = ?, expires_at = ?
      WHERE id = ? AND owner_email = ? AND ${statusPredicate}`, [
      status,
      error.code,
      error.message,
      Number(error.retryable),
      updatedAt,
      expiresAt,
      runId,
      ownerEmail,
      ...(leaseToken === undefined ? [] : [leaseToken]),
    ]);
    return changed(result);
  }

  private async update(sql: string, values: unknown[]) {
    await this.ready();
    return this.d1.prepare(sql).bind(...values).run();
  }
}
