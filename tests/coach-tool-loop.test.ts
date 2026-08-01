import assert from "node:assert/strict";
import test from "node:test";
import { runCoachToolLoop, type CoachResponse } from "../server/coach-tool-loop";

const formatError = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

test("continues through more than six sequential tool calls before returning the final answer", async () => {
  const responses: CoachResponse[] = Array.from({ length: 12 }, (_, index) => ({
    id: `response-${index + 1}`,
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "function_call",
        call_id: `call-${index + 1}`,
        name: "lookup",
        arguments: JSON.stringify({ index }),
      },
    ],
  }));
  responses.push({
    id: "response-final",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }],
  });

  const requests: Array<{ conversation: unknown[]; toolChoice: string }> = [];
  const executions: Array<Record<string, unknown>> = [];
  const records: Array<{ name: string; status: string }> = [];
  const result = await runCoachToolLoop({
    conversation: [{ role: "user", content: "Inspect everything" }],
    createResponse: async (conversation, toolChoice) => {
      requests.push({ conversation: structuredClone(conversation), toolChoice });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async ({ argumentsValue }) => {
      executions.push(argumentsValue);
      return { inspected: argumentsValue.index };
    },
    recordToolCall: async ({ name, status }) => {
      records.push({ name, status });
    },
    formatError,
  });

  assert.deepEqual(result, { text: "Done", responseId: "response-final" });
  assert.equal(requests.length, 13);
  assert.equal(executions.length, 12);
  assert.equal(records.length, 12);
  assert.ok(records.every((record) => record.name === "lookup" && record.status === "succeeded"));
  assert.ok(requests.every((request) => request.toolChoice === "auto"));
  for (let index = 0; index < 12; index += 1) {
    const nextConversation = requests[index + 1]?.conversation as Array<Record<string, unknown>>;
    assert.ok(nextConversation.some((item) => item.call_id === `call-${index + 1}`));
    assert.ok(nextConversation.some((item) => item.type === "function_call_output" && item.call_id === `call-${index + 1}`));
  }
});

test("returns tool failures to the model and keeps the loop running", async () => {
  const responses: CoachResponse[] = [
    {
      id: "response-tool",
      status: "completed",
      output: [{ type: "function_call", call_id: "call-bad", name: "lookup", arguments: "{" }],
    },
    {
      id: "response-final",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Recovered" }] }],
    },
  ];
  let executions = 0;
  const records: Array<{ argumentsValue: Record<string, unknown>; output: unknown; status: string }> = [];
  let finalConversation: unknown[] = [];
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async (conversation) => {
      finalConversation = structuredClone(conversation);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => {
      executions += 1;
      return {};
    },
    recordToolCall: async (record) => {
      records.push(record);
    },
    formatError,
  });

  assert.equal(result.text, "Recovered");
  assert.equal(executions, 0);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.argumentsValue, {});
  assert.equal(records[0]?.status, "failed");
  const failureOutput = (finalConversation as Array<Record<string, unknown>>)
    .find((item) => item.type === "function_call_output")?.output;
  assert.match(String(failureOutput), /JSON|position|property name/i);
});

test("forces a final response when the same tool call repeats without progress", async () => {
  const repeatedCall = {
    type: "function_call",
    call_id: "",
    name: "lookup",
    arguments: JSON.stringify({ routineId: "routine-a" }),
  };
  const responses: CoachResponse[] = [1, 2, 3].map((index) => ({
    id: `response-${index}`,
    status: "completed",
    output: [{ ...repeatedCall, call_id: `call-${index}` }],
  }));
  responses.push({
    id: "response-final",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "Using the existing result." }] }],
  });

  const choices: string[] = [];
  let finalSynthesisConversation: unknown[] = [];
  let executions = 0;
  const statuses: string[] = [];
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async (conversation, toolChoice) => {
      choices.push(toolChoice);
      if (toolChoice === "none") finalSynthesisConversation = structuredClone(conversation);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => {
      executions += 1;
      return { routine: "A" };
    },
    recordToolCall: async ({ status }) => {
      statuses.push(status);
    },
    formatError,
  });

  assert.equal(result.text, "Using the existing result.");
  assert.equal(executions, 2);
  assert.deepEqual(statuses, ["succeeded", "succeeded", "failed"]);
  assert.deepEqual(choices, ["auto", "auto", "auto", "none"]);
  assert.ok((finalSynthesisConversation as Array<Record<string, unknown>>)
    .some((item) => item.type === "function_call" && item.call_id === "call-3"));
  assert.ok((finalSynthesisConversation as Array<Record<string, unknown>>)
    .some((item) => item.type === "function_call_output" && item.call_id === "call-3"));
});

test("does not execute the same write tool twice", async () => {
  const argumentVariants = [
    '{"routineId":"routine-a","options":{"sets":3,"reps":8},"baseVersionId":"version-1"}',
    '{"baseVersionId":"version-1","options":{"reps":8,"sets":3},"routineId":"routine-a"}',
  ];
  const responses: CoachResponse[] = [1, 2].map((index) => ({
    id: `response-${index}`,
    status: "completed",
    output: [{
      type: "function_call",
      call_id: `call-${index}`,
      name: "propose_routine_change",
      arguments: argumentVariants[index - 1],
    }],
  }));
  responses.push({
    id: "response-final",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "The plan is ready." }] }],
  });
  let executions = 0;
  const statuses: string[] = [];
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => {
      executions += 1;
      return { planId: "plan-1" };
    },
    recordToolCall: async ({ status }) => {
      statuses.push(status);
    },
    formatError,
    isWriteTool: (name) => name === "propose_routine_change",
  });

  assert.equal(result.text, "The plan is ready.");
  assert.equal(executions, 1);
  assert.deepEqual(statuses, ["succeeded", "failed"]);
});

test("switches to final synthesis after the soft run-duration budget", async () => {
  const responses: CoachResponse[] = [
    {
      id: "response-tool",
      status: "completed",
      output: [{ type: "function_call", call_id: "call-1", name: "lookup", arguments: '{"page":1}' }],
    },
    {
      id: "response-final",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Here is what I found so far." }] }],
    },
  ];
  const times = [0, 0, 1_001];
  const choices: string[] = [];
  let executions = 0;
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async (_conversation, toolChoice) => {
      choices.push(toolChoice);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => {
      executions += 1;
      return { page: 1 };
    },
    recordToolCall: async () => undefined,
    formatError,
    maxRunDurationMs: 1_000,
    now: () => times.shift() ?? 1_001,
  });

  assert.equal(result.text, "Here is what I found so far.");
  assert.equal(executions, 1);
  assert.deepEqual(choices, ["auto", "none"]);
});

test("counts repeated malformed calls toward the no-progress safeguard", async () => {
  const responses: CoachResponse[] = [1, 2, 3].map((index) => ({
    id: `response-${index}`,
    status: "completed",
    output: [{ type: "function_call", call_id: `call-${index}`, name: "lookup", arguments: "{" }],
  }));
  responses.push({
    id: "response-final",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "I could not complete that lookup." }] }],
  });
  const choices: string[] = [];
  let executions = 0;
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async (_conversation, toolChoice) => {
      choices.push(toolChoice);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => {
      executions += 1;
      return {};
    },
    recordToolCall: async () => undefined,
    formatError,
  });

  assert.equal(result.text, "I could not complete that lookup.");
  assert.equal(executions, 0);
  assert.deepEqual(choices, ["auto", "auto", "auto", "none"]);
});

test("reports output-token exhaustion instead of treating it as an empty answer", async () => {
  await assert.rejects(
    runCoachToolLoop({
      conversation: [],
      createResponse: async () => ({
        id: "response-incomplete",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
      executeTool: async () => ({}),
      recordToolCall: async () => undefined,
      formatError,
    }),
    /ran out of response capacity/i,
  );
});

test("fails closed when the provider omits the response status", async () => {
  await assert.rejects(
    runCoachToolLoop({
      conversation: [],
      createResponse: async () => ({ id: "response-no-status", output: [] }),
      executeTool: async () => ({}),
      recordToolCall: async () => undefined,
      formatError,
    }),
    /status undefined/i,
  );
});

test("does not discard a successful tool result when audit logging fails", async () => {
  const responses: CoachResponse[] = [
    {
      id: "response-tool",
      status: "completed",
      output: [{ type: "function_call", call_id: "call-1", name: "lookup", arguments: "{}" }],
    },
    {
      id: "response-final",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Finished" }] }],
    },
  ];
  const auditErrors: unknown[] = [];
  const result = await runCoachToolLoop({
    conversation: [],
    createResponse: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    executeTool: async () => ({ ok: true }),
    recordToolCall: async () => {
      throw new Error("audit unavailable");
    },
    formatError,
    reportAuditError: (error) => auditErrors.push(error),
  });

  assert.equal(result.text, "Finished");
  assert.equal(auditErrors.length, 1);
});
