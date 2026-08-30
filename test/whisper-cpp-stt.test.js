import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { encodeMonoPcm16Wave } from "../src/voice/pcm-wave.js";
import { WhisperCppStt } from "../src/voice/whisper-cpp-stt.js";

test("PCM encoder creates a standards-shaped mono 16-bit wave", () => {
  const wave = encodeMonoPcm16Wave(
    new Float32Array([-1, -0.5, 0, 0.5, 1, Number.NaN]),
    16_000,
  );

  assert.equal(wave.toString("ascii", 0, 4), "RIFF");
  assert.equal(wave.toString("ascii", 8, 12), "WAVE");
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt16LE(22), 1);
  assert.equal(wave.readUInt32LE(24), 16_000);
  assert.equal(wave.readUInt16LE(34), 16);
  assert.equal(wave.toString("ascii", 36, 40), "data");
  assert.equal(wave.readInt16LE(44), -32_768);
  assert.equal(wave.readInt16LE(52), 32_767);
  assert.equal(wave.readInt16LE(54), 0);
});

test("Whisper adapter uses pinned paths, returns text, and erases temporary audio", async (context) => {
  const projectRoot = path.resolve(".");
  const temporaryRoot = await mkdtemp(path.join(projectRoot, ".test-tmp-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const binaryPath = path.join(temporaryRoot, "whisper-cli.exe");
  const modelPath = path.join(temporaryRoot, "ggml-base.bin");
  const audioRoot = path.join(temporaryRoot, "audio");
  await writeFile(binaryPath, "placeholder");
  await writeFile(modelPath, "placeholder");

  let observedInput;
  const stt = new WhisperCppStt({
    binaryPath,
    modelPath,
    tempDirectory: audioRoot,
    idFactory: () => "fixed-id",
    processRunner: async (_binary, args) => {
      const inputIndex = args.indexOf("--file") + 1;
      const outputIndex = args.indexOf("--output-file") + 1;
      observedInput = args[inputIndex];
      const wave = await readFile(observedInput);
      assert.equal(wave.toString("ascii", 0, 4), "RIFF");
      assert.ok(args.includes("--no-gpu"));
      assert.ok(args.includes("--no-timestamps"));
      await writeFile(args[outputIndex] + ".txt", "  halo dunia  ");
    },
  });

  const text = await stt.transcribe(new Float32Array([0, 0.1, -0.1]));
  assert.equal(text, "halo dunia");
  await assert.rejects(access(observedInput));
  await assert.rejects(access(path.join(audioRoot, "fixed-id.txt")));
});

test("Whisper adapter rejects an already-cancelled transcription without writing", async () => {
  const controller = new AbortController();
  controller.abort("interrupted");
  const stt = new WhisperCppStt({
    binaryPath: "whisper-cli.exe",
    modelPath: "ggml-base.bin",
    tempDirectory: ".agent/tmp/stt",
  });

  await assert.rejects(
    stt.transcribe(new Float32Array([0]), { signal: controller.signal }),
    (error) => error.name === "AbortError" && error.code === "ABORT_ERR",
  );
});
