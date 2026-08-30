"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "taker",
  Object.freeze({
    activate() {
      ipcRenderer.send("pet:activate");
    },
    onActivityState(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("onActivityState requires a callback.");
      }
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("activity-state", listener);
      ipcRenderer.send("activity-state:ready");
      return () => ipcRenderer.removeListener("activity-state", listener);
    },
    voice: Object.freeze({
      onCommand(callback) {
        if (typeof callback !== "function") {
          throw new TypeError("voice.onCommand requires a callback.");
        }
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("voice:command", listener);
        return () => ipcRenderer.removeListener("voice:command", listener);
      },
      reportEvent(type, detail = {}) {
        const allowed = new Set([
          "started",
          "stopped",
          "speech_started",
          "vad_misfire",
          "error",
        ]);
        if (!allowed.has(type)) throw new TypeError("Unknown voice event.");
        const payload = {
          type,
          ...(typeof detail.code === "string"
            ? { code: detail.code.slice(0, 80) }
            : {}),
          ...(typeof detail.message === "string"
            ? { message: detail.message.slice(0, 500) }
            : {}),
        };
        ipcRenderer.send("voice:event", payload);
      },
      submitSpeechSegment(buffer) {
        if (!(buffer instanceof ArrayBuffer)) {
          throw new TypeError("Speech segment must be an ArrayBuffer.");
        }
        if (buffer.byteLength === 0 || buffer.byteLength > 7_680_000) {
          throw new RangeError("Speech segment has an invalid size.");
        }
        ipcRenderer.send("voice:speech-segment", buffer);
      },
    }),
  }),
);
