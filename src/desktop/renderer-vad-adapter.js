export class RendererVadAdapter {
  #callbacks = null;
  #pending = null;
  #state = "stopped";

  constructor({ sendCommand, timeoutMs = 15_000 }) {
    if (typeof sendCommand !== "function") {
      throw new TypeError("RendererVadAdapter sendCommand must be a function.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new RangeError("RendererVadAdapter timeoutMs is invalid.");
    }
    this.sendCommand = sendCommand;
    this.timeoutMs = timeoutMs;
  }

  get state() {
    return this.#state;
  }

  async start(callbacks) {
    if (!callbacks || typeof callbacks !== "object") {
      throw new TypeError("VAD callbacks are required.");
    }
    for (const name of ["onSpeechStart", "onSpeechEnd", "onError"]) {
      if (typeof callbacks[name] !== "function") {
        throw new TypeError("VAD callback " + name + " is required.");
      }
    }
    if (this.#state === "running") return false;
    if (this.#pending) throw new Error("A VAD lifecycle command is pending.");
    this.#callbacks = callbacks;
    this.#state = "starting";
    const confirmation = this.#waitFor("started");
    this.sendCommand({ type: "start" });
    await confirmation;
    return true;
  }

  async stop() {
    if (this.#state === "stopped") return false;
    if (this.#pending) throw new Error("A VAD lifecycle command is pending.");
    this.#state = "stopping";
    const confirmation = this.#waitFor("stopped");
    this.sendCommand({ type: "stop" });
    await confirmation;
    this.#callbacks = null;
    return true;
  }

  handleEvent(event) {
    switch (event?.type) {
      case "started":
        this.#state = "running";
        this.#resolvePending("started");
        break;
      case "stopped":
        this.#state = "stopped";
        this.#resolvePending("stopped");
        break;
      case "speech_started":
        this.#callbacks?.onSpeechStart();
        break;
      case "vad_misfire":
        break;
      case "error": {
        const error = new Error(event.message || "Microphone VAD failed.");
        error.code = event.code || "VAD_ERROR";
        this.#state = "stopped";
        this.#rejectPending(error);
        this.#callbacks?.onError(error);
        break;
      }
      default:
        throw new TypeError("Unknown renderer VAD event.");
    }
  }

  handleSpeech(audio) {
    if (this.#state !== "running") return false;
    if (!(audio instanceof Float32Array)) {
      throw new TypeError("Renderer VAD speech must be a Float32Array.");
    }
    this.#callbacks?.onSpeechEnd(audio);
    return true;
  }

  #waitFor(expected) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending?.expected !== expected) return;
        this.#pending = null;
        this.#state = "stopped";
        const error = new Error("Renderer VAD did not confirm " + expected + ".");
        error.code = "VAD_LIFECYCLE_TIMEOUT";
        reject(error);
      }, this.timeoutMs);
      this.#pending = { expected, resolve, reject, timer };
    });
  }

  #resolvePending(actual) {
    if (!this.#pending || this.#pending.expected !== actual) return;
    const pending = this.#pending;
    this.#pending = null;
    clearTimeout(pending.timer);
    pending.resolve();
  }

  #rejectPending(error) {
    if (!this.#pending) return;
    const pending = this.#pending;
    this.#pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}
