import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createFilesystemTools } from "../src/tools/builtins/filesystem-tools.js";
import { PermissionPolicy } from "../src/tools/permission-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("filesystem tools provide global potential with external-path approval", async () => {
  const projectRoot = process.cwd();
  const workspace = await mkdtemp(path.join(projectRoot, ".test-tmp-"));
  const relativeWorkspace = path.relative(projectRoot, workspace);
  assert.ok(
    relativeWorkspace &&
      relativeWorkspace !== ".." &&
      !relativeWorkspace.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeWorkspace),
    "temporary test directory must remain inside the project",
  );

  try {
    await writeFile(path.join(workspace, "note.txt"), "hello workspace", "utf8");
    const registry = new ToolRegistry({
      permissionPolicy: new PermissionPolicy({ mode: "semi" }),
    }).registerAll(createFilesystemTools({ workspace }));

    const readResult = await registry.execute({
      function: { name: "read_text_file", arguments: { path: "note.txt" } },
    });
    assert.equal(readResult.ok, true);
    assert.equal(JSON.parse(readResult.content).result.content, "hello workspace");

    const listResult = await registry.execute({
      function: { name: "list_directory", arguments: { path: "." } },
    });
    assert.equal(listResult.ok, true);
    const listedEntries = JSON.parse(listResult.content).result.entries;
    assert.equal(listedEntries.length, 1);
    assert.equal(listedEntries[0].name, "note.txt");
    assert.equal(listedEntries[0].type, "file");
    assert.equal(listedEntries[0].path, path.join(workspace, "note.txt"));

    const externalWithoutApproval = await registry.execute({
      function: { name: "read_text_file", arguments: { path: "../package.json" } },
    });
    assert.equal(externalWithoutApproval.ok, false);
    assert.equal(externalWithoutApproval.errorCode, "APPROVAL_REQUIRED");

    const externalWithApproval = await registry.execute(
      { function: { name: "read_text_file", arguments: { path: "../package.json" } } },
      { requestApproval: async () => true },
    );
    assert.equal(externalWithApproval.ok, true);

    const createResult = await registry.execute({
      function: {
        name: "write_text_file",
        arguments: { path: "created.txt", content: "new", overwrite: false },
      },
    });
    assert.equal(createResult.ok, true);

    const overwriteWithoutApproval = await registry.execute({
      function: {
        name: "write_text_file",
        arguments: { path: "created.txt", content: "changed", overwrite: true },
      },
    });
    assert.equal(overwriteWithoutApproval.ok, false);
    assert.equal(overwriteWithoutApproval.errorCode, "APPROVAL_REQUIRED");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
