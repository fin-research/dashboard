import assert from "node:assert/strict";
import test from "node:test";

import {
  AiGatewayResponseError,
  runDynamicRoute,
} from "../src/lib/server/ai-gateway.ts";

test("dynamic route uses the authenticated compat gateway binding", async () => {
  const calls = [];
  const ai = {
    gateway: (gatewayId) => ({
      run: async (request, options) => {
        calls.push({ gatewayId, request, options });
        return Response.json(
          { choices: [{ message: { content: "OK" } }] },
          { headers: { "cf-aig-log-id": "log-success" } },
        );
      },
    }),
  };

  const result = await runDynamicRoute(
    ai,
    "default",
    { model: "dynamic/rag", messages: [{ role: "user", content: "test" }] },
    { requestTimeoutMs: 120_000, metadata: { prompt_version: "test-v1" } },
  );

  assert.deepEqual(result, { choices: [{ message: { content: "OK" } }] });
  assert.equal(calls[0].gatewayId, "default");
  assert.equal(calls[0].request.provider, "compat");
  assert.equal(calls[0].request.endpoint, "chat/completions");
  assert.equal(calls[0].request.query.model, "dynamic/rag");
  assert.equal(calls[0].request.headers["cf-aig-skip-cache"], true);
  assert.deepEqual(calls[0].request.headers["cf-aig-metadata"], {
    prompt_version: "test-v1",
  });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("dynamic route reports bounded upstream errors with the gateway log id", async () => {
  const ai = {
    gateway: () => ({
      run: async () =>
        new Response('{"error":"bad request"}', {
          status: 400,
          headers: { "cf-aig-log-id": "log-failure" },
        }),
    }),
  };

  await assert.rejects(
    runDynamicRoute(ai, "default", { model: "dynamic/rag" }, {
      requestTimeoutMs: 120_000,
      metadata: {},
    }),
    (error) => {
      assert.ok(error instanceof AiGatewayResponseError);
      assert.equal(error.status, 400);
      assert.equal(error.gatewayLogId, "log-failure");
      assert.match(error.message, /bad request/);
      return true;
    },
  );
});
