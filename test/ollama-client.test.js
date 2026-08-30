import assert from "node:assert/strict";
import test from "node:test";

import {
  OllamaConnectionError,
  RequestAbortedError,
} from "../src/core/errors.js";
import { OllamaClient } from "../src/llm/ollama-client.js";

test("Ollama client sends the configured cloud model and native tools", async () => {
  const requests = [];
  const client = new OllamaClient({
    model: "gpt-oss:120b-cloud",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "ready" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const response = await client.chat({
    messages: [{ role: "user", content: "hello" }],
    tools: [{
      type: "function",
      function: {
        name: "example",
        description: "Example",
        parameters: { type: "object", properties: {} },
      },
    }],
  });

  const body = JSON.parse(requests[0].options.body);
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(body.model, "gpt-oss:120b-cloud");
  assert.equal(body.stream, false);
  assert.equal(body.think, true);
  assert.equal(body.tools[0].function.name, "example");
  assert.equal(response.message.content, "ready");
});

test("Ollama client turns network errors into actionable connection errors", async () => {
  const client = new OllamaClient({
    model: "gpt-oss:120b-cloud",
    timeoutMs: 1_000,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    () => client.healthcheck(),
    (error) =>
      error instanceof OllamaConnectionError &&
      error.message.includes("Ensure Ollama is installed"),
  );
});

test("Ollama client preserves explicit user cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new OllamaClient({
    model: "gpt-oss:120b-cloud",
    fetchImpl: async () => {
      throw new DOMException("aborted", "AbortError");
    },
  });

  await assert.rejects(
    () => client.healthcheck({ signal: controller.signal }),
    RequestAbortedError,
  );
});
