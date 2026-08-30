import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPERTONIC_PACKED_VOICE_ORDER,
  SUPERTONIC_VOICE_PROFILES,
  SupertonicTts,
} from "../src/voice/supertonic-tts.js";

test("Supertonic packed speaker order follows sherpa's alphabetical JSON packing", () => {
  assert.deepEqual(SUPERTONIC_PACKED_VOICE_ORDER, [
    "F1", "F2", "F3", "F4", "F5",
    "M1", "M2", "M3", "M4", "M5",
  ]);
  assert.deepEqual(SUPERTONIC_VOICE_PROFILES, {
    F1: 0,
    F2: 1,
    F3: 2,
    F4: 3,
    F5: 4,
    M1: 5,
    M2: 6,
    M3: 7,
    M4: 8,
    M5: 9,
  });
});

test("Supertonic TTS sanitizes, synthesizes, and plays neural audio", async () => {
  const generated = [];
  const played = [];
  let playbackStarted = 0;
  const tts = new SupertonicTts({
    modelDirectory: "C:\\model",
    audioPlayer: {
      async play(wave, { onPlaybackStart }) {
        assert.ok(wave.byteLength > 44);
        played.push(wave);
        onPlaybackStart();
      },
      async stop() {},
    },
    engineFactory: async () => ({
      async generateAsync(request) {
        generated.push(request);
        return {
          samples: new Float32Array([0, 0.25, -0.25, 0]),
          sampleRate: 44_100,
        };
      },
    }),
  });

  assert.equal(await tts.speak("# Result\n**Done.** `code` is in the report.", {
    onPlaybackStart: () => playbackStarted += 1,
  }), true);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].text, "Result Done. code is in the report.");
  assert.equal(generated[0].enableExternalBuffer, false);
  assert.equal(generated[0].generationConfig.sid, 6);
  assert.equal(generated[0].generationConfig.numSteps, 10);
  assert.equal(played.length, 1);
  assert.equal(playbackStarted, 1);
});

test("Supertonic TTS honors cancellation during generation", async () => {
  const controller = new AbortController();
  const tts = new SupertonicTts({
    modelDirectory: "C:\\model",
    audioPlayer: { play: async () => {}, stop: async () => {} },
    engineFactory: async () => ({
      async generateAsync(request) {
        controller.abort("barge_in");
        assert.equal(request.onProgress(), false);
        return { samples: new Float32Array(), sampleRate: 44_100 };
      },
    }),
  });

  await assert.rejects(
    tts.speak("Stop now.", { signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
});
