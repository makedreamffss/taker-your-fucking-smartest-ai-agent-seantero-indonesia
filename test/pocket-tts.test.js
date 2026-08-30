import assert from "node:assert/strict";
import test from "node:test";

import { PocketTts } from "../src/voice/pocket-tts.js";

function validWave() {
  const wave = Buffer.alloc(44);
  wave.write("RIFF", 0, "ascii");
  wave.write("WAVE", 8, "ascii");
  return wave;
}

test("Pocket TTS sanitizes text and plays worker-generated neural audio", async () => {
  const generated = [];
  const played = [];
  let playbackStarted = 0;
  let engineOptions;
  const tts = new PocketTts({
    pythonPath: "C:\\runtime\\python.exe",
    workerPath: "C:\\project\\worker.py",
    cacheDirectory: "C:\\project\\cache",
    audioPlayer: {
      async play(wave, { onPlaybackStart }) {
        played.push(wave);
        onPlaybackStart();
      },
      async stop() {},
    },
    engineFactory: async (options) => {
      engineOptions = options;
      return {
        async generate(request) {
          generated.push(request);
          return validWave();
        },
        close() {},
      };
    },
  });

  assert.equal(await tts.speak("# Result\n**Done.** `code` is in the report.", {
    onPlaybackStart: () => playbackStarted += 1,
  }), true);
  assert.equal(engineOptions.voice, "peter_yearsley");
  assert.equal(engineOptions.language, "english");
  assert.deepEqual(generated, [{ text: "Result Done. code is in the report." }]);
  assert.equal(played.length, 1);
  assert.equal(playbackStarted, 1);
  tts.dispose();
});

test("Pocket TTS terminates in-flight generation on interruption", async () => {
  let rejectGeneration;
  let closed = 0;
  const tts = new PocketTts({
    pythonPath: "C:\\runtime\\python.exe",
    workerPath: "C:\\project\\worker.py",
    cacheDirectory: "C:\\project\\cache",
    audioPlayer: { play: async () => {}, stop: async () => {} },
    engineFactory: async () => ({
      generate() {
        return new Promise((resolve, reject) => {
          rejectGeneration = reject;
        });
      },
      close() {
        closed += 1;
        rejectGeneration?.(new Error("worker stopped"));
      },
    }),
  });

  const controller = new AbortController();
  const speech = tts.speak("Stop this generation.", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort("barge_in");
  await assert.rejects(speech, { name: "AbortError", code: "ABORT_ERR" });
  assert.equal(closed, 1);
});
