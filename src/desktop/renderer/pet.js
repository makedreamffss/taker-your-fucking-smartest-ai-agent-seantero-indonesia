"use strict";

import { createMicrophoneVad } from "./voice-capture.js";
import { PixelCharacterRenderer } from "./pixel-character-renderer.js";
import { VoicePlayback } from "./voice-playback.js";

const pet = document.getElementById("pet");
const renderer = new PixelCharacterRenderer({
  canvas: document.getElementById("character"),
  fallback: document.getElementById("character-fallback"),
});
void renderer.start().catch((error) => {
  window.taker.reportRendererError(error?.message || String(error));
});
const KNOWN_STATES = new Set([
  "idle",
  "starting",
  "stopping",
  "thinking",
  "executing",
  "waiting_approval",
  "listening",
  "speaking",
  "error",
]);

window.taker.onActivityState((event) => {
  const state = KNOWN_STATES.has(event?.uiState) ? event.uiState : "error";
  pet.dataset.state = state;
  pet.setAttribute("aria-label", "Taker Takeover is " + describe(state));
  renderer.handleActivity(event);
});

window.taker.onCharacterEvent((event) => renderer.handleEvent(event));
window.addEventListener("resize", () => renderer.resize());
window.addEventListener("beforeunload", () => renderer.destroy());

const playback = new VoicePlayback({
  reportEvent(type, detail) {
    window.taker.voice.reportPlaybackEvent(type, detail);
  },
  onEnergy(value) {
    renderer.setSpeechEnergy(value);
  },
});
window.taker.voice.onPlaybackCommand((command) => {
  void playback.handle(command).catch((error) => {
    window.taker.voice.reportPlaybackEvent("error", {
      id: typeof command?.id === "string" ? command.id : "invalid-playback-id",
      code: error?.name || "AUDIO_PLAYBACK_ERROR",
      message: error?.message || String(error),
    });
  });
});

let activePointer = null;
let dragFrame = null;
let pendingDragPoint = null;
let suppressActivationUntil = 0;

pet.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || activePointer) return;
  activePointer = {
    id: event.pointerId,
    originX: event.screenX,
    originY: event.screenY,
    moved: false,
  };
  pet.setPointerCapture(event.pointerId);
  window.taker.drag.start(event.screenX, event.screenY);
});

pet.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointer?.id) return;
  const distance = Math.hypot(
    event.screenX - activePointer.originX,
    event.screenY - activePointer.originY,
  );
  if (distance >= 4) activePointer.moved = true;
  if (!activePointer.moved) return;
  pendingDragPoint = { x: event.screenX, y: event.screenY };
  if (dragFrame !== null) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = null;
    if (!pendingDragPoint) return;
    window.taker.drag.move(pendingDragPoint.x, pendingDragPoint.y);
    pendingDragPoint = null;
  });
});

pet.addEventListener("pointerup", finishPointerInteraction);
pet.addEventListener("pointercancel", finishPointerInteraction);
pet.addEventListener("lostpointercapture", finishPointerInteraction);

pet.addEventListener("dblclick", () => {
  if (performance.now() >= suppressActivationUntil) window.taker.activate();
});
pet.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    window.taker.activate();
  }
});

function finishPointerInteraction(event) {
  if (event.pointerId !== activePointer?.id) return;
  if (activePointer.moved) suppressActivationUntil = performance.now() + 400;
  activePointer = null;
  pendingDragPoint = null;
  if (dragFrame !== null) cancelAnimationFrame(dragFrame);
  dragFrame = null;
  window.taker.drag.end();
}

let microphoneVad = null;
window.taker.voice.onCommand(async (command) => {
  try {
    if (command?.type === "start") {
      microphoneVad ??= await createMicrophoneVad();
      await microphoneVad.start();
      window.taker.voice.reportEvent("started");
    } else if (command?.type === "stop") {
      await microphoneVad?.pause();
      window.taker.voice.reportEvent("stopped");
    }
  } catch (error) {
    window.taker.voice.reportEvent("error", {
      code: error?.name || "MICROPHONE_ERROR",
      message: error?.message || String(error),
    });
  }
});

function describe(state) {
  return state === "waiting_approval" ? "waiting for approval" : state;
}
