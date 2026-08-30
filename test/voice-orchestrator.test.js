import assert from "node:assert/strict";
import test from "node:test";

import { ActivityStateStore } from "../src/core/activity-state.js";
import { VoiceOrchestrator } from "../src/voice/voice-orchestrator.js";

test("voice remains listening during output and barge-in stops output and turn", async () => {
  const activityState = new ActivityStateStore();
  const vad = createVad();
  const playback = deferred();
  const calls = {
    interrupts: [],
    stopReasons: [],
  };
  const session = {
    activityState,
    interrupt(reason) {
      calls.interrupts.push(reason);
      return reason === "voice_barge_in";
    },
    async send(text) {
      assert.equal(text, "hello taker");
      activityState.transition("turn", "thinking");
      activityState.transition("turn", "idle");
      return { content: "hello human", rounds: 1, toolCalls: 0 };
    },
  };
  const tts = {
    async speak(text, { onPlaybackStart, signal }) {
      assert.equal(text, "hello human");
      onPlaybackStart();
      await Promise.race([
        playback.promise,
        new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        ),
      ]);
    },
    async stop(reason) {
      calls.stopReasons.push(reason);
      playback.resolve();
    },
  };
  const orchestrator = new VoiceOrchestrator({
    session,
    vad,
    stt: { transcribe: async () => " hello taker " },
    tts,
  });

  await orchestrator.start();
  await vad.speechStart();
  await vad.speechEnd(new Float32Array([0.1]));
  await waitFor(() => activityState.snapshot.audioOutput === "speaking");

  assert.equal(activityState.snapshot.audioInput, "listening");
  await vad.speechStart();
  await waitFor(() => activityState.snapshot.audioOutput === "silent");

  assert.equal(activityState.snapshot.audioInput, "speech_detected");
  assert.ok(calls.interrupts.includes("voice_barge_in"));
  assert.deepEqual(calls.stopReasons, ["voice_barge_in"]);
  await orchestrator.stop();
});

test("a superseded transcription cannot start an agent turn", async () => {
  const activityState = new ActivityStateStore();
  const vad = createVad();
  const firstTranscript = deferred();
  const sent = [];
  const orchestrator = new VoiceOrchestrator({
    session: {
      activityState,
      interrupt: () => false,
      async send(text) {
        sent.push(text);
        return "";
      },
    },
    vad,
    stt: {
      transcribe: () => firstTranscript.promise,
    },
    tts: {
      speak: async () => {},
      stop: async () => {},
    },
  });

  await orchestrator.start();
  await vad.speechStart();
  await vad.speechEnd(new Float32Array([0.1]));
  await waitFor(() => activityState.snapshot.audioInput === "transcribing");
  await vad.speechStart();
  firstTranscript.resolve("stale words");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, []);
  assert.equal(activityState.snapshot.audioInput, "speech_detected");
  await orchestrator.stop();
});

test("empty speech returns to listening without calling the agent", async () => {
  const activityState = new ActivityStateStore();
  const vad = createVad();
  let sendCount = 0;
  const orchestrator = new VoiceOrchestrator({
    session: {
      activityState,
      interrupt: () => false,
      async send() {
        sendCount += 1;
        return "unused";
      },
    },
    vad,
    stt: { transcribe: async () => "   " },
    tts: {
      speak: async () => {},
      stop: async () => {},
    },
  });

  await orchestrator.start();
  await vad.speechStart();
  await vad.speechEnd(new Float32Array([0]));
  await waitFor(() => activityState.snapshot.audioInput === "listening");

  assert.equal(sendCount, 0);
  await orchestrator.stop();
  assert.equal(activityState.snapshot.audioInput, "stopped");
});

test("a VAD provider failure stops capture and cancels active work", async () => {
  const activityState = new ActivityStateStore();
  const vad = createVad();
  const interrupts = [];
  const errors = [];
  const orchestrator = new VoiceOrchestrator({
    session: {
      activityState,
      interrupt(reason) {
        interrupts.push(reason);
        return false;
      },
      async send() {
        return { content: "" };
      },
    },
    vad,
    stt: { transcribe: async () => "" },
    tts: {
      speak: async () => {},
      stop: async () => {},
    },
    onError: (error) => errors.push(error.message),
  });

  await orchestrator.start();
  await vad.fail(new Error("device disconnected"));
  await waitFor(() => !orchestrator.isRunning);

  assert.equal(activityState.snapshot.audioInput, "stopped");
  assert.ok(interrupts.includes("voice_provider_error"));
  assert.deepEqual(errors, ["device disconnected"]);
});

test("explicit interruption stops speech without disabling listening", async () => {
  const activityState = new ActivityStateStore({
    initialState: { audioInput: "listening", audioOutput: "speaking" },
  });
  const stopReasons = [];
  const interruptReasons = [];
  const orchestrator = new VoiceOrchestrator({
    session: {
      activityState,
      interrupt(reason) {
        interruptReasons.push(reason);
        return true;
      },
      send: async () => "",
    },
    vad: { start: async () => {}, stop: async () => {} },
    stt: { transcribe: async () => "" },
    tts: {
      speak: async () => {},
      stop: async (reason) => stopReasons.push(reason),
    },
  });

  assert.equal(await orchestrator.interrupt("user_interruption"), true);
  assert.equal(activityState.snapshot.audioInput, "listening");
  assert.equal(activityState.snapshot.audioOutput, "silent");
  assert.deepEqual(stopReasons, ["user_interruption"]);
  assert.deepEqual(interruptReasons, ["user_interruption"]);
});

function createVad() {
  let callbacks;
  return {
    async start(value) {
      callbacks = value;
    },
    async stop() {},
    async speechStart() {
      await callbacks.onSpeechStart();
      await new Promise((resolve) => setImmediate(resolve));
    },
    async speechEnd(audio) {
      await callbacks.onSpeechEnd(audio);
      await new Promise((resolve) => setImmediate(resolve));
    },
    async fail(error) {
      await callbacks.onError(error);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition was not met before timeout.");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}
