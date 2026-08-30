import assert from "node:assert/strict";
import test from "node:test";

import { PermissionPolicy } from "../src/tools/permission-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";

function makeTool(overrides = {}) {
  return {
    name: "echo_text",
    description: "Echo text for a test.",
    risk: "read",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string" } },
    },
    async execute({ text }) {
      return { text };
    },
    ...overrides,
  };
}

test("registry validates and executes a structured tool call", async () => {
  const registry = new ToolRegistry().register(makeTool());
  const result = await registry.execute({
    function: { name: "echo_text", arguments: { text: "hello" } },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.content), {
    ok: true,
    result: { text: "hello" },
  });
});

test("registry returns invalid arguments as an observation", async () => {
  const registry = new ToolRegistry().register(makeTool());
  const result = await registry.execute({
    function: { name: "echo_text", arguments: { unexpected: true } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "INVALID_TOOL_INPUT");
});

test("approval mode requires confirmation but does not restrict capability", async () => {
  let executed = false;
  const registry = new ToolRegistry({
    permissionPolicy: new PermissionPolicy({ mode: "approval" }),
  }).register(
    makeTool({
      name: "write_text",
      risk: "write",
      async execute() {
        executed = true;
      },
    }),
  );

  const result = await registry.execute({
    function: { name: "write_text", arguments: { text: "blocked" } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "APPROVAL_REQUIRED");
  assert.equal(executed, false);

  const approvedResult = await registry.execute(
    { function: { name: "write_text", arguments: { text: "approved" } } },
    { requestApproval: async () => true },
  );
  assert.equal(approvedResult.ok, true);
  assert.equal(executed, true);
});

test("semi mode auto-runs a tool only when its assessment marks it safe", async () => {
  let executed = false;
  const registry = new ToolRegistry({
    permissionPolicy: new PermissionPolicy({ mode: "semi" }),
  }).register(
    makeTool({
      name: "create_safe_file",
      risk: "write",
      async assess() {
        return {
          ambiguous: false,
          safeInSemiAutonomous: true,
          reason: "Test-only safe creation.",
        };
      },
      async execute() {
        executed = true;
        return "done";
      },
    }),
  );

  const result = await registry.execute({
    function: { name: "create_safe_file", arguments: { text: "safe" } },
  });
  assert.equal(result.ok, true);
  assert.equal(executed, true);
});
