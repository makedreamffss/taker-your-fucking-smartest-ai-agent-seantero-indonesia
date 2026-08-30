"use strict";

import { createMicrophoneVad } from "./voice-capture.js";

const pet = document.getElementById("pet");
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
});

pet.addEventListener("dblclick", () => window.taker.activate());
pet.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    window.taker.activate();
  }
});

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
