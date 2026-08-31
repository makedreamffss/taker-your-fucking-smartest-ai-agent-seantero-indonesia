"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "taker",
  Object.freeze({
    activate() {
      ipcRenderer.send("pet:activate");
    },
    reportRendererError(message) {
      if (typeof message === "string") {
        ipcRenderer.send("pet:renderer-error", message.slice(0, 500));
      }
    },
    onCharacterEvent(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("onCharacterEvent requires a callback.");
      }
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("character:event", listener);
      return () => ipcRenderer.removeListener("character:event", listener);
    },
    embodiment: Object.freeze({
      onCommand(callback) {
        if (typeof callback !== "function") {
          throw new TypeError("embodiment.onCommand requires a callback.");
        }
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("embodiment:command", listener);
        return () => ipcRenderer.removeListener("embodiment:command", listener);
      },
      reportEvent(event) {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          throw new TypeError("embodiment.reportEvent requires an object.");
        }
        ipcRenderer.send("embodiment:event", event);
      },
    }),
    drag: Object.freeze({
      start(screenX, screenY) {
        ipcRenderer.send("pet:drag-start", safePoint(screenX, screenY));
      },
      move(screenX, screenY) {
        ipcRenderer.send("pet:drag-move", safePoint(screenX, screenY));
      },
      end() {
        ipcRenderer.send("pet:drag-end");
      },
    }),
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
      onPlaybackCommand(callback) {
        if (typeof callback !== "function") {
          throw new TypeError("voice.onPlaybackCommand requires a callback.");
        }
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("voice:playback-command", listener);
        return () => ipcRenderer.removeListener("voice:playback-command", listener);
      },
      reportPlaybackEvent(type, detail = {}) {
        const allowed = new Set(["started", "ended", "stopped", "error"]);
        if (!allowed.has(type)) throw new TypeError("Unknown playback event.");
        if (typeof detail.id !== "string" || detail.id.length > 80) {
          throw new TypeError("Playback event requires a bounded id.");
        }
        ipcRenderer.send("voice:playback-event", {
          type,
          id: detail.id,
          ...(typeof detail.reason === "string"
            ? { reason: detail.reason.slice(0, 120) }
            : {}),
          ...(typeof detail.code === "string"
            ? { code: detail.code.slice(0, 80) }
            : {}),
          ...(typeof detail.message === "string"
            ? { message: detail.message.slice(0, 500) }
            : {}),
        });
      },
    }),
  }),
);

function safePoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Pointer coordinates must be finite numbers.");
  }
  return {
    x: Math.round(Math.max(-100_000, Math.min(100_000, x))),
    y: Math.round(Math.max(-100_000, Math.min(100_000, y))),
  };
}
