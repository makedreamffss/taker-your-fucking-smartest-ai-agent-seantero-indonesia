import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createFilesystemTools } from "../src/tools/builtins/filesystem-tools.js";
import { PermissionPolicy } from "../src/tools/permission-policy.js";
import { ToolRegistry } from "../src/tools/registry.js";

test("text editing requires approval and an exact full-file hash", async () => {
  const projectRoot = process.cwd();
  const workspace = await mkdtemp(path.join(projectRoot, ".test-tmp-"));
  const target = path.join(workspace, "note.txt");
  const original = "alpha beta alpha";
  const expectedSha256 = createHash("sha256")
    .update(original, "utf8")
    .digest("hex");

  try {
    await writeFile(target, original, "utf8");
    const registry = new ToolRegistry({
      permissionPolicy: new PermissionPolicy({ mode: "semi" }),
    }).registerAll(createFilesystemTools({ workspace }));
    const call = {
      function: {
        name: "edit_text_file",
        arguments: {
          path: "note.txt",
          expected_sha256: expectedSha256,
          edits: [
            {
              old_text: "alpha",
              new_text: "gamma",
              expected_occurrences: 2,
            },
          ],
        },
      },
    };

    const withoutApproval = await registry.execute(call);
    assert.equal(withoutApproval.ok, false);
    assert.equal(withoutApproval.errorCode, "APPROVAL_REQUIRED");

    const edited = await registry.execute(call, {
      requestApproval: async () => true,
    });
    assert.equal(edited.ok, true);
    const result = JSON.parse(edited.content).result;
    assert.equal(result.replacements, 2);
    assert.equal(result.beforeSha256, expectedSha256);
    assert.equal(await readFile(target, "utf8"), "gamma beta gamma");
    assert.ok(result.backupPath.startsWith(path.join(workspace, ".agent")));
    assert.equal(await readFile(result.backupPath, "utf8"), original);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("text editing writes nothing when the hash or occurrence count is stale", async () => {
  const projectRoot = process.cwd();
  const workspace = await mkdtemp(path.join(projectRoot, ".test-tmp-"));
  const target = path.join(workspace, "note.txt");
  const original = "one two";

  try {
    await writeFile(target, original, "utf8");
    const registry = new ToolRegistry({
      permissionPolicy: new PermissionPolicy({ mode: "approval" }),
    }).registerAll(createFilesystemTools({ workspace }));

    const staleHash = await registry.execute(
      {
        function: {
          name: "edit_text_file",
          arguments: {
            path: "note.txt",
            expected_sha256: "0".repeat(64),
            edits: [{ old_text: "one", new_text: "three" }],
          },
        },
      },
      { requestApproval: async () => true },
    );
    assert.equal(staleHash.ok, false);
    assert.equal(staleHash.errorCode, "FILE_CONFLICT");

    const correctHash = createHash("sha256")
      .update(original, "utf8")
      .digest("hex");
    const staleEdit = await registry.execute(
      {
        function: {
          name: "edit_text_file",
          arguments: {
            path: "note.txt",
            expected_sha256: correctHash,
            edits: [
              {
                old_text: "one",
                new_text: "three",
                expected_occurrences: 2,
              },
            ],
          },
        },
      },
      { requestApproval: async () => true },
    );
    assert.equal(staleEdit.ok, false);
    assert.equal(staleEdit.errorCode, "EDIT_CONFLICT");
    assert.equal(await readFile(target, "utf8"), original);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
