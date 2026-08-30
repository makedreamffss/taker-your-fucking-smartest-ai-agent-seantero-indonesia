import { randomUUID } from "node:crypto";

const MAX_WAVE_BYTES = 32 * 1024 * 1024;

export class RendererAudioPlayer {
  #pending = new Map();

  constructor({ sendCommand, timeoutMs = 120_000 } = {}) {
    if (typeof sendCommand !== "function") {
      throw new TypeError("RendererAudioPlayer requires sendCommand().");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
      throw new RangeError("timeoutMs must be an integer of at least 1000.");
    }
    this.sendCommand = sendCommand;
    this.timeoutMs = timeoutMs;
  }

  play(wave, { signal, onPlaybackStart = () => {} } = {}) {
    const bytes = normalizeWave(wave);
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const entry = {
        id,
        resolve,
        reject,
        onPlaybackStart,
        started: false,
        timer: null,
        signal,
        abortListener: null,
      };
      entry.timer = setTimeout(() => {
        this.#settle(id, new Error("Renderer audio playback timed out."));
        this.sendCommand({ type: "stop", id, reason: "playback_timeout" });
      }, this.timeoutMs);
      entry.abortListener = () => {
        this.sendCommand({ type: "stop", id, reason: "playback_aborted" });
        this.#settle(id, abortError(signal.reason));
      };
      signal?.addEventListener("abort", entry.abortListener, { once: true });
      this.#pending.set(id, entry);
      try {
        this.sendCommand({ type: "play", id, wave: bytes });
      } catch (error) {
        this.#settle(id, error);
      }
    });
  }

  async stop(reason = "playback_stopped") {
    let deliveryError = null;
    try {
      this.sendCommand({ type: "stop", reason: String(reason).slice(0, 120) });
    } catch (error) {
      deliveryError = error;
    }
    const error = deliveryError ?? abortError(reason);
    for (const id of [...this.#pending.keys()]) this.#settle(id, error);
  }

  handleEvent(event) {
    if (!isPlaybackEvent(event)) return false;
    const entry = this.#pending.get(event.id);
    if (!entry) return false;

    if (event.type === "started") {
      if (!entry.started) {
        entry.started = true;
        entry.onPlaybackStart();
      }
      return true;
    }
    if (event.type === "ended") {
      this.#settle(event.id);
      return true;
    }
    if (event.type === "stopped") {
      this.#settle(event.id, abortError(event.reason ?? "playback_stopped"));
      return true;
    }
    const error = new Error(event.message || "Renderer audio playback failed.");
    error.code = event.code || "AUDIO_PLAYBACK_ERROR";
    this.#settle(event.id, error);
    return true;
  }

  #settle(id, error) {
    const entry = this.#pending.get(id);
    if (!entry) return;
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.abortListener);
    if (error) entry.reject(error);
    else entry.resolve();
  }
}

function normalizeWave(value) {
  const bytes = Buffer.isBuffer(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value instanceof Uint8Array
      ? value
      : null;
  if (!bytes || bytes.byteLength < 44 || bytes.byteLength > MAX_WAVE_BYTES) {
    throw new RangeError("Wave audio must contain 44 bytes through 32 MiB.");
  }
  return Uint8Array.from(bytes);
}

function isPlaybackEvent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      value.id.length <= 80 &&
      new Set(["started", "ended", "stopped", "error"]).has(value.type),
  );
}

function abortError(reason) {
  const error = new Error(reason === undefined ? "Playback aborted." : String(reason));
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}
