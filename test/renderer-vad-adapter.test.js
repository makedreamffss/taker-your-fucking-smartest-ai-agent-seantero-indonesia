import assert from "node:assert/strict";
import test from "node:test";

import { RendererVadAdapter } from "../src/desktop/renderer-vad-adapter.js";

test("renderer VAD adapter confirms lifecycle and forwards speech", async () => {
  const commands = [];
  const events = [];
  const vad = new RendererVadAdapter({
    sendCommand(command) {
      commands.push(command);
      queueMicrotask(() =>
        vad.handleEvent({
          type: command.type === "start" ? "started" : "stopped",
        }),
      );
    },
  });

  await vad.start({
    onSpeechStart: () => events.push("start"),
    onSpeechEnd: (audio) => events.push(audio.length),
    onError: (error) => events.push(error.code),
  });
  vad.handleEvent({ type: "speech_started" });
  vad.handleSpeech(new Float32Array([0, 0.5]));
  await vad.stop();

  assert.deepEqual(commands, [{ type: "start" }, { type: "stop" }]);
  assert.deepEqual(events, ["start", 2]);
  assert.equal(vad.state, "stopped");
});

test("renderer VAD adapter rejects a failed start", async () => {
  let vad;
  vad = new RendererVadAdapter({
    sendCommand() {
      queueMicrotask(() =>
        vad.handleEvent({
          type: "error",
          code: "NotAllowedError",
          message: "Microphone denied.",
        }),
      );
    },
  });

  await assert.rejects(
    vad.start({
      onSpeechStart: () => {},
      onSpeechEnd: () => {},
      onError: () => {},
    }),
    (error) => error.code === "NotAllowedError",
  );
  assert.equal(vad.state, "stopped");
});
