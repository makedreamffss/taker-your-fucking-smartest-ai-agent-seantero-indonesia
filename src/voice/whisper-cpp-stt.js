import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { encodeMonoPcm16Wave } from "./pcm-wave.js";

export class WhisperCppStt {
  constructor({
    binaryPath,
    modelPath,
    tempDirectory,
    language = "auto",
    threads = 4,
    timeoutMs = 120_000,
    processRunner = runProcess,
    idFactory = randomUUID,
  }) {
    this.binaryPath = requirePath(binaryPath, "binaryPath");
    this.modelPath = requirePath(modelPath, "modelPath");
    this.tempDirectory = requirePath(tempDirectory, "tempDirectory");
    this.language = requireText(language, "language");
    this.threads = requireInteger(threads, "threads", 1, 32);
    this.timeoutMs = requireInteger(
      timeoutMs,
      "timeoutMs",
      1_000,
      600_000,
    );
    if (typeof processRunner !== "function") {
      throw new TypeError("processRunner must be a function.");
    }
    if (typeof idFactory !== "function") {
      throw new TypeError("idFactory must be a function.");
    }
    this.processRunner = processRunner;
    this.idFactory = idFactory;
  }

  async verify() {
    await Promise.all([
      access(this.binaryPath),
      access(this.modelPath),
      mkdir(this.tempDirectory, { recursive: true }),
    ]);
    return true;
  }

  async transcribe(audio, { signal } = {}) {
    throwIfAborted(signal);
    const { samples, sampleRate } = normalizeAudio(audio);
    if (samples.length === 0) return "";
    if (samples.length > sampleRate * 120) {
      throw new RangeError("A single voice segment cannot exceed 120 seconds.");
    }

    await this.verify();
    throwIfAborted(signal);
    const id = String(this.idFactory()).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) throw new Error("idFactory returned an unusable identifier.");
    const inputPath = path.join(this.tempDirectory, id + ".wav");
    const outputPrefix = path.join(this.tempDirectory, id);
    const outputPath = outputPrefix + ".txt";

    try {
      await writeFile(
        inputPath,
        encodeMonoPcm16Wave(samples, sampleRate),
        { flag: "wx" },
      );
      await this.processRunner(
        this.binaryPath,
        [
          "--model",
          this.modelPath,
          "--file",
          inputPath,
          "--language",
          this.language,
          "--threads",
          String(this.threads),
          "--no-gpu",
          "--no-timestamps",
          "--output-txt",
          "--output-file",
          outputPrefix,
          "--no-prints",
        ],
        {
          signal,
          timeoutMs: this.timeoutMs,
        },
      );
      throwIfAborted(signal);
      return (await readFile(outputPath, "utf8")).trim();
    } finally {
      await Promise.allSettled([
        rm(inputPath, { force: true }),
        rm(outputPath, { force: true }),
      ]);
    }
  }
}

export function runProcess(
  binaryPath,
  args,
  { signal, timeoutMs = 120_000 } = {},
) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const child = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= 1_048_576) target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else {
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      }
    };
    const abort = () => {
      child.kill();
      finish(createAbortError(signal?.reason));
    };
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(
        "whisper.cpp exceeded its " + timeoutMs + " ms timeout.",
      );
      error.code = "STT_TIMEOUT";
      finish(error);
    }, timeoutMs);

    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(error));
    child.once("close", (code, closeSignal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      const error = new Error(
        "whisper.cpp failed with exit code " +
          String(code) +
          (closeSignal ? " and signal " + closeSignal : "") +
          (detail ? ": " + detail.slice(-2_000) : "."),
      );
      error.code = "STT_PROCESS_FAILED";
      finish(error);
    });
  });
}

function normalizeAudio(audio) {
  if (audio instanceof Float32Array) {
    return { samples: audio, sampleRate: 16_000 };
  }
  if (
    audio &&
    typeof audio === "object" &&
    audio.samples instanceof Float32Array
  ) {
    return {
      samples: audio.samples,
      sampleRate: requireInteger(
        audio.sampleRate,
        "audio.sampleRate",
        8_000,
        192_000,
      ),
    };
  }
  throw new TypeError(
    "Audio must be a Float32Array or an object with samples and sampleRate.",
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

function createAbortError(reason) {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : reason === undefined
        ? "Speech recognition was cancelled."
        : String(reason),
  );
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function requirePath(value, name) {
  const text = requireText(value, name);
  return path.resolve(text);
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(name + " must be a non-empty string.");
  }
  return value.trim();
}

function requireInteger(value, name, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      name + " must be an integer from " + minimum + " through " + maximum + ".",
    );
  }
  return value;
}
