import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePrompt,
  shouldSubmitPrompt,
} from "../src/desktop/renderer/prompt-interaction.js";

test("prompt input sends on Enter and keeps Shift+Enter for a newline", () => {
  assert.equal(shouldSubmitPrompt({ key: "Enter" }), true);
  assert.equal(shouldSubmitPrompt({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitPrompt({ key: "a" }), false);
});

test("prompt input never submits while an IME composition is active", () => {
  assert.equal(shouldSubmitPrompt({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSubmitPrompt({ key: "Enter", keyCode: 229 }), false);
  assert.equal(shouldSubmitPrompt({ key: "Enter" }, { composing: true }), false);
});

test("prompt submission rejects whitespace and applies the IPC bound", () => {
  assert.equal(normalizePrompt("  handle this  "), "handle this");
  assert.equal(normalizePrompt("   \n"), "");
  assert.equal(normalizePrompt("x".repeat(20_010)).length, 20_000);
});
