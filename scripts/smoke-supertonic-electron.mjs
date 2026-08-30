import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

import { SupertonicTts } from "../src/voice/supertonic-tts.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({ stage: "electron_ready_wait" }));

app.whenReady().then(async () => {
  console.log(JSON.stringify({ stage: "electron_ready" }));
  try {
    const observations = { waveBytes: 0, playbackStarted: false };
    const tts = new SupertonicTts({
      modelDirectory: path.join(
        projectRoot,
        ".agent",
        "runtime",
        "voice",
        "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
      ),
      audioPlayer: {
        async play(wave, { onPlaybackStart }) {
          if (wave.subarray(0, 4).toString("ascii") !== "RIFF") {
            throw new Error("TTS smoke received an invalid WAVE container.");
          }
          observations.waveBytes = wave.byteLength;
          onPlaybackStart();
        },
        async stop() {},
      },
    });
    console.log(JSON.stringify({ stage: "synthesis_start" }));
    await tts.speak("Neural voice runtime ready.", {
      onPlaybackStart() {
        observations.playbackStarted = true;
      },
    });
    console.log(JSON.stringify({ passed: true, ...observations }, null, 2));
    app.quit();
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
});
