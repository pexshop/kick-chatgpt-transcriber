import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = {
  OPENAI_API_KEY: "test-openai-key",
  API_TOKEN: "test-api-token"
};

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const request = new Request("https://worker.test" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return worker.fetch(request, env);
}

test("GET /health returns healthy status", async () => {
  const response = await call("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("GET / returns service metadata and MCP route", async () => {
  const response = await call("/");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.name, "Kick ChatGPT Transcriber");
  assert.equal(data.endpoints.mcp, "POST /mcp");
});

test("MCP rejects requests without authentication", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    headers: { "content-type": "application/json" }
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("MCP initialize returns the supported protocol and server info", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token"
    }
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.protocolVersion, "2025-03-26");
  assert.equal(data.result.serverInfo.name, "kick-chatgpt-transcriber");
  assert.ok(data.result.capabilities.tools);
});

test("MCP tools/list exposes transcribe_audio", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token"
    }
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.tools[0].name, "transcribe_audio");
  assert.deepEqual(data.result.tools[0].inputSchema.required, ["file_base64", "filename"]);
});

test("MCP ping returns an empty result", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 3, method: "ping" },
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token"
    }
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.result, {});
});

test("MCP unknown method returns JSON-RPC method-not-found", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 4, method: "not/a/method" },
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token"
    }
  });
  const data = await response.json();
  assert.equal(data.error.code, -32601);
});

test("MCP initialized notification returns 202 without a body", async () => {
  const response = await call("/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-api-token"
    }
  });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("OPTIONS returns CORS preflight response", async () => {
  const response = await call("/mcp", { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
});
