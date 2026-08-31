import assert from "node:assert/strict";
import test from "node:test";

import { remapAlphaByte } from "../src/desktop/renderer/pixel-character-renderer.js";

test("character alpha cleanup removes the generated rectangular matte", () => {
  assert.equal(remapAlphaByte(0), 0);
  assert.equal(remapAlphaByte(32), 0);
  assert.equal(remapAlphaByte(255), 255);
  assert.ok(remapAlphaByte(96) > 0);
  assert.ok(remapAlphaByte(148) > 245);
});
