import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { prepareSpeechText, splitSpeechSegments } from "./speech-text.js";

const MAX_WAVE_BYTES = 32 * 1024 * 1024;

export class PocketTts {
  #enginePromise = null;
  #active = null;
  #sequence = 0;
  #disposed = false;

  constructor({
    pythonPath,
    workerPath,
    cacheDirectory,
    audioPlayer,
    voice = "peter_yearsley",
    language = "english",
    numThreads = 2,
    engineFactory = createPocketWorkerEngine,
  } = {}) {
    if (!pythonPath || !workerPath || !cacheDirectory) {
      throw new TypeError("PocketTts requires Python, worker, and cache paths.");
    }
    if (!audioPlayer || typeof audioPlayer.play !== "function" || typeof audioPlayer.stop !== "function") {
      throw new TypeError("PocketTts requires an audio player.");
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(voice)) {
      throw new RangeError("Pocket TTS voice names may contain lowercase letters, digits, and underscores.");
    }
    if (!Number.isInteger(numThreads) || numThreads < 1 || numThreads > 8) {
      throw new RangeError("Pocket TTS thread count must be between 1 and 8.");
    }
    if (typeof engineFactory !== "function") {
      throw new TypeError("PocketTts engineFactory must be a function.");
    }
    this.pythonPath = path.resolve(pythonPath);
    this.workerPath = path.resolve(workerPath);
    this.cacheDirectory = path.resolve(cacheDirectory);
    this.audioPlayer = audioPlayer;
    this.voice = voice;
    this.language = language;
    this.numThreads = numThreads;
    this.engineFactory = engineFactory;
  }

  async verify() {
    await this.#engine();
    return true;
  }

  async speak(value, { signal, onPlaybackStart = () => {} } = {}) {
    await this.stop("superseded");
    if (signal?.aborted) throw abortError(signal.reason);
    const text = prepareSpeechText(value);
    const segments = splitSpeechSegments(text, { maxCharacters: 180 });
    if (segments.length === 0) return false;

    const active = { id: ++this.#sequence, cancelled: false, generating: false };
    this.#active = active;
    const abortListener = () => {
      active.cancelled = true;
      if (active.generating) this.#resetEngine();
      void this.audioPlayer.stop(signal.reason ?? "speech_aborted");
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    try {
      let wave = await this.#generate(segments[0], active, signal);
      let announcedPlayback = false;
      for (let index = 0; index < segments.length; index += 1) {
        this.#assertActive(active, signal);
        const nextWave = index + 1 < segments.length
          ? this.#generate(segments[index + 1], active, signal)
          : null;
        try {
          await this.audioPlayer.play(wave, {
            signal,
            onPlaybackStart: () => {
              if (!announcedPlayback) {
                announcedPlayback = true;
                onPlaybackStart();
              }
            },
          });
        } catch (error) {
          await nextWave?.catch(() => {});
          throw error;
        }
        if (nextWave) wave = await nextWave;
      }
      return true;
    } finally {
      signal?.removeEventListener("abort", abortListener);
      if (this.#active === active) this.#active = null;
    }
  }

  async stop(reason = "speech_stopped") {
    const active = this.#active;
    if (active) {
      active.cancelled = true;
      this.#active = null;
      if (active.generating) this.#resetEngine();
    }
    await this.audioPlayer.stop(reason);
  }

  dispose() {
    this.#disposed = true;
    if (this.#active) this.#active.cancelled = true;
    this.#active = null;
    this.#resetEngine();
  }

  async #engine() {
    if (this.#disposed) throw new Error("Pocket TTS has been disposed.");
    if (!this.#enginePromise) {
      const candidate = Promise.resolve(this.engineFactory({
        pythonPath: this.pythonPath,
        workerPath: this.workerPath,
        cacheDirectory: this.cacheDirectory,
        voice: this.voice,
        language: this.language,
        numThreads: this.numThreads,
      }));
      const tracked = candidate.catch((error) => {
        if (this.#enginePromise === tracked) this.#enginePromise = null;
        throw error;
      });
      this.#enginePromise = tracked;
    }
    return this.#enginePromise;
  }

  async #generate(text, active, signal) {
    active.generating = true;
    try {
      const engine = await this.#engine();
      this.#assertActive(active, signal);
      const wave = await engine.generate({ text });
      this.#assertActive(active, signal);
      return normalizeWave(wave);
    } catch (error) {
      if (active.cancelled || signal?.aborted) {
        throw abortError(signal?.reason ?? "speech_cancelled");
      }
      throw error;
    } finally {
      active.generating = false;
    }
  }

  #assertActive(active, signal) {
    if (active.cancelled || this.#active !== active || signal?.aborted) {
      throw abortError(signal?.reason ?? "speech_cancelled");
    }
  }

  #resetEngine() {
    const enginePromise = this.#enginePromise;
    this.#enginePromise = null;
    void enginePromise?.then((engine) => engine.close()).catch(() => {});
  }
}

async function createPocketWorkerEngine(options) {
  const engine = new PocketWorkerEngine(options);
  await engine.start();
  return engine;
}

class PocketWorkerEngine {
  #process = null;
  #lines = null;
  #pending = new Map();
  #readyResolve = null;
  #readyReject = null;
  #readyTimer = null;
  #closed = false;
  #stderrTail = "";

  constructor({ pythonPath, workerPath, cacheDirectory, voice, language, numThreads }) {
    this.pythonPath = pythonPath;
    this.workerPath = workerPath;
    this.cacheDirectory = cacheDirectory;
    this.voice = voice;
    this.language = language;
    this.numThreads = numThreads;
  }

  start() {
    for (const [label, candidate] of [
      ["Python executable", this.pythonPath],
      ["Pocket TTS worker", this.workerPath],
    ]) {
      if (!fs.existsSync(candidate)) throw new Error(`${label} is missing: ${candidate}`);
    }
    fs.mkdirSync(this.cacheDirectory, { recursive: true });
    this.#process = spawn(
      this.pythonPath,
      [
        this.workerPath,
        "--voice", this.voice,
        "--language", this.language,
        "--threads", String(this.numThreads),
      ],
      {
        cwd: path.dirname(this.workerPath),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HF_HOME: this.cacheDirectory,
          HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
          OMP_NUM_THREADS: String(this.numThreads),
          MKL_NUM_THREADS: String(this.numThreads),
          TOKENIZERS_PARALLELISM: "false",
        },
      },
    );
    this.#process.stderr.setEncoding("utf8");
    this.#process.stderr.on("data", (chunk) => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-8_000);
    });
    this.#lines = readline.createInterface({ input: this.#process.stdout });
    this.#lines.on("line", (line) => this.#handleLine(line));
    this.#process.once("error", (error) => this.#fail(error));
    this.#process.once("exit", (code, signal) => {
      if (this.#closed) return;
      const detail = this.#stderrTail.trim();
      this.#fail(new Error(
        `Pocket TTS worker exited (${signal ?? code}).${detail ? ` ${detail}` : ""}`,
      ));
    });

    return new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
      this.#readyTimer = setTimeout(() => {
        this.#fail(new Error("Pocket TTS worker startup timed out."));
      }, 120_000);
    });
  }

  generate({ text }) {
    if (this.#closed || !this.#process?.stdin.writable) {
      return Promise.reject(new Error("Pocket TTS worker is unavailable."));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("Pocket TTS generation timed out."));
        this.close();
      }, 120_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#process.stdin.write(`${JSON.stringify({ id, op: "synthesize", text })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#readyTimer);
    this.#lines?.close();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(abortError("Pocket TTS worker stopped."));
    }
    this.#pending.clear();
    if (this.#process?.stdin.writable) {
      this.#process.stdin.write(`${JSON.stringify({ op: "shutdown" })}\n`);
    }
    this.#process?.kill();
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "ready") {
      clearTimeout(this.#readyTimer);
      this.#readyResolve?.(this);
      this.#readyResolve = null;
      this.#readyReject = null;
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.type === "error") {
      const error = new Error(message.message || "Pocket TTS generation failed.");
      error.code = message.code || "POCKET_TTS_GENERATION_ERROR";
      pending.reject(error);
      return;
    }
    try {
      pending.resolve(normalizeWave(Buffer.from(message.waveBase64 || "", "base64")));
    } catch (error) {
      pending.reject(error);
    }
  }

  #fail(error) {
    clearTimeout(this.#readyTimer);
    this.#readyReject?.(error);
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#closed = true;
    this.#lines?.close();
    this.#process?.kill();
  }
}

function normalizeWave(value) {
  const wave = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (
    wave.byteLength < 44 ||
    wave.byteLength > MAX_WAVE_BYTES ||
    wave.subarray(0, 4).toString("ascii") !== "RIFF" ||
    wave.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    throw new Error("Pocket TTS returned an invalid WAVE payload.");
  }
  return wave;
}

function abortError(reason) {
  const error = new Error(reason === undefined ? "Speech aborted." : String(reason));
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}
