import assert from "node:assert/strict";
import test from "node:test";

import {
  AiGatewayResponseError,
  runDynamicRoute,
} from "../src/lib/server/ai-gateway.ts";

test("dynamic route uses the authenticated compat HTTP endpoint", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      { choices: [{ message: { content: "OK" } }] },
      { headers: { "cf-aig-log-id": "log-success" } },
    );
  };

  const result = await runDynamicRoute(
    { accountId: "account-id", gatewayId: "default", token: "test-token" },
    { model: "dynamic/rag", messages: [{ role: "user", content: "test" }] },
    { requestTimeoutMs: 120_000, metadata: { prompt_version: "test-v1" } },
    fetcher,
  );

  assert.deepEqual(result, { choices: [{ message: { content: "OK" } }] });
  assert.equal(
    calls[0].url,
    "https://gateway.ai.cloudflare.com/v1/account-id/default/compat/chat/completions",
  );
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("cf-aig-authorization"), "Bearer test-token");
  assert.equal(headers.get("cf-aig-skip-cache"), "true");
  assert.equal(headers.get("cf-aig-collect-log"), "true");
  assert.equal(headers.get("cf-aig-request-timeout"), "120000");
  assert.deepEqual(JSON.parse(headers.get("cf-aig-metadata")), {
    prompt_version: "test-v1",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: "dynamic/rag",
    messages: [{ role: "user", content: "test" }],
  });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("dynamic route reports bounded upstream errors with the gateway log id", async () => {
  const fetcher = async () =>
    new Response('{"error":"bad request"}', {
      status: 400,
      headers: { "cf-aig-log-id": "log-failure" },
    });

  await assert.rejects(
    runDynamicRoute(
      { accountId: "account-id", gatewayId: "default", token: "test-token" },
      { model: "dynamic/rag" },
      { requestTimeoutMs: 120_000, metadata: {} },
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
