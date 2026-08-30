import assert from "node:assert/strict";
import test from "node:test";

import { MOODS, MOTION_CATALOG, MOTION_NAMES, motionForEvent } from "../src/desktop/renderer/character-motion-catalog.js";

test("character exposes at least 200 distinct semantic motion clips", () => {
  assert.ok(MOTION_NAMES.length >= 200);
  assert.equal(MOTION_NAMES.length, 240);
  assert.equal(new Set(MOTION_NAMES).size, MOTION_NAMES.length);
  const signatures = MOTION_NAMES.map((name) => {
    const { name: _name, family: _family, phase: _phase, ...behavior } = MOTION_CATALOG[name];
    return JSON.stringify(behavior);
  });
  assert.equal(new Set(signatures).size, MOTION_NAMES.length);
});

test("moods are independent from tool action clips", () => {
  assert.ok(Object.keys(MOODS).length >= 10);
  assert.equal(motionForEvent({ type: "tool_started", name: "read_text_file" }), "filesystem.read.engage");
  assert.equal(motionForEvent({ type: "tool_started", name: "edit_text_file" }), "filesystem.edit.engage");
  assert.equal(motionForEvent({ type: "approval_requested" }), "approval.guard.sustain");
  assert.equal(motionForEvent({ type: "turn_failed" }), "failure.error.engage");
  assert.equal(
    motionForEvent({ type: "tool_started", name: "execute_command", shell: "powershell" }),
    "powershell.execute.engage",
  );
  assert.equal(
    motionForEvent({ type: "tool_started", name: "execute_command", operation: "test.run" }),
    "test.run.engage",
  );
});
