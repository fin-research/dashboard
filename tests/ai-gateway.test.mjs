import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  AiGatewayFallbackError,
  AiGatewayResponseError,
  generateAiGatewayObject,
} from "../src/lib/server/ai-gateway.ts";

const credentials = {
  accountId: "account-id",
  gatewayId: "default",
  token: "test-token",
};

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

async function withoutAiLogs(run) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const logs = [];
  console.log = (value) => logs.push(String(value));
  console.warn = () => {};
  try {
    return { value: await run(), logs };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

test("direct Responses call uses the custom-opencode provider-specific URL", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return responsesOutput({ ok: true });
  };

  const { value: output, logs } = await withoutAiLogs(() =>
    generateAiGatewayObject(
      credentials,
      [
        { role: "system", content: "system" },
        { role: "user", content: "test" },
      ],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
  );

  assert.deepEqual(output, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://gateway.ai.cloudflare.com/v1/account-id/default/custom-opencode/responses",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("cf-aig-authorization"), "Bearer test-token");
  assert.equal(headers.get("cf-aig-skip-cache"), "true");
  assert.equal(headers.get("cf-aig-collect-log"), "true");
  assert.equal(headers.get("cf-aig-request-timeout"), "120000");
  assert.deepEqual(JSON.parse(headers.get("cf-aig-metadata")), {
    prompt_version: "test-v1",
    ai_model: "gpt-5.6-luna",
    ai_provider: "custom-opencode",
    ai_provider_attempt: "primary",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
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
  assert.match(logs[0], /"provider":"custom-opencode"/);
});

test("retryable primary failure falls back once to direct custom-codex", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response('{"error":{"message":"upstream unavailable"}}', {
        status: 503,
        headers: { "cf-aig-log-id": "log-primary" },
      });
    }
    return responsesOutput({ ok: true });
  };

  const { value: output } = await withoutAiLogs(() =>
    generateAiGatewayObject(
      credentials,
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
  );

  assert.deepEqual(output, { ok: true });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://gateway.ai.cloudflare.com/v1/account-id/default/custom-opencode/responses",
      "https://gateway.ai.cloudflare.com/v1/account-id/default/custom-codex/responses",
    ],
  );
  assert.deepEqual(
    calls.map(
      (call) => JSON.parse(new Headers(call.init.headers).get("cf-aig-metadata"))
        .ai_provider_attempt,
    ),
    ["primary", "fallback"],
  );
});

test("business schema failure on the primary triggers custom-codex", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1
      ? responsesOutput({ ok: "yes" })
      : responsesOutput({ ok: true });
  };

  const { value } = await withoutAiLogs(() =>
    generateAiGatewayObject(
      credentials,
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
  );
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 2);
});

test("provider response bodies are bounded before parsing", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1
      ? new Response("", { headers: { "content-length": "2097153" } })
      : responsesOutput({ ok: true });
  };

  const { value } = await withoutAiLogs(() =>
    generateAiGatewayObject(
      credentials,
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
  );
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 2);
});

test("non-retryable primary 4xx is not masked by fallback", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response('{"error":{"message":"invalid model"}}', {
      status: 400,
      headers: { "cf-aig-log-id": "log-bad-request" },
    });
  };

  await assert.rejects(
    generateAiGatewayObject(
      credentials,
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
    (error) => {
      assert.ok(error instanceof AiGatewayResponseError);
      assert.equal(error.provider, "custom-opencode");
      assert.equal(error.status, 400);
      assert.equal(error.gatewayLogId, "log-bad-request");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("local configuration errors are rejected before a provider call", async () => {
  let calls = 0;
  await assert.rejects(
    generateAiGatewayObject(
      { ...credentials, token: "" },
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      async () => {
        calls += 1;
        return responsesOutput({ ok: true });
      },
    ),
    /authentication token is not configured/,
  );
  assert.equal(calls, 0);
});

test("final failure preserves both provider attempts and log ids", async () => {
  const fetcher = async (url) => {
    const fallback = String(url).includes("custom-codex");
    return new Response(
      JSON.stringify({ error: { message: fallback ? "fallback down" : "primary down" } }),
      {
        status: fallback ? 502 : 503,
        headers: { "cf-aig-log-id": fallback ? "log-fallback" : "log-primary" },
      },
    );
  };

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      generateAiGatewayObject(
        credentials,
        [{ role: "user", content: "test" }],
        z.object({ ok: z.boolean() }).strict(),
        "probe",
        options,
        fetcher,
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
        assert.match(error.message, /log-primary/);
        assert.match(error.message, /log-fallback/);
        return true;
      },
    );
  } finally {
    console.warn = originalWarn;
  }
});
