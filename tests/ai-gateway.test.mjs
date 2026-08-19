import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  AiGatewayResponseError,
  generateDynamicRouteObject,
  generateDynamicRouteText,
} from "../src/lib/server/ai-gateway.ts";

const credentials = {
  accountId: "account-id",
  gatewayId: "default",
  token: "test-token",
};

const options = {
  requestTimeoutMs: 120_000,
  maxRetries: 0,
  reasoningEffort: "low",
  enableThinking: false,
  metadata: { prompt_version: "test-v1" },
};

function chatCompletion(content) {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "gpt-5.6-luna",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: null },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

test("AI SDK uses the authenticated compat endpoint and verified parameter allowlist", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return chatCompletion("OK");
  };

  const output = await generateDynamicRouteText(
    credentials,
    [{ role: "user", content: "test" }],
    options,
    fetcher,
  );

  assert.equal(output, "OK");
  assert.equal(
    calls[0].url,
    "https://gateway.ai.cloudflare.com/v1/account-id/default/compat/chat/completions",
  );
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("cf-aig-authorization"), "Bearer test-token");
  assert.equal(headers.get("cf-aig-skip-cache"), "true");
  assert.equal(headers.get("cf-aig-collect-log"), "true");
  assert.equal(headers.get("cf-aig-request-timeout"), "120000");
  assert.deepEqual(JSON.parse(headers.get("cf-aig-metadata")), options.metadata);
  const query = JSON.parse(calls[0].init.body);
  assert.deepEqual(
    {
      model: query.model,
      temperature: query.temperature,
      reasoning_effort: query.reasoning_effort,
      chat_template_kwargs: query.chat_template_kwargs,
      messages: query.messages,
    },
    {
      model: "dynamic/rag",
      temperature: 0.1,
      reasoning_effort: "low",
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "user", content: "test" }],
    },
  );
  for (const rejected of ["top_p", "top_k", "repetition_penalty", "seed", "max_completion_tokens"]) {
    assert.equal(rejected in query, false);
  }
});

test("AI SDK sends one standard JSON Schema and returns a validated object", async () => {
  let query;
  const fetcher = async (_url, init) => {
    query = JSON.parse(init.body);
    return chatCompletion('{"ok":true}');
  };

  const output = await generateDynamicRouteObject(
    credentials,
    [{ role: "user", content: "test" }],
    z.object({ ok: z.boolean() }).strict(),
    "probe",
    options,
    fetcher,
  );

  assert.deepEqual(output, { ok: true });
  assert.equal(query.response_format.type, "json_schema");
  assert.equal(query.response_format.json_schema.name, "probe");
  assert.equal(query.response_format.json_schema.strict, true);
  assert.deepEqual(query.response_format.json_schema.schema.required, ["ok"]);
  assert.equal(query.response_format.json_schema.schema.additionalProperties, false);
  assert.match(query.messages[0].content, /"required":\["ok"\]/);
  assert.deepEqual(query.messages[1], { role: "user", content: "test" });
});

test("AI SDK rejects JSON that does not satisfy the response schema", async () => {
  const fetcher = async () => chatCompletion('{"ok":"yes"}');

  await assert.rejects(
    generateDynamicRouteObject(
      credentials,
      [{ role: "user", content: "test" }],
      z.object({ ok: z.boolean() }).strict(),
      "probe",
      options,
      fetcher,
    ),
    (error) => {
      assert.equal(error.name, "AI_NoObjectGeneratedError");
      assert.match(error.message, /did not match schema/);
      return true;
    },
  );
});

test("dynamic route reports bounded upstream errors with the gateway log id", async () => {
  const fetcher = async () =>
    new Response('{"error":"bad request"}', {
      status: 400,
      headers: { "cf-aig-log-id": "log-failure" },
    });

  await assert.rejects(
    generateDynamicRouteText(
      credentials,
      [{ role: "user", content: "test" }],
      options,
      fetcher,
    ),
    (error) => {
      assert.ok(error instanceof AiGatewayResponseError);
      assert.equal(error.status, 400);
      assert.equal(error.gatewayLogId, "log-failure");
      assert.match(error.message, /bad request/);
      return true;
    },
  );
});
