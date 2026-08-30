import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCommand,
  createCommandTools,
} from "../src/tools/builtins/command-tools.js";
import { PermissionPolicy } from "../src/tools/permission-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("command classifier distinguishes inspection, ambiguity, and destruction", () => {
  assert.equal(classifyCommand("powershell", "Get-ChildItem -Force").kind, "read_only");
  assert.equal(classifyCommand("cmd", "dir /a").kind, "read_only");
  assert.equal(classifyCommand("bash", "ls -la").kind, "read_only");
  assert.equal(classifyCommand("powershell", "Write-Output hello").kind, "ambiguous");
  assert.equal(
    classifyCommand("powershell", "Remove-Item -Recurse target").kind,
    "destructive",
  );
});

test("semi mode can execute read-only PowerShell and requires approval for ambiguity", async () => {
  const registry = new ToolRegistry({
    permissionPolicy: new PermissionPolicy({ mode: "semi" }),
  }).registerAll(
    createCommandTools({ workspace: process.cwd(), defaultTimeoutMs: 30_000 }),
  );

  const inspection = await registry.execute({
    function: {
      name: "execute_command",
      arguments: { shell: "powershell", command: "Get-Location" },
    },
  });
  assert.equal(inspection.ok, true);
  assert.equal(JSON.parse(inspection.content).result.exitCode, 0);

  const ambiguous = await registry.execute({
    function: {
      name: "execute_command",
      arguments: { shell: "powershell", command: "Write-Output arsenal-ready" },
    },
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errorCode, "APPROVAL_REQUIRED");

  const approved = await registry.execute(
    {
      function: {
        name: "execute_command",
        arguments: { shell: "powershell", command: "Write-Output arsenal-ready" },
      },
    },
    { requestApproval: async () => true },
  );
  assert.equal(approved.ok, true);
  assert.match(JSON.parse(approved.content).result.stdout, /arsenal-ready/);
});

test("destructive and elevated commands never auto-run in semi mode", async () => {
  const registry = new ToolRegistry({
    permissionPolicy: new PermissionPolicy({ mode: "semi" }),
  }).registerAll(createCommandTools({ workspace: process.cwd() }));

  const destructive = await registry.execute({
    function: {
      name: "execute_command",
      arguments: { shell: "powershell", command: "Remove-Item imaginary-target" },
    },
  });
  assert.equal(destructive.ok, false);
  assert.equal(destructive.errorCode, "APPROVAL_REQUIRED");

  const elevated = await registry.execute({
    function: {
      name: "execute_command",
      arguments: {
        shell: "powershell",
        command: "Get-Process",
        run_as_admin: true,
      },
    },
  });
  assert.equal(elevated.ok, false);
  assert.equal(elevated.errorCode, "APPROVAL_REQUIRED");

  const globalRead = await registry.execute({
    function: {
      name: "execute_command",
      arguments: {
        shell: "powershell",
        command: "Get-ChildItem C:\\Windows",
      },
    },
  });
  assert.equal(globalRead.ok, false);
  assert.equal(globalRead.errorCode, "APPROVAL_REQUIRED");
});
