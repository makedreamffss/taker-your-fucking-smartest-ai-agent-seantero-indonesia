import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { WhisperCppStt } from "../src/voice/whisper-cpp-stt.js";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/benchmark-stt.mjs path-to-16khz-mono-pcm-wave");
}

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const binaryPath = path.join(
  projectRoot,
  ".agent",
  "runtime",
  "voice",
  "whisper.cpp-v1.8.6",
  "Release",
  "whisper-cli.exe",
);
const modelPath = path.join(
  projectRoot,
  ".agent",
  "runtime",
  "voice",
  "models",
  "ggml-base.bin",
);
const wave = await readFile(path.resolve(inputPath));
const samples = decodeMonoPcm16Wave(wave);
const stt = new WhisperCppStt({
  binaryPath,
  modelPath,
  tempDirectory: path.join(projectRoot, ".agent", "tmp", "stt"),
});

const startedAt = performance.now();
const text = await stt.transcribe(samples);
const elapsedMs = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      audioSeconds: samples.length / 16_000,
      elapsedMs: Math.round(elapsedMs),
      realTimeFactor: Number(
        (elapsedMs / 1_000 / (samples.length / 16_000)).toFixed(3),
      ),
      text,
    },
    null,
    2,
  ),
);

function decodeMonoPcm16Wave(buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Input must be a PCM WAV file.");
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitDepth = buffer.readUInt16LE(34);
  const dataOffset = buffer.indexOf(Buffer.from("data"));
  if (
    channels !== 1 ||
    sampleRate !== 16_000 ||
    bitDepth !== 16 ||
    dataOffset < 0
  ) {
    throw new Error("Input must be mono 16-bit PCM at 16000 Hz.");
  }
  const dataLength = buffer.readUInt32LE(dataOffset + 4);
  const samples = new Float32Array(dataLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = buffer.readInt16LE(dataOffset + 8 + index * 2);
    samples[index] = value < 0 ? value / 32_768 : value / 32_767;
  }
  return samples;
}
