import path from "node:path";
import { fileURLToPath } from "node:url";

import { PocketTts } from "../src/voice/pocket-tts.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let generatedBytes = 0;
const tts = new PocketTts({
  pythonPath: path.join(
    projectRoot,
    ".agent", "runtime", "voice", "pocket-tts-3.0.2", "Scripts", "python.exe",
  ),
  workerPath: path.join(projectRoot, "src", "voice", "pocket-tts-worker.py"),
  cacheDirectory: path.join(projectRoot, ".agent", "runtime", "voice", "huggingface"),
  audioPlayer: {
    async play(wave, { onPlaybackStart }) {
      generatedBytes = wave.byteLength;
      onPlaybackStart();
    },
    async stop() {},
  },
});

try {
  await tts.verify();
  const spoke = await tts.speak("The machine is ready. I will handle it.");
  if (!spoke || generatedBytes < 44) throw new Error("Pocket TTS produced no WAVE audio.");
  console.log(JSON.stringify({ passed: true, generatedBytes }));
} finally {
  tts.dispose();
}
