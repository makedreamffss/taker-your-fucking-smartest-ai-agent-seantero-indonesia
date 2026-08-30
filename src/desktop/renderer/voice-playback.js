"use strict";

export class VoicePlayback {
  #context = null;
  #active = null;
  #pendingId = null;
  #sequence = 0;

  constructor({ reportEvent, onEnergy = () => {} }) {
    if (typeof reportEvent !== "function") {
      throw new TypeError("VoicePlayback requires reportEvent().");
    }
    if (typeof onEnergy !== "function") {
      throw new TypeError("VoicePlayback onEnergy must be a function.");
    }
    this.reportEvent = reportEvent;
    this.onEnergy = onEnergy;
  }

  async handle(command) {
    if (command?.type === "stop") {
      this.stop(command.reason ?? "playback_stopped", command.id);
      return;
    }
    if (command?.type !== "play") return;
    const id = safeId(command.id);
    const bytes = normalizeBytes(command.wave);
    await this.#play(id, bytes);
  }

  stop(reason = "playback_stopped", requestedId) {
    const active = this.#active;
    if (!active) {
      if (!this.#pendingId || (requestedId && requestedId !== this.#pendingId)) {
        return false;
      }
      const id = this.#pendingId;
      this.#pendingId = null;
      this.#sequence += 1;
      this.onEnergy(0);
      this.reportEvent("stopped", { id, reason: String(reason).slice(0, 120) });
      return true;
    }
    if (requestedId && requestedId !== active.id) return false;
    this.#active = null;
    this.#sequence += 1;
    active.reason = String(reason).slice(0, 120);
    cancelAnimationFrame(active.energyFrame);
    this.onEnergy(0);
    try {
      active.source.stop();
    } catch {
      this.reportEvent("stopped", { id: active.id, reason: active.reason });
    }
    return true;
  }

  async #play(id, bytes) {
    this.stop("superseded");
    const sequence = ++this.#sequence;
    this.#pendingId = id;
    const context = this.#context ??= new AudioContext({ latencyHint: "interactive" });
    if (context.state !== "running") await context.resume();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let decoded;
    try {
      decoded = await context.decodeAudioData(buffer);
    } catch (error) {
      if (sequence === this.#sequence) this.#pendingId = null;
      throw error;
    }
    if (sequence !== this.#sequence) return;
    this.#pendingId = null;

    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    const gain = context.createGain();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.45;
    gain.gain.value = 1;
    source.buffer = decoded;
    source.connect(analyser).connect(gain).connect(context.destination);
    const active = {
      id,
      source,
      analyser,
      energyFrame: null,
      energySamples: new Float32Array(analyser.fftSize),
      reason: null,
    };
    this.#active = active;
    source.onended = () => {
      cancelAnimationFrame(active.energyFrame);
      this.onEnergy(0);
      if (this.#active === active) this.#active = null;
      if (active.reason) {
        this.reportEvent("stopped", { id, reason: active.reason });
      } else {
        this.reportEvent("ended", { id });
      }
    };
    source.start();
    this.#sampleEnergy(active);
    this.reportEvent("started", { id });
  }

  #sampleEnergy(active) {
    if (this.#active !== active) return;
    const samples = active.energySamples;
    active.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    this.onEnergy(Math.min(1, Math.sqrt(sum / samples.length) * 4.2));
    active.energyFrame = requestAnimationFrame(() => this.#sampleEnergy(active));
  }
}

function normalizeBytes(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : value?.buffer instanceof ArrayBuffer
      ? new Uint8Array(value.buffer)
      : null;
  if (!bytes || bytes.byteLength < 44 || bytes.byteLength > 32 * 1024 * 1024) {
    throw new RangeError("Playback command contained invalid wave audio.");
  }
  return bytes;
}

function safeId(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{16,80}$/i.test(value)) {
    throw new TypeError("Playback command contained an invalid id.");
  }
  return value;
}
