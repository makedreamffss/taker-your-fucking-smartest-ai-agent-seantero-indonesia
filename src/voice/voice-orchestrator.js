import { ActivityStateStore } from "../core/activity-state.js";

export class VoiceOrchestrator {
  #cycle = null;
  #cycleSequence = 0;
  #running = false;

  constructor({
    session,
    vad,
    stt,
    tts,
    activityState = session?.activityState,
    requestApproval,
    onTranscript = () => {},
    onResponse = () => {},
    onEvent = () => {},
    onError = () => {},
  }) {
    requireMethod(session, "send", "session");
    requireMethod(session, "interrupt", "session");
    requireMethod(vad, "start", "vad");
    requireMethod(vad, "stop", "vad");
    requireMethod(stt, "transcribe", "stt");
    requireMethod(tts, "speak", "tts");
    requireMethod(tts, "stop", "tts");
    if (!(activityState instanceof ActivityStateStore)) {
      throw new TypeError(
        "VoiceOrchestrator activityState must be an ActivityStateStore.",
      );
    }
    for (const [name, callback] of Object.entries({
      onTranscript,
      onResponse,
      onEvent,
      onError,
    })) {
      if (typeof callback !== "function") {
        throw new TypeError(name + " must be a function.");
      }
    }

    this.session = session;
    this.vad = vad;
    this.stt = stt;
    this.tts = tts;
    this.activityState = activityState;
    this.requestApproval = requestApproval;
    this.onTranscript = onTranscript;
    this.onResponse = onResponse;
    this.onEvent = onEvent;
    this.onError = onError;
  }

  get isRunning() {
    return this.#running;
  }

  async start() {
    if (this.#running) return false;
    this.#running = true;
    this.activityState.transition("audioInput", "listening", {
      source: "voice",
      reason: "capture_started",
    });

    try {
      await this.vad.start({
        onSpeechStart: () => {
          void this.#handleSpeechStart().catch((error) => this.#fail(error));
        },
        onSpeechEnd: (audio) => {
          void this.#handleSpeechEnd(audio).catch((error) => this.#fail(error));
        },
        onError: (error) => {
          void this.#handleVadError(error);
        },
      });
      await this.#emit({ type: "voice_started" });
      return true;
    } catch (error) {
      this.#running = false;
      this.activityState.transition("audioInput", "stopped", {
        source: "voice",
        reason: "capture_start_failed",
      });
      throw error;
    }
  }

  async stop(reason = "voice_stopped") {
    if (!this.#running) return false;
    this.#running = false;
    this.#cancelCycle(reason);
    this.session.interrupt(reason);

    await Promise.allSettled([this.vad.stop(), this.tts.stop(reason)]);
    const patch = {};
    if (this.activityState.snapshot.audioInput !== "stopped") {
      patch.audioInput = "stopped";
    }
    if (this.activityState.snapshot.audioOutput !== "silent") {
      patch.audioOutput = "silent";
    }
    this.activityState.update(patch, {
      source: "voice",
      reason,
    });
    await this.#emit({ type: "voice_stopped", reason: String(reason) });
    return true;
  }

  async interrupt(reason = "voice_interrupted") {
    const cancelledCycle = this.#cancelCycle(reason);
    const interruptedTurn = this.session.interrupt(reason);
    await this.tts.stop(reason);
    if (this.activityState.snapshot.audioOutput !== "silent") {
      this.activityState.transition("audioOutput", "silent", {
        source: "voice",
        reason,
      });
    }
    await this.#emit({
      type: "voice_interrupted",
      reason: String(reason),
      cancelledCycle,
      interruptedTurn,
    });
    return cancelledCycle || interruptedTurn;
  }

  async #handleSpeechStart() {
    if (!this.#running) return;
    this.#cancelCycle("voice_barge_in");
    const cycle = {
      id: ++this.#cycleSequence,
      controller: new AbortController(),
    };
    this.#cycle = cycle;

    if (this.activityState.snapshot.audioInput !== "speech_detected") {
      this.activityState.transition("audioInput", "speech_detected", {
        source: "vad",
        reason: "speech_started",
      });
    }

    const hadOutput = this.activityState.snapshot.audioOutput !== "silent";
    if (hadOutput) {
      await this.tts.stop("voice_barge_in");
      if (this.activityState.snapshot.audioOutput !== "silent") {
        this.activityState.transition("audioOutput", "silent", {
          source: "voice",
          reason: "playback_interrupted",
        });
      }
    }
    const interruptedTurn = this.session.interrupt("voice_barge_in");
    await this.#emit({
      type: "speech_started",
      cycleId: cycle.id,
      interruptedOutput: hadOutput,
      interruptedTurn,
    });
  }

  async #handleSpeechEnd(audio) {
    if (!this.#running) return;
    const cycle =
      this.#cycle ??
      {
        id: ++this.#cycleSequence,
        controller: new AbortController(),
      };
    this.#cycle = cycle;
    const { id, controller } = cycle;

    if (this.activityState.snapshot.audioInput !== "transcribing") {
      this.activityState.transition("audioInput", "transcribing", {
        source: "vad",
        reason: "speech_ended",
      });
    }
    await this.#emit({ type: "transcription_started", cycleId: id });

    try {
      const transcript = normalizeText(
        await this.stt.transcribe(audio, {
          signal: controller.signal,
        }),
      );
      if (!this.#isCurrent(cycle)) return;

      this.activityState.transition("audioInput", "listening", {
        source: "voice",
        reason: transcript ? "transcription_completed" : "empty_transcription",
      });
      await this.#emit({
        type: "transcription_completed",
        cycleId: id,
        hasText: transcript.length > 0,
      });
      if (!transcript) {
        this.#cycle = null;
        return;
      }

      await this.onTranscript(transcript);
      const response = normalizeText(
        await this.session.send(transcript, {
          signal: controller.signal,
          ...(this.requestApproval
            ? { requestApproval: this.requestApproval }
            : {}),
          onEvent: (event) =>
            this.#emit({ type: "agent_event", cycleId: id, event }),
        }),
      );
      if (!this.#isCurrent(cycle)) return;
      await this.onResponse(response);
      if (!response) {
        this.#cycle = null;
        return;
      }

      this.activityState.transition("audioOutput", "synthesizing", {
        source: "voice",
        reason: "response_ready",
      });
      await this.#emit({ type: "synthesis_started", cycleId: id });
      await this.tts.speak(response, {
        signal: controller.signal,
        onPlaybackStart: () => {
          if (
            this.#isCurrent(cycle) &&
            this.activityState.snapshot.audioOutput === "synthesizing"
          ) {
            this.activityState.transition("audioOutput", "speaking", {
              source: "tts",
              reason: "playback_started",
            });
          }
        },
      });
      if (!this.#isCurrent(cycle)) return;
      if (this.activityState.snapshot.audioOutput !== "silent") {
        this.activityState.transition("audioOutput", "silent", {
          source: "tts",
          reason: "playback_completed",
        });
      }
      await this.#emit({ type: "response_spoken", cycleId: id });
      this.#cycle = null;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        await this.#emit({
          type: "voice_cycle_cancelled",
          cycleId: id,
          reason: formatReason(controller.signal.reason),
        });
        return;
      }
      if (this.#isCurrent(cycle)) {
        this.#cycle = null;
        if (
          this.#running &&
          this.activityState.snapshot.audioInput !== "listening"
        ) {
          this.activityState.transition("audioInput", "listening", {
            source: "voice",
            reason: "voice_cycle_failed",
          });
        }
        if (this.activityState.snapshot.audioOutput !== "silent") {
          this.activityState.transition("audioOutput", "silent", {
            source: "voice",
            reason: "voice_cycle_failed",
          });
        }
      }
      await this.#fail(error);
    }
  }

  async #handleVadError(error) {
    if (this.#running) {
      this.#running = false;
      this.#cancelCycle("voice_provider_error");
      this.session.interrupt("voice_provider_error");
      await Promise.allSettled([this.tts.stop("voice_provider_error")]);
      const patch = {};
      if (this.activityState.snapshot.audioInput !== "stopped") {
        patch.audioInput = "stopped";
      }
      if (this.activityState.snapshot.audioOutput !== "silent") {
        patch.audioOutput = "silent";
      }
      this.activityState.update(patch, {
        source: "voice",
        reason: "voice_provider_error",
      });
    }
    await this.#fail(error);
  }

  #cancelCycle(reason) {
    if (!this.#cycle) return false;
    this.#cycle.controller.abort(reason);
    this.#cycle = null;
    return true;
  }

  #isCurrent(cycle) {
    return (
      this.#running &&
      this.#cycle === cycle &&
      !cycle.controller.signal.aborted
    );
  }

  async #emit(event) {
    await this.onEvent(Object.freeze({ ...event }));
  }

  async #fail(error) {
    await this.onError(error);
    await this.#emit({
      type: "voice_error",
      errorCode: error?.code ?? "VOICE_ERROR",
    });
  }
}

function requireMethod(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(
      "VoiceOrchestrator requires " + name + "." + method + "().",
    );
  }
}

function normalizeText(value) {
  if (typeof value === "string") return value.trim();
  if (
    value &&
    typeof value === "object" &&
    typeof value.content === "string"
  ) {
    return value.content.trim();
  }
  return "";
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function formatReason(reason) {
  if (reason instanceof Error) return reason.message;
  return reason === undefined ? "cancelled" : String(reason);
}
