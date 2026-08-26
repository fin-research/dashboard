import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  AiGatewayFallbackError,
  AiGatewayResponseError,
  generateAiGatewayObject,
} from "../src/lib/server/ai-gateway.ts";

const options = {
  requestTimeoutMs: 120_000,
  reasoningEffort: "low",
  metadata: { prompt_version: "test-v1" },
};

function responsesOutput(value, status = "completed") {
  return Response.json({
    id: "resp-test",
    object: "response",
    status,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
}

function createAiBinding(steps) {
  const calls = [];
  const ai = {
    aiGatewayLogId: null,
    gateway(gatewayId) {
      return {
        async run(request, runOptions) {
          calls.push({ gatewayId, request, runOptions });
          const step = steps.shift();
          if (!step) throw new Error("unexpected AI Gateway call");
          ai.aiGatewayLogId = step.logId ?? null;
          if (step.error) throw step.error;
          return step.response;
        },
      };
    },
  };
  return { ai, calls };
}

test("direct Responses call uses the binding, primary provider and strict JSON Schema", async () => {
  const { ai, calls } = createAiBinding([
    { response: responsesOutput({ ok: true }), logId: "log-primary" },
  ]);

  const output = await generateAiGatewayObject(
    ai,
    "default",
    [
      { role: "system", content: "system" },
      { role: "user", content: "test" },
    ],
    z.object({ ok: z.boolean() }).strict(),
    "probe",
    options,
  );

  assert.deepEqual(output, { ok: true });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.gatewayId, "default");
  assert.equal(call.request.provider, "custom-opencode");
  assert.equal(call.request.endpoint, "responses");
  assert.deepEqual(call.request.headers, {});
  assert.deepEqual(call.request.query, {
    model: "gpt-5.6-luna",
    instructions: "system",
    input: [{ role: "user", content: "test" }],
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "probe",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    },
  });
  assert.deepEqual(call.runOptions.gateway, {
    id: "default",
    skipCache: true,
    collectLog: true,
    requestTimeoutMs: 120_000,
    retries: { maxAttempts: 1 },
    metadata: {
      prompt_version: "test-v1",
      ai_model: "gpt-5.6-luna",
      ai_provider: "custom-opencode",
      ai_provider_attempt: "primary",
    },
  });
  assert.ok(call.runOptions.signal instanceof AbortSignal);
  assert.equal("max_output_tokens" in call.request.query, false);
  assert.equal("messages" in call.request.query, false);
  assert.equal("reasoning_effort" in call.request.query, false);
});

test("retryable primary failure falls back once to custom-codex", async () => {
  const { ai, calls } = createAiBinding([
    {
      response: new Response('{"error":"upstream unavailable"}', { status: 503 }),
      logId: "log-primary-failure",
    },
    { response: responsesOutput({ ok: true }), logId: "log-fallback" },
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const output = await generateAiGatewayObject(
      ai,
      "default",
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
    );
    assert.deepEqual(output, { ok: true });
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(
    calls.map((call) => call.request.provider),
    ["custom-opencode", "custom-codex"],
  );
  assert.deepEqual(
    calls.map((call) => call.runOptions.gateway.metadata.ai_provider_attempt),
    ["primary", "fallback"],
  );
});

test("business schema failure on the primary also triggers fallback", async () => {
  const { ai, calls } = createAiBinding([
    { response: responsesOutput({ ok: "yes" }), logId: "log-invalid-schema" },
    { response: responsesOutput({ ok: true }), logId: "log-valid-schema" },
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.doesNotReject(
      generateAiGatewayObject(
        ai,
        "default",
        [{ role: "user", content: "test" }],
        z.object({ ok: z.boolean() }).strict(),
        "probe",
        options,
      ),
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 2);
});

test("non-retryable primary 4xx is not masked by fallback", async () => {
  const { ai, calls } = createAiBinding([
    {
      response: new Response('{"error":"invalid model"}', { status: 400 }),
      logId: "log-bad-request",
    },
  ]);

  await assert.rejects(
    generateAiGatewayObject(
      ai,
      "default",
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
    ),
    (error) => {
      assert.ok(error instanceof AiGatewayResponseError);
      assert.equal(error.status, 400);
      assert.equal(error.gatewayLogId, "log-bad-request");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("local configuration errors are rejected before any provider call", async () => {
  const { ai, calls } = createAiBinding([]);
  await assert.rejects(
    generateAiGatewayObject(
      ai,
      "default",
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      { ...options, requestTimeoutMs: 300_001 },
    ),
    /request timeout must be an integer/,
  );
  assert.equal(calls.length, 0);
});

test("final failure preserves both provider attempts and log ids", async () => {
  const { ai } = createAiBinding([
    {
      response: new Response('{"error":"primary down"}', { status: 503 }),
      logId: "log-primary",
    },
    {
      response: new Response('{"error":"fallback down"}', { status: 502 }),
      logId: "log-fallback",
    },
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      generateAiGatewayObject(
        ai,
        "default",
        [{ role: "user", content: "test" }],
        z.object({ ok: z.boolean() }).strict(),
        "probe",
        options,
      ),
      (error) => {
        assert.ok(error instanceof AiGatewayFallbackError);
        assert.deepEqual(
          error.failures.map((failure) => [failure.provider, failure.gatewayLogId]),
          [
            ["custom-opencode", "log-primary"],
            ["custom-codex", "log-fallback"],
          ],
        );
        return true;
      },
    );
  } finally {
    console.warn = originalWarn;
  }
});
