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

test("system prompt defines the restrained operator personality", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /restrained, dry, direct, and quietly formidable/i);
  assert.match(prompt, /Work first and speak second/i);
  assert.match(prompt, /Avoid filler such as/i);
  assert.match(prompt, /Never perform confidence/i);
});
