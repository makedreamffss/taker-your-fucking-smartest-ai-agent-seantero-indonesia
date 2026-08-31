import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmbodimentCommand,
  EMBODIMENT_ACTIONS,
  EMBODIMENT_MOODS,
  embodimentCatalog,
  validateEmbodimentEvent,
} from "../src/embodiment/contracts.js";

test("embodiment contract exposes honest semantic tracks and bounded commands", () => {
  const catalog = embodimentCatalog();
  assert.equal(catalog.actions.length, 16);
  assert.deepEqual(catalog.actions, [...EMBODIMENT_ACTIONS]);
  assert.ok(catalog.tracks.includes("action"));
  assert.ok(catalog.tracks.includes("mood"));
  assert.ok(catalog.assetFormats.includes("vrma-1.0"));

  const command = createEmbodimentCommand(
    "play_action",
    { action: "roll", intensity: 2, interrupt: false },
    "request-1",
  );
  assert.deepEqual(command.payload, { action: "roll", intensity: 1, interrupt: false });
  assert.throws(() => createEmbodimentCommand("play_action", { action: "fake" }), /Unknown/);
  assert.throws(() => createEmbodimentCommand("set_mood", { mood: "lying" }), /Unknown/);
  assert.ok(EMBODIMENT_MOODS.includes("severe"));
});

test("renderer event validation strips untrusted fields and rejects unknown events", () => {
  assert.deepEqual(
    validateEmbodimentEvent({
      type: "telemetry",
      fps: 900,
      drawCalls: 12,
      triangles: 24_000,
      injected: "ignored",
    }),
    { type: "telemetry", fps: 300, drawCalls: 12, triangles: 24_000 },
  );
  assert.equal(validateEmbodimentEvent({ type: "execute_shell" }), null);
});
