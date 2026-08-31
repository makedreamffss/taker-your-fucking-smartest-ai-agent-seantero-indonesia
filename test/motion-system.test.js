import assert from "node:assert/strict";
import test from "node:test";

import { EMBODIMENT_ACTIONS } from "../src/embodiment/contracts.js";
import { MOTION_CLIPS, RigMotionSystem } from "../src/desktop/renderer/motion-system.js";
import { createOriginalTakerRig } from "../src/desktop/renderer/original-rig.js";

test("every advertised action is a finite clip that moves the coherent rig", () => {
  assert.deepEqual(Object.keys(MOTION_CLIPS).sort(), [...EMBODIMENT_ACTIONS].sort());
  for (const action of EMBODIMENT_ACTIONS) {
    const rig = createOriginalTakerRig();
    const motion = new RigMotionSystem(rig);
    const before = snapshot(rig);
    motion.playAction(action, { nowMs: 0 });
    motion.update(MOTION_CLIPS[action].durationMs * 0.5, 1 / 60);
    assert.notDeepEqual(snapshot(rig), before, `${action} must move at least one joint`);
    assert.ok(MOTION_CLIPS[action].durationMs >= 1_000);
  }
});

test("mood and speech are orthogonal to finite action completion", () => {
  const events = [];
  const rig = createOriginalTakerRig();
  const motion = new RigMotionSystem(rig, { onActionEvent: (event) => events.push(event) });
  motion.setMood("severe", 0.7);
  motion.setSpeechEnergy(0.8);
  motion.playAction("jump", { nowMs: 10 });
  motion.update(10 + MOTION_CLIPS.jump.durationMs + 1, 1 / 60);
  assert.equal(motion.mood, "severe");
  assert.equal(motion.action, null);
  assert.deepEqual(events.map(({ type }) => type), ["action_started", "action_completed"]);
});

function snapshot(rig) {
  return [...rig.nodes].map(([name, node]) => [
    name,
    node.position.toArray().map(round),
    [node.rotation.x, node.rotation.y, node.rotation.z].map(round),
  ]);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
