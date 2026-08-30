const STATE_VALUES = Object.freeze({
  service: Object.freeze(["starting", "ready", "stopping", "faulted"]),
  turn: Object.freeze([
    "idle",
    "thinking",
    "executing",
    "waiting_approval",
    "error",
  ]),
  audioInput: Object.freeze([
    "stopped",
    "listening",
    "speech_detected",
    "transcribing",
  ]),
  audioOutput: Object.freeze(["silent", "synthesizing", "speaking"]),
});

const TRANSITIONS = Object.freeze({
  service: transitionMap({
    starting: ["ready", "stopping", "faulted"],
    ready: ["stopping", "faulted"],
    stopping: ["starting", "ready", "faulted"],
    faulted: ["starting", "stopping"],
  }),
  turn: transitionMap({
    idle: ["thinking", "error"],
    thinking: ["executing", "waiting_approval", "idle", "error"],
    executing: ["thinking", "waiting_approval", "idle", "error"],
    waiting_approval: ["executing", "thinking", "idle", "error"],
    error: ["idle", "thinking"],
  }),
  audioInput: transitionMap({
    stopped: ["listening"],
    listening: ["speech_detected", "stopped"],
    speech_detected: ["transcribing", "listening", "stopped"],
    transcribing: ["listening", "speech_detected", "stopped"],
  }),
  audioOutput: transitionMap({
    silent: ["synthesizing", "speaking"],
    synthesizing: ["speaking", "silent"],
    speaking: ["silent", "synthesizing"],
  }),
});

const DEFAULT_STATE = Object.freeze({
  service: "ready",
  turn: "idle",
  audioInput: "stopped",
  audioOutput: "silent",
});

export class ActivityStateStore {
  #clock;
  #listeners = new Set();
  #onListenerError;
  #sequence = 0;
  #snapshot;

  constructor({
    initialState = {},
    clock = () => new Date(),
    onListenerError = () => {},
  } = {}) {
    if (typeof clock !== "function") {
      throw new TypeError("ActivityStateStore clock must be a function.");
    }
    if (typeof onListenerError !== "function") {
      throw new TypeError(
        "ActivityStateStore onListenerError must be a function.",
      );
    }
    validatePatch(initialState);
    this.#clock = clock;
    this.#onListenerError = onListenerError;
    this.#snapshot = freezeSnapshot({ ...DEFAULT_STATE, ...initialState });
  }

  get snapshot() {
    return structuredClone(this.#snapshot);
  }

  get uiState() {
    return deriveUiState(this.#snapshot);
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("Activity-state listeners must be functions.");
    }
    this.#listeners.add(listener);
    if (emitCurrent) {
      this.#notify(listener, {
        type: "activity_state_snapshot",
        sequence: this.#sequence,
        timestamp: formatTimestamp(this.#clock()),
        current: this.snapshot,
        uiState: this.uiState,
      });
    }
    return () => this.#listeners.delete(listener);
  }

  transition(axis, value, metadata = {}) {
    return this.update({ [axis]: value }, metadata);
  }

  update(patch, { source = "runtime", reason = "state_transition" } = {}) {
    validatePatch(patch);
    const entries = Object.entries(patch);
    if (entries.length === 0) return this.snapshot;

    const changed = entries.filter(
      ([axis, value]) => this.#snapshot[axis] !== value,
    );
    if (changed.length === 0) return this.snapshot;

    for (const [axis, value] of changed) {
      const current = this.#snapshot[axis];
      if (!TRANSITIONS[axis][current].has(value)) {
        throw new Error(
          "Invalid " + axis + " transition from " + current + " to " + value + ".",
        );
      }
    }

    const previous = this.#snapshot;
    this.#snapshot = freezeSnapshot({ ...previous, ...patch });
    const event = Object.freeze({
      type: "activity_state_changed",
      sequence: ++this.#sequence,
      timestamp: formatTimestamp(this.#clock()),
      source: String(source),
      reason: String(reason),
      changedAxes: Object.freeze(changed.map(([axis]) => axis)),
      previous,
      current: this.#snapshot,
      uiState: deriveUiState(this.#snapshot),
    });

    for (const listener of this.#listeners) this.#notify(listener, event);
    return this.snapshot;
  }

  #notify(listener, event) {
    try {
      listener(event);
    } catch (error) {
      this.#onListenerError(error);
    }
  }
}

export function deriveUiState(state) {
  validateCompleteState(state);
  if (state.service === "faulted" || state.turn === "error") return "error";
  if (state.turn === "waiting_approval") return "waiting_approval";
  if (
    state.audioInput === "speech_detected" ||
    state.audioInput === "transcribing"
  ) {
    return "listening";
  }
  if (state.turn === "executing") return "executing";
  if (state.audioOutput === "speaking") return "speaking";
  if (state.turn === "thinking" || state.audioOutput === "synthesizing") {
    return "thinking";
  }
  if (state.audioInput === "listening") return "listening";
  if (state.service === "starting") return "starting";
  if (state.service === "stopping") return "stopping";
  return "idle";
}

function transitionMap(definition) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definition).map(([from, destinations]) => [
        from,
        new Set(destinations),
      ]),
    ),
  );
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("Activity state updates must be objects.");
  }
  for (const [axis, value] of Object.entries(patch)) {
    if (!(axis in STATE_VALUES)) {
      throw new TypeError("Unknown activity-state axis: " + axis + ".");
    }
    if (!STATE_VALUES[axis].includes(value)) {
      throw new TypeError("Unknown " + axis + " state: " + value + ".");
    }
  }
}

function validateCompleteState(state) {
  validatePatch(state);
  for (const axis of Object.keys(STATE_VALUES)) {
    if (!(axis in state)) {
      throw new TypeError("Activity state is missing the " + axis + " axis.");
    }
  }
}

function freezeSnapshot(state) {
  validateCompleteState(state);
  return Object.freeze({ ...state });
}

function formatTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("ActivityStateStore clock returned an invalid date.");
  }
  return date.toISOString();
}

export { DEFAULT_STATE as DEFAULT_ACTIVITY_STATE, STATE_VALUES };
