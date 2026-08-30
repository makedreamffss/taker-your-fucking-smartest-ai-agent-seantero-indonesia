import { createRequire } from "node:module";
import path from "node:path";

import { encodeMonoPcm16Wave } from "./pcm-wave.js";
import {
  detectSpeechLanguage,
  prepareSpeechText,
  splitSpeechSegments,
} from "./speech-text.js";

const require = createRequire(import.meta.url);

// sherpa-onnx's generate_voices_bin.py sorts the source JSON filenames before
// packing them. Since F*.json sorts before M*.json, voice.bin is ordered
// F1-F5, then M1-M5. Keep this explicit: a conventional M-first assumption
// silently selects the opposite gender.
export const SUPERTONIC_PACKED_VOICE_ORDER = Object.freeze([
  "F1", "F2", "F3", "F4", "F5",
  "M1", "M2", "M3", "M4", "M5",
]);

export const SUPERTONIC_VOICE_PROFILES = Object.freeze(
  Object.fromEntries(
    SUPERTONIC_PACKED_VOICE_ORDER.map((profile, sid) => [profile, sid]),
  ),
);

export class SupertonicTts {
  #enginePromise = null;
  #sequence = 0;
  #active = null;

  constructor({
    modelDirectory,
    audioPlayer,
    voiceProfile = "M2",
    speed = 0.92,
    numSteps = 10,
    numThreads = 2,
    engineFactory = createSherpaEngine,
  } = {}) {
    if (typeof modelDirectory !== "string" || !modelDirectory) {
      throw new TypeError("SupertonicTts requires a model directory.");
    }
    if (!audioPlayer || typeof audioPlayer.play !== "function" || typeof audioPlayer.stop !== "function") {
      throw new TypeError("SupertonicTts requires an audio player.");
    }
    const normalizedProfile = typeof voiceProfile === "string"
      ? voiceProfile.toUpperCase()
      : "";
    if (!(normalizedProfile in SUPERTONIC_VOICE_PROFILES)) {
      throw new RangeError("voiceProfile must be one of M1-M5 or F1-F5.");
    }
    if (typeof engineFactory !== "function") {
      throw new TypeError("engineFactory must be a function.");
    }
    this.modelDirectory = path.resolve(modelDirectory);
    this.audioPlayer = audioPlayer;
    this.voiceProfile = normalizedProfile;
    this.speed = speed;
    this.numSteps = numSteps;
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
    const segments = splitSpeechSegments(text);
    if (segments.length === 0) return false;

    const active = { id: ++this.#sequence, cancelled: false };
    this.#active = active;
    const abortListener = () => {
      active.cancelled = true;
      void this.audioPlayer.stop(signal.reason ?? "speech_aborted");
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    try {
      const engine = await this.#engine();
      this.#assertActive(active, signal);
      let audio = await this.#generate(engine, segments[0], text, active, signal);
      let announcedPlayback = false;

      for (let index = 0; index < segments.length; index += 1) {
        this.#assertActive(active, signal);
        const nextAudio = index + 1 < segments.length
          ? this.#generate(engine, segments[index + 1], text, active, signal)
          : null;
        const wave = encodeMonoPcm16Wave(audio.samples, audio.sampleRate);
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
          await nextAudio?.catch(() => {});
          throw error;
        }
        if (nextAudio) audio = await nextAudio;
      }
      return true;
    } finally {
      signal?.removeEventListener("abort", abortListener);
      if (this.#active === active) this.#active = null;
    }
  }

  async stop(reason = "speech_stopped") {
    if (this.#active) {
      this.#active.cancelled = true;
      this.#active = null;
    }
    await this.audioPlayer.stop(reason);
  }

  async #engine() {
    this.#enginePromise ??= Promise.resolve(
      this.engineFactory({
        modelDirectory: this.modelDirectory,
        numThreads: this.numThreads,
      }),
    ).catch((error) => {
      this.#enginePromise = null;
      throw error;
    });
    return this.#enginePromise;
  }

  async #generate(engine, segment, fullText, active, signal) {
    const audio = await engine.generateAsync({
      text: segment,
      enableExternalBuffer: false,
      generationConfig: createGenerationConfig({
        sid: SUPERTONIC_VOICE_PROFILES[this.voiceProfile],
        speed: this.speed,
        numSteps: this.numSteps,
        lang: detectSpeechLanguage(fullText),
      }),
      onProgress: () => !active.cancelled && !signal?.aborted,
    });
    this.#assertActive(active, signal);
    if (!(audio?.samples instanceof Float32Array) || !Number.isInteger(audio.sampleRate)) {
      throw new Error("Supertonic returned invalid audio.");
    }
    return audio;
  }

  #assertActive(active, signal) {
    if (active.cancelled || this.#active !== active || signal?.aborted) {
      throw abortError(signal?.reason ?? "speech_cancelled");
    }
  }
}

async function createSherpaEngine({ modelDirectory, numThreads }) {
  const sherpa = require("sherpa-onnx-node");
  return sherpa.OfflineTts.createAsync({
    model: {
      supertonic: {
        durationPredictor: path.join(modelDirectory, "duration_predictor.int8.onnx"),
        textEncoder: path.join(modelDirectory, "text_encoder.int8.onnx"),
        vectorEstimator: path.join(modelDirectory, "vector_estimator.int8.onnx"),
        vocoder: path.join(modelDirectory, "vocoder.int8.onnx"),
        ttsJson: path.join(modelDirectory, "tts.json"),
        unicodeIndexer: path.join(modelDirectory, "unicode_indexer.bin"),
        voiceStyle: path.join(modelDirectory, "voice.bin"),
      },
      debug: false,
      numThreads,
      provider: "cpu",
    },
  });
}

function createGenerationConfig({ sid, speed, numSteps, lang }) {
  const sherpa = require("sherpa-onnx-node");
  return new sherpa.GenerationConfig({ sid, speed, numSteps, extra: { lang } });
}

function abortError(reason) {
  const error = new Error(reason === undefined ? "Speech aborted." : String(reason));
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}
