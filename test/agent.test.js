import assert from "node:assert/strict";
import test from "node:test";

import { Agent } from "../src/core/agent.js";
import { Conversation } from "../src/core/conversation.js";
import { NullLogger } from "../src/infra/jsonl-logger.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("agent executes a tool and feeds the observation back to the model", async () => {
  const requests = [];
  const responses = [
    {
      message: {
        role: "assistant",
        content: "",
        thinking: "hidden",
        tool_calls: [
          { function: { name: "echo_text", arguments: { text: "observed" } } },
        ],
      },
    },
    { message: { role: "assistant", content: "The result was observed." } },
  ];
  const client = {
    async chat(request) {
      requests.push(structuredClone(request));
      return responses.shift();
    },
  };
  const tools = new ToolRegistry().register({
    name: "echo_text",
    description: "Echo text.",
    risk: "read",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string" } },
    },
    async execute({ text }) {
      return text;
    },
  });
  const conversation = new Conversation({ systemPrompt: "System" });
  const agent = new Agent({
    client,
    conversation,
    toolRegistry: tools,
    logger: new NullLogger(),
  });

  const result = await agent.send("Use the tool");

  assert.equal(result.content, "The result was observed.");
  assert.equal(result.rounds, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.equal(requests[1].messages.at(-1).tool_name, "echo_text");
  assert.equal(conversation.completedTurnCount, 1);
});

test("agent discards a partial turn when the model request fails", async () => {
  const conversation = new Conversation({ systemPrompt: "System" });
  const agent = new Agent({
    client: {
      async chat() {
        throw new Error("offline");
      },
    },
    conversation,
    toolRegistry: new ToolRegistry(),
    logger: new NullLogger(),
  });

  await assert.rejects(() => agent.send("hello"), /offline/);
  assert.equal(conversation.hasActiveTurn, false);
  assert.deepEqual(conversation.messages(), [{ role: "system", content: "System" }]);
});

test("agent has no fixed tool-round ceiling", async () => {
  let modelCalls = 0;
  let toolExecutions = 0;
  const client = {
    async chat() {
      modelCalls += 1;
      if (modelCalls <= 12) {
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "keep_working", arguments: {} } }],
          },
        };
      }
      return { message: { role: "assistant", content: "finished" } };
    },
  };
  const registry = new ToolRegistry().register({
    name: "keep_working",
    description: "Continue a test.",
    risk: "read",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      toolExecutions += 1;
      return toolExecutions;
    },
  });
  const agent = new Agent({
    client,
    conversation: new Conversation({ systemPrompt: "System" }),
    toolRegistry: registry,
    logger: new NullLogger(),
  });

  const result = await agent.send("Keep going until finished");
  assert.equal(result.content, "finished");
  assert.equal(result.rounds, 13);
  assert.equal(result.toolCalls, 12);
});
