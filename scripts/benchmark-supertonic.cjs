"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const sherpa = require("sherpa-onnx-node");

const projectRoot = path.resolve(__dirname, "..");
const modelRoot = path.join(
  projectRoot,
  ".agent",
  "runtime",
  "voice",
  "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
);
const outputRoot = path.join(projectRoot, ".agent", "qa", "voice-candidates");
// sherpa's packer sorts F1-F5 before M1-M5 by filename.
const packedVoiceOrder = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];
const operatorMode = process.argv.includes("--operator");
const text = operatorMode
  ? "Understood. I will handle it. I will keep the explanation brief and show you the verified result when it is done."
  : "Done. I checked the files, fixed the conflict, and verified the result. Nothing was changed outside the approved scope.";

fs.mkdirSync(outputRoot, { recursive: true });
const tts = new sherpa.OfflineTts({
  model: {
    supertonic: {
      durationPredictor: path.join(modelRoot, "duration_predictor.int8.onnx"),
      textEncoder: path.join(modelRoot, "text_encoder.int8.onnx"),
      vectorEstimator: path.join(modelRoot, "vector_estimator.int8.onnx"),
      vocoder: path.join(modelRoot, "vocoder.int8.onnx"),
      ttsJson: path.join(modelRoot, "tts.json"),
      unicodeIndexer: path.join(modelRoot, "unicode_indexer.bin"),
      voiceStyle: path.join(modelRoot, "voice.bin"),
    },
    debug: false,
    numThreads: 2,
    provider: "cpu",
  },
});

const results = [];
const speakerIds = operatorMode
  ? [packedVoiceOrder.indexOf("M2")]
  : Array.from({ length: tts.numSpeakers }, (_, index) => index);
for (const sid of speakerIds) {
  const generationConfig = new sherpa.GenerationConfig({
    sid,
    numSteps: operatorMode ? 10 : 8,
    speed: operatorMode ? 0.92 : 0.96,
    extra: { lang: "en" },
  });
  const started = performance.now();
  const audio = tts.generate({ text, generationConfig });
  const elapsedSeconds = (performance.now() - started) / 1000;
  const durationSeconds = audio.samples.length / audio.sampleRate;
  const outputPath = path.join(
    outputRoot,
    operatorMode ? "operator-M2-hq.wav" : `supertonic-sid-${sid}.wav`,
  );
  sherpa.writeWave(outputPath, {
    samples: audio.samples,
    sampleRate: audio.sampleRate,
  });
  results.push({
    sid,
    voice: packedVoiceOrder[sid],
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    realTimeFactor: Number((elapsedSeconds / durationSeconds).toFixed(3)),
    bytes: fs.statSync(outputPath).size,
    outputPath,
  });
}

console.log(
  JSON.stringify(
    {
      sampleRate: tts.sampleRate,
      operatorMode,
      speakers: tts.numSpeakers,
      textCharacters: text.length,
      results,
    },
    null,
    2,
  ),
);
