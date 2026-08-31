import assert from "node:assert/strict";
import test from "node:test";

import { EmbodimentController } from "../src/embodiment/embodiment-controller.js";

test("embodiment controller validates, acknowledges, and tracks renderer state", async () => {
  const controller = new EmbodimentController();
  controller.attach((command) => {
    controller.handleRendererEvent({ type: "accepted", requestId: command.requestId });
  });

  controller.handleRendererEvent({ type: "ready", backend: "test-rig" });
  const result = await controller.dispatch("set_mood", { mood: "focused", intensity: 0.8 });
  assert.equal(result.accepted, true);
  assert.equal(result.status.ready, true);
  assert.equal(result.status.backend, "test-rig");
  assert.equal(result.status.mood, "focused");
  assert.equal(result.status.catalog.actions.length, 16);
});

test("embodiment controller rejects commands while renderer is unavailable", async () => {
  const controller = new EmbodimentController();
  await assert.rejects(controller.dispatch("inspect"), /not connected/);
});
