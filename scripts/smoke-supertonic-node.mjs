import path from "node:path";
import { fileURLToPath } from "node:url";

import { SupertonicTts } from "../src/voice/supertonic-tts.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
      onPlaybackStart();
      console.log(JSON.stringify({ stage: "wave_ready", bytes: wave.byteLength }));
    },
    async stop() {},
  },
});

console.log(JSON.stringify({ stage: "synthesis_start" }));
await tts.speak("Neural voice runtime ready.");
console.log(JSON.stringify({ passed: true }));
