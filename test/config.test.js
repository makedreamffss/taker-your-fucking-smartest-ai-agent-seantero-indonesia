import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { ConfigurationError } from "../src/core/errors.js";

test("configuration defaults to the requested Ollama cloud model", () => {
  const workspace = path.resolve("example-workspace");
  const config = loadConfig({}, workspace);

  assert.equal(config.model, "gpt-oss:120b-cloud");
  assert.equal(config.ollamaBaseUrl, "http://127.0.0.1:11434");
  assert.equal(config.workspace, workspace);
  assert.equal(config.approvalMode, "approval");
  assert.equal(config.commandTimeoutMs, 120_000);
});

test("configuration keeps its log path inside the workspace", () => {
  const workspace = path.resolve("example-workspace");

  assert.throws(
    () => loadConfig({ AGENT_LOG_PATH: "../outside.jsonl" }, workspace),
    ConfigurationError,
  );
});

test("configuration rejects unsafe numeric limits", () => {
  assert.throws(
    () => loadConfig({ AGENT_COMMAND_TIMEOUT_MS: "0" }),
    /must be an integer from 1000 through 3600000/,
  );
});

test("configuration accepts only explicit approval modes", () => {
  assert.equal(loadConfig({ AGENT_APPROVAL_MODE: "semi" }).approvalMode, "semi");
  assert.throws(
    () => loadConfig({ AGENT_APPROVAL_MODE: "unrestricted" }),
    /must be one of: approval, semi/,
  );
});
