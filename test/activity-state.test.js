import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivityStateStore,
  deriveUiState,
} from "../src/core/activity-state.js";

test("activity state keeps audio input, output, and turn activity independent", () => {
  const events = [];
  const state = new ActivityStateStore({
    clock: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  state.subscribe((event) => events.push(event));

  state.transition("audioInput", "listening");
  assert.equal(state.uiState, "listening");

  state.transition("audioOutput", "speaking");
  assert.equal(state.uiState, "speaking");

  state.transition("audioInput", "speech_detected", {
    reason: "barge_in",
  });
  assert.equal(state.uiState, "listening");
  assert.equal(state.snapshot.audioOutput, "speaking");

  state.update(
    { audioOutput: "silent", audioInput: "transcribing", turn: "thinking" },
    { reason: "interrupt_and_transcribe" },
  );
  assert.equal(state.uiState, "listening");
  assert.deepEqual(events.at(-1).changedAxes, [
    "audioOutput",
    "audioInput",
    "turn",
  ]);
  assert.equal(events.at(-1).timestamp, "2026-08-30T00:00:00.000Z");
});

test("activity state rejects impossible transitions and incomplete snapshots", () => {
  const state = new ActivityStateStore();
  assert.throws(
    () => state.transition("audioInput", "transcribing"),
    /Invalid audioInput transition/,
  );
  assert.throws(
    () => state.transition("turn", "speaking"),
    /Unknown turn state/,
  );
  assert.throws(
    () => deriveUiState({ turn: "idle" }),
    /missing the service axis/,
  );
});
