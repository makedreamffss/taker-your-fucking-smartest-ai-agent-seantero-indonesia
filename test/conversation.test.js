import assert from "node:assert/strict";
import test from "node:test";

import { Conversation } from "../src/core/conversation.js";

test("conversation trims whole turns rather than orphaning tool results", () => {
  const conversation = new Conversation({
    systemPrompt: "System",
    maxTurns: 1,
  });

  conversation.startUserTurn("first");
  conversation.appendAssistant({
    role: "assistant",
    content: "",
    tool_calls: [{ function: { name: "example", arguments: {} } }],
  });
  conversation.appendTool({ name: "example", content: "result" });
  conversation.appendAssistant({ role: "assistant", content: "first answer" });
  conversation.finishTurn();

  conversation.startUserTurn("second");
  conversation.appendAssistant({ role: "assistant", content: "second answer" });
  conversation.finishTurn();

  assert.deepEqual(conversation.messages(), [
    { role: "system", content: "System" },
    { role: "user", content: "second" },
    { role: "assistant", content: "second answer" },
  ]);
});

test("aborted turns do not remain in model context", () => {
  const conversation = new Conversation({ systemPrompt: "System" });
  conversation.startUserTurn("discard me");
  conversation.abortTurn();

  assert.deepEqual(conversation.messages(), [{ role: "system", content: "System" }]);
});
