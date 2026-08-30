import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemPrompt } from "../src/core/system-prompt.js";

test("system prompt does not disclose the machine-specific workspace path", () => {
  const privatePath =
    "C:\\Users\\private-local-name\\OneDrive\\Desktop\\Taker Takeover";
  const prompt = buildSystemPrompt({ workspace: privatePath });

  assert.doesNotMatch(prompt, /private-local-name/i);
  assert.doesNotMatch(prompt, /C:\\Users\\/i);
  assert.match(prompt, /configured project workspace/i);
});
