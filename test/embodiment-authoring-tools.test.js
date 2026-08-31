import assert from "node:assert/strict";
import test from "node:test";

import { createEmbodimentAuthoringTools } from "../src/tools/builtins/embodiment-authoring-tools.js";

test("Blender mutation tool is explicit, snapshotted, and approval-gated", () => {
  const tools = createEmbodimentAuthoringTools({ workspace: process.cwd() });
  const rebuild = tools.find(({ name }) => name === "blender_rebuild_embodiment");
  assert.ok(rebuild);
  assert.equal(rebuild.risk, "execute");
  const assessment = rebuild.assess({});
  assert.equal(assessment.ambiguous, true);
  assert.equal(assessment.safeInSemiAutonomous, false);
  assert.match(rebuild.description, /snapshotted/i);
  assert.match(rebuild.description, /No model-provided code/i);
});
