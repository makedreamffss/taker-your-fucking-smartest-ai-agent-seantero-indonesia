"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "takerPopover",
  Object.freeze({
    onView(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("popover.onView requires a callback.");
      }
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("popover:view", listener);
      ipcRenderer.send("popover:ready");
      return () => ipcRenderer.removeListener("popover:view", listener);
    },
    submit(action) {
      if (!action || typeof action !== "object") {
        throw new TypeError("Popover action must be an object.");
      }
      const type = action.type;
      if (!new Set(["prompt", "approve", "deny", "dismiss"]).has(type)) {
        throw new TypeError("Unknown popover action.");
      }
      ipcRenderer.send("popover:action", {
        type,
        ...(typeof action.id === "string"
          ? { id: action.id.slice(0, 80) }
          : {}),
        ...(typeof action.text === "string"
          ? { text: action.text.slice(0, 20_000) }
          : {}),
      });
    },
  }),
);
