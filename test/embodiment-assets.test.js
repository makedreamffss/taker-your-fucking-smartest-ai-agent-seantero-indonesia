import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  inspectEmbodimentAsset,
  listEmbodimentAssets,
} from "../src/authoring/embodiment-assets.js";

const workspace = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("authored GLB is valid and carries project-local provenance", async () => {
  const result = await inspectEmbodimentAsset(
    workspace,
    "runtime/taker-agent.glb",
  );
  assert.equal(result.format, "glb");
  assert.equal(result.validContainer, true);
  assert.equal(result.provenance.licensePresent, true);
  assert.equal(result.provenance.sourcePresent, true);
  assert.equal(result.distributable, true);
  assert.ok(result.bytes > 100_000);
});

test("asset service is allowlisted to assets/embodiment", async () => {
  await assert.rejects(
    inspectEmbodimentAsset(workspace, "../../package.json"),
    /must stay inside/,
  );
  const listing = await listEmbodimentAssets(workspace);
  assert.ok(listing.assets.some(({ path }) => path === "runtime\\taker-agent.glb"));
});
