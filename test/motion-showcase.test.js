"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  MOTION_SHOWCASE_FRAMES,
  MOTION_SHOWCASE_INTERVAL_MS,
} from "../src/desktop/motion-showcase.js";
import { MOTION_CATALOG } from "../src/desktop/renderer/character-motion-catalog.js";

test("showcase schedules every procedural motion state exactly once", () => {
  assert.equal(MOTION_SHOWCASE_FRAMES.length, 240);
  assert.equal(new Set(MOTION_SHOWCASE_FRAMES.map(({ name }) => name)).size, 240);
  assert.ok(MOTION_SHOWCASE_INTERVAL_MS >= 500);

  MOTION_SHOWCASE_FRAMES.forEach((frame, index) => {
    assert.equal(frame.type, "state");
    assert.equal(frame.index, index);
    assert.equal(frame.total, MOTION_SHOWCASE_FRAMES.length);
    assert.ok(MOTION_CATALOG[frame.name]);
  });
});
